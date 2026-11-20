// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 MbaoWang
// komari-cnroute：即時檢測各伺服器回程中國（電信 / 聯通 / 移動）路徑，按 AS 壓縮顯示
const server = require("server");
const fs = require("fs");
const lib = require("./lib.js");
const telegram = require("./telegram.js");

const DEFAULT_TARGETS = [
  "北京電信,219.141.140.10,ct",
  "北京聯通,202.106.195.68,cu",
  "北京移動,221.179.155.161,cm",
  "上海電信,202.96.209.133,ct",
  "上海聯通,210.22.97.1,cu",
  "上海移動,211.136.112.200,cm",
  "廣州電信,58.60.188.222,ct",
  "廣州聯通,210.21.196.6,cu",
  "廣州移動,120.196.165.24,cm",
].join("\n");

// IPv6 目標（取自 backtrace 的三網 IPv6 節點，只保留明確屬於三網位址段 240e / 2408 / 2409 的）
const DEFAULT_TARGETS_V6 = [
  "北京移動,2409:8c00:8421:1303::55,cm",
  "上海電信,240e:e1:aa00:4000::24,ct",
  "上海聯通,2408:80f1:21:5003::a,cu",
  "上海移動,2409:8c1e:75b0:3003::26,cm",
  "廣州電信,240e:97c:2f:3000::44,ct",
  "廣州聯通,2408:8756:f50:1001::c,cu",
  "廣州移動,2409:8c54:871:1001::12,cm",
].join("\n");

const STORE = (typeof __storageDir__ === "string" ? __storageDir__ : ".") + "/results.json";
const PROBE = fs.readFileSync("probe.sh", "utf8");
const PROBE_B64 = Buffer.from(PROBE, "utf8").toString("base64");
const FLOAT_JS = fs.readFileSync("float.js", "utf8");

let results = {}; // uuid -> 節點結果
const running = {}; // uuid -> true
let lastAutoRun = 0;

function log(...a) { console.log("[cnroute]", ...a); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function loadStore() {
  try { results = JSON.parse(fs.readFileSync(STORE, "utf8")) || {}; } catch (_) { results = {}; }
}
function saveStore() {
  try { fs.writeFileSync(STORE, JSON.stringify(results)); } catch (e) { log("寫入結果失敗", String(e)); }
}

// Komari 的「伺服器選擇」設定在資料庫存成 JSON 字串，讀出時通常已轉成陣列；兩種都接受
function nodeList(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : []; } catch (_) { return []; }
  }
  return [];
}

async function getCfg() {
  const c = (await server.getConfig()) || {};
  return {
    // IPv4 / IPv6 各自選伺服器（空 = 全部）
    v4Enabled: c.v4_enabled !== false,
    v6Enabled: c.v6_enabled === true,
    nodes4: nodeList(c.nodes),
    nodes6: nodeList(c.nodes_v6),
    // IPv4 目標：Zstatic CDN 省份節點（預設）或自訂清單
    v4Source: c.v4_source === "custom" ? "custom" : "zstatic",
    targets4: c.v4_source === "custom"
      ? lib.parseTargets(c.targets || DEFAULT_TARGETS, 4)
      : lib.zstaticTargets(c.zstatic_provinces || "北京,上海,廣東", 4),
    v6Source: c.v6_source === "custom" ? "custom" : "zstatic",
    targets6: c.v6_source === "custom"
      ? lib.parseTargets(c.targets_v6 || DEFAULT_TARGETS_V6, 6)
      : lib.zstaticTargets(c.zstatic_provinces || "北京,上海,廣東", 6),
    interval: Math.max(5, Number(c.interval) || 60),
    tool: ["auto", "nexttrace", "mtr", "traceroute"].includes(c.tool) ? c.tool : "auto",
    // 追蹤方式：auto = 網域目標（例如 Zstatic 節點）用 TCP，IP 目標用 ICMP
    traceProto: ["auto", "icmp", "tcp"].includes(c.trace_proto) ? c.trace_proto : "auto",
    parallel: Math.min(10, Math.max(1, Number(c.parallel) || 3)),
    installNexttrace: c.install_nexttrace === true,
    maskMode: c.mask_mode || "half",
    maskFirstAS: c.mask_first_as !== false,
    showIPs: c.show_hop_ips !== false,
    publicData: c.public_data !== false,
    transitRtt: Number.isFinite(Number(c.transit_rtt)) && c.transit_rtt !== "" ? Math.max(0, Number(c.transit_rtt)) : 50,
    floatButton: c.float_button !== false,
    floatPosition: c.float_position === "left" ? "left" : "right",
    maxHops: Math.min(64, Math.max(8, Number(c.max_hops) || 30)),
    timeout: Math.min(900, Math.max(30, Number(c.timeout) || 240)),
    tgToken: String(c.tg_token || "").trim(),
    tgChats: String(c.tg_chat_ids || "").split(/[\s,，]+/).map((x) => x.trim()).filter(Boolean),
    tgApi: String(c.tg_api_base || "https://api.telegram.org").trim().replace(/\/+$/, ""),
    tgNotify: c.tg_notify_change !== false,
    tgAllowCustom: c.tg_allow_custom !== false,
  };
}

async function listClients() {
  const list = (await server.call("admin:listClients")) || [];
  return list.map((c) => ({ uuid: c.uuid, name: c.name, ipv4: c.ipv4 || "", ipv6: c.ipv6 || "", hidden: !!c.hidden, weight: c.weight || 0 }));
}

function buildCommand(cfg, targets) {
  const protoOf = (t) => t.proto || (cfg.traceProto === "auto" ? (/[g-z]/i.test(t.ip) ? "tcp" : "icmp") : cfg.traceProto);
  const args = targets.map((t) => `${t.id}=${t.ip},${t.port || 80},${protoOf(t)},${t.v || 4}`).join(" ");
  // base64 包裝，避免 shell 引號問題
  // agent 以 `sh -s` 從 stdin 讀指令，子程序 stdin 要導到 /dev/null 以免吃掉後續指令
  return [
    `F=$(mktemp 2>/dev/null || echo /tmp/.komari-cnroute.$$)`,
    `echo ${PROBE_B64} | base64 -d > "$F"`,
    `bash "$F" ${cfg.tool} ${cfg.installNexttrace} ${cfg.maxHops} ${cfg.parallel} ${args} </dev/null`,
    `RC=$?; rm -f "$F"; exit $RC`,
  ].join("\n");
}

function buildNodeResult(client, cfg, output, exitCode, targets) {
  const parsed = lib.parseOutput(output);
  const node = {
    uuid: client.uuid,
    name: client.name,
    src_masked: lib.maskIP(client.ipv4, cfg.maskMode),
    src6_masked: lib.maskIP(client.ipv6, cfg.maskMode),
    updated_at: new Date().toISOString(),
    tool: parsed.tool,
    error: parsed.error || (exitCode !== 0 && !Object.keys(parsed.blocks).length ? `執行失敗 (exit ${exitCode})：${String(output || "").slice(0, 300)}` : ""),
    targets: [],
  };
  for (const t of targets) {
    const b = parsed.blocks[t.id];
    const v = t.v || (t.ip.includes(":") ? 6 : 4);
    if (!b || b.note) { node.targets.push({ label: t.label, v, isp: t.isp, ip: t.ip, error: b ? b.note : "沒有結果", segments: [], tags: [] }); continue; }
    const src = v === 6 ? client.ipv6 : client.ipv4;
    const comp = lib.compressPath(b.hops, { maskMode: cfg.maskMode, maskFirstAS: cfg.maskFirstAS, srcIP: src });
    // 網域目標以伺服器解析出的 IP 判斷是否到達
    const dstIP = b.ip && b.ip !== "-" ? b.ip : t.ip;
    const cls = lib.classify(b.hops, t.isp, dstIP, { transitRtt: cfg.transitRtt });
    if (!cfg.showIPs) for (const s of comp.segments) s.ips = [];
    const reached = b.hops.some((h) => h.ip === dstIP);
    node.targets.push({
      label: t.label,
      v,
      isp: t.isp,
      ip: t.ip,
      resolved: dstIP !== t.ip ? dstIP : "",
      reached,
      hop_count: b.hops.length,
      last_rtt: comp.last_rtt,
      tags: cls.tags,
      route: { line: cls.line, carrier: cls.carrier, cross: cls.cross, confidence: cls.confidence, evidence: cls.evidence, intl: cls.intl, intl_text: cls.intl_text, handoff_delta: cls.handoff_delta, transit_shown: cls.transit_shown,
        short: cls.short, access: cls.access, carrier_name: cls.carrier_name, cross_text: cls.cross_text || "", connect: cls.connect || "" },
      as_path: comp.segments.filter((s) => s.key !== "LAN").map((s) => s.key).join(" → "),
      segments: comp.segments,
    });
  }
  return node;
}

// 對一批節點下發探測，輪詢結果
// opts.targets: 自訂目標（預設用設定中的目標）；opts.store=false 時不覆蓋儲存的結果
// 回傳 { started, task_id, done }，done 在全部完成 / 逾時後 resolve 成 { uuid: 節點結果 }
// 這台伺服器要測哪些目標：依 IPv4 / IPv6 各自的伺服器選擇決定
function targetsFor(cfg, uuid) {
  const pick = (list) => !list.length || list.includes(uuid);
  return [].concat(
    cfg.v4Enabled && pick(cfg.nodes4) ? cfg.targets4 : [],
    cfg.v6Enabled && pick(cfg.nodes6) ? cfg.targets6 : []
  );
}

// 對一批節點下發探測，輪詢結果
// opts.targets: 自訂目標（全部節點都用這組）；否則每台依 targetsFor 決定
// opts.store=false 時不覆蓋儲存的結果
// 回傳 { started, busy, done }，done 在全部完成 / 逾時後 resolve 成 { uuid: 節點結果 }
async function probe(uuids, opts) {
  opts = opts || {};
  const cfg = await getCfg();
  const clients = await listClients();
  const map = {};
  for (const c of clients) map[c.uuid] = c;
  const busy = uuids.filter((u) => running[u]);
  uuids = uuids.filter((u) => map[u] && !running[u]);
  // 目標相同的節點合併成同一次下發
  const groups = {};
  for (const u of uuids) {
    const targets = opts.targets || targetsFor(cfg, u);
    if (!targets.length) continue;
    const key = targets.map((t) => t.id + "=" + t.ip).join(" ");
    (groups[key] = groups[key] || { targets, uuids: [] }).uuids.push(u);
  }
  const started = [];
  const errors = [];
  const dones = [];
  for (const g of Object.values(groups)) {
    const r = await runGroup(cfg, map, g.uuids, g.targets, opts);
    if (r.error) errors.push(r.error);
    else { started.push(...g.uuids); dones.push(r.done); }
  }
  const done = Promise.all(dones).then((list) => Object.assign({}, ...list));
  if (!started.length && !errors.length && uuids.length && !Object.keys(groups).length) {
    errors.push("這台伺服器沒有被選入 IPv4 或 IPv6 檢測（請到插件設定選擇伺服器）");
  }
  return { started, busy, error: errors[0], done };
}

async function runGroup(cfg, map, uuids, targets, opts) {
  const store = opts.store !== false;
  uuids.forEach((u) => (running[u] = true));
  let task;
  try {
    task = await server.call("admin:exec", { command: buildCommand(cfg, targets), clients: uuids });
  } catch (e) {
    uuids.forEach((u) => delete running[u]);
    log("下發失敗", e.message || String(e));
    return { error: e.message || String(e) };
  }
  const taskId = task.task_id;
  const pending = new Set(uuids);
  const out = {};
  const done = (async () => {
    const rounds = Math.ceil(targets.length / cfg.parallel);
    const deadline = Date.now() + Math.max(cfg.timeout, rounds * 40 + 30) * 1000;
    while (pending.size && Date.now() < deadline) {
      await sleep(5000);
      let rows = [];
      try { rows = (await server.call("admin:getTaskResultsByTaskId", { task_id: taskId })) || []; } catch (_) { continue; }
      for (const r of rows) {
        if (!pending.has(r.client) || !r.finished_at) continue;
        pending.delete(r.client);
        delete running[r.client];
        const node = buildNodeResult(map[r.client], cfg, r.result, r.exit_code, targets);
        out[r.client] = node;
        if (store) {
          const prev = results[r.client];
          results[r.client] = node;
          saveStore();
          if (opts.notifyChanges) telegram.notifyChange(prev, node).catch((e) => log("通知失敗", String(e)));
        }
        log("完成", map[r.client].name);
      }
    }
    for (const u of pending) {
      delete running[u];
      const err = "等待結果逾時（agent 離線、未開放遠端執行，或探測時間過長）";
      out[u] = { uuid: u, name: map[u].name, targets: [], error: err, updated_at: new Date().toISOString() };
      if (store) {
        const prev = results[u] || { uuid: u, name: map[u].name, targets: [] };
        prev.error = err;
        prev.updated_at = new Date().toISOString();
        results[u] = prev;
      }
    }
    if (pending.size && store) saveStore();
    return out;
  })();
  return { done };
}

// IPv4 或 IPv6 任一有選到的伺服器
async function selectedNodes(cfg) {
  const clients = await listClients();
  return clients.map((c) => c.uuid).filter((u) => targetsFor(cfg, u).length > 0);
}

function isAdmin(req) {
  const p = (req.context && req.context.principal) || {};
  return Array.isArray(p.roles) && p.roles.includes("admin");
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function load() {
  loadStore();

  // 公開資料：遮罩後的結果
  server.route("GET", "/api/cnroute/data", async (req, res) => {
    try {
      const cfg = await getCfg();
      const admin = isAdmin(req);
      if (!cfg.publicData && !admin) return json(res, 403, { error: "需要登入" });
      const clients = await listClients();
      const allowed = await selectedNodes(cfg);
      const nodes = clients
        .filter((c) => allowed.includes(c.uuid) && (admin || !c.hidden))
        .sort((a, b) => a.weight - b.weight)
        .map((c) => {
          const r = results[c.uuid] || { uuid: c.uuid, name: c.name, targets: [] };
          const want = targetsFor(cfg, c.uuid);
          const vers = new Set(want.map((t) => t.v));
          const targets = (r.targets || []).filter((t) => vers.has(t.v || 4));
          // versions：這台伺服器有被選入哪些版本的檢測，頁面依此決定在 IPv4 / IPv6 分頁是否列出
          return Object.assign({}, r, { name: c.name, targets, versions: [...vers].sort(), running: !!running[c.uuid] });
        });
      json(res, 200, { admin, interval: cfg.interval, nodes });
    } catch (e) {
      json(res, 500, { error: e.message || String(e) });
    }
  });

  // 立即檢測（僅管理員）：?uuid=xxx 或不帶參數全部
  // 浮動按鈕是否顯示：開關開著，且訪客可看結果（或登入的管理員）
  server.route("GET", "/api/cnroute/button", async (req, res) => {
    try {
      const cfg = await getCfg();
      const show = cfg.floatButton && (cfg.publicData || isAdmin(req));
      json(res, 200, { show, position: cfg.floatPosition });
    } catch (e) {
      json(res, 200, { show: false });
    }
  });

  // 浮動按鈕注入到所有 HTML 頁面，由 float.js 自行判斷只在前台顯示；開關在執行時讀取，不用重載插件
  // 非 ASCII 字元轉成 \uXXXX，不受主題頁面編碼影響
  const floatSafe = FLOAT_JS.replace(/<\/script/gi, "<\\/script").replace(/[^\x00-\x7f]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  server.injectHTML("", "<script>" + floatSafe + "</script>");

  server.route("POST", "/api/cnroute/run", async (req, res) => {
    if (!isAdmin(req)) return json(res, 403, { error: "僅管理員可觸發" });
    try {
      const cfg = await getCfg();
      const want = await selectedNodes(cfg);
      const u = req.query && req.query.uuid;
      const target = u ? want.filter((x) => x === (Array.isArray(u) ? u[0] : u)) : want;
      const r = await probe(target);
      json(res, 200, { started: r.started, busy: r.busy, task_id: r.task_id, error: r.error });
    } catch (e) {
      json(res, 500, { error: e.message || String(e) });
    }
  });

  // 每分鐘檢查一次是否到了設定的間隔
  server.cron("@every 1m", async () => {
    try {
      const cfg = await getCfg();
      if (Date.now() - lastAutoRun < cfg.interval * 60 * 1000) return;
      lastAutoRun = Date.now();
      await probe(await selectedNodes(cfg), { notifyChanges: true });
    } catch (e) {
      log("排程失敗", e.message || String(e));
    }
  });

  // 啟用後 30 秒做第一次檢測
  setTimeout(async () => {
    try {
      const cfg = await getCfg();
      lastAutoRun = Date.now();
      await probe(await selectedNodes(cfg));
    } catch (e) { log("首次檢測失敗", e.message || String(e)); }
  }, 30000);

  telegram.start({
    server, lib, log, sleep, getCfg, listClients, selectedNodes, probe,
    getResults: () => results,
    isRunning: (u) => !!running[u],
    storeDir: typeof __storageDir__ === "string" ? __storageDir__ : ".",
  });

  log("已載入");
}

function unload() {
  telegram.stop();
  saveStore();
}
