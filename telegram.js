// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 MbaoWang
// komari-cnroute Telegram 機器人：長輪詢接收指令，遠端觸發回程檢測並回報結果
// 僅回應設定中允許的 chat id / user id。

let deps = null;
let gen = 0;
let offset = 0;
let lastToken = "";

const HELP = [
  "<b>回程路由檢測機器人</b>",
  "",
  "/list — 伺服器列表與目前線路",
  "/route &lt;伺服器&gt; — 查看最近一次結果",
  "/trace &lt;伺服器|all&gt; — 立即檢測回程",
  "/trace &lt;伺服器&gt; &lt;IP&gt; — 檢測到自訂 IP 的路徑",
  "/status — 執行狀態",
  "/id — 顯示你的 chat id",
  "",
  "&lt;伺服器&gt; 可填 /list 中的編號、名稱關鍵字或 UUID 開頭。",
].join("\n");

function esc(s) {
  return String(s === undefined || s === null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function ago(iso) {
  if (!iso) return "尚未檢測";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + " 秒前";
  if (s < 3600) return Math.round(s / 60) + " 分鐘前";
  if (s < 86400) return Math.round(s / 3600) + " 小時前";
  return Math.round(s / 86400) + " 天前";
}

const ISP_ICON = { ct: "🔵", cu: "🔴", cm: "🟢" };

// ---------- Telegram API ----------

async function api(cfg, method, body) {
  const r = await fetch(`${cfg.tgApi}/bot${cfg.tgToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.description || r.status}`);
  return j.result;
}

// 超過 Telegram 4096 字元上限時按行切開
function chunks(text) {
  const out = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur.length + line.length + 1 > 3800) { out.push(cur); cur = ""; }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur) out.push(cur);
  return out;
}

async function send(cfg, chatId, text, extra) {
  const parts = chunks(text);
  let last = null;
  for (let i = 0; i < parts.length; i++) {
    const body = Object.assign({ chat_id: chatId, text: parts[i], parse_mode: "HTML", disable_web_page_preview: true }, i === parts.length - 1 ? extra || {} : {});
    last = await api(cfg, "sendMessage", body);
  }
  return last;
}

// 優先編輯原訊息，太長或失敗時改為發新訊息
async function replace(cfg, chatId, messageId, text, extra) {
  const parts = chunks(text);
  if (messageId && parts.length === 1) {
    try {
      return await api(cfg, "editMessageText", Object.assign({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true }, extra || {}));
    } catch (_) { /* 落到 send */ }
  }
  return send(cfg, chatId, text, extra);
}

// ---------- 格式化 ----------

const CONF_ICON = { 確認: "", 推測: "（推測）", 不足: "（證據不足）" };

function tagOf(t) {
  const tag = (t.tags || [])[0] || "—";
  return tag + (t.route ? CONF_ICON[t.route.confidence] || "" : "");
}

function fmtNode(node, opts) {
  opts = opts || {};
  const src = [node.src_masked, node.src6_masked].filter(Boolean).map((x) => `<code>${esc(x)}</code>`).join(" ");
  const lines = [`🖥 <b>${esc(node.name)}</b>${src ? "  " + src : ""}`];
  lines.push(`🕒 ${esc(ago(node.updated_at))}${node.tool ? " · " + esc(node.tool) : ""}${opts.running ? " · ⏳ 檢測中" : ""}`);
  if (node.error) lines.push(`⚠️ ${esc(node.error)}`);
  const targets = node.targets || [];
  const hasV6 = targets.some((t) => t.v === 6);
  [4, 6].forEach((v) => {
    const list = targets.filter((t) => (t.v || 4) === v);
    if (!list.length) return;
    if (hasV6) lines.push("", `<b>— IPv${v} —</b>`);
    for (const t of list) {
      const rtt = t.last_rtt !== null && t.last_rtt !== undefined ? `${t.last_rtt} ms` : "—";
      lines.push("");
      if (t.error) { lines.push(`${ISP_ICON[t.isp] || "⚪️"} <b>${esc(t.label)}</b>  ⚠️ ${esc(t.error)}`); continue; }
      lines.push(`${ISP_ICON[t.isp] || "⚪️"} <b>${esc(t.label)}</b>  ${esc(tagOf(t))} · ${rtt}${t.reached === false ? " · 未到達" : ""}`);
      if (t.route && t.route.intl && t.route.intl.length) lines.push(`🌐 ${esc(t.route.intl_text)}`);
      lines.push(`<code>${esc(t.as_path || "")}</code>`);
    }
  });
  return lines.join("\n");
}

function fmtTarget(node, t) {
  const lines = [
    `🖥 <b>${esc(node.name)}</b> → ${ISP_ICON[t.isp] || "⚪️"} <b>${esc(t.label)}</b>${t.v === 6 ? " (IPv6)" : ""} <code>${esc(t.ip)}</code>`,
    `線路：<b>${esc(tagOf(t))}</b>${t.reached === false ? "（未到達）" : ""}`,
  ];
  if (t.route) {
    if (t.route.evidence) lines.push(`依據：${esc(t.route.evidence)}`);
    lines.push(`國際段：${esc(t.route.intl_text || "—")}`);
  }
  lines.push("");
  for (const s of t.segments || []) {
    const rtt = s.rtt_out !== null && s.rtt_out !== undefined ? ` · ${s.rtt_out} ms` : "";
    const name = s.name ? " " + esc(s.name) : "";
    const geo = s.geo ? ` (${esc(s.geo)})` : "";
    lines.push(`<b>${esc(s.key)}</b>${name}${geo}`);
    lines.push(`   ${s.hops} 跳${s.timeouts ? ` +${s.timeouts}*` : ""}${rtt}${s.ips && s.ips.length ? "  <code>" + esc(s.ips.join(" ")) + "</code>" : ""}`);
  }
  if (!(t.segments || []).length) lines.push(esc(t.error || "沒有資料"));
  return lines.join("\n");
}

function nodeButtons(node) {
  const rows = [];
  let row = [];
  (node.targets || []).forEach((t, i) => {
    row.push({ text: `${ISP_ICON[t.isp] || "⚪️"} ${t.label}${t.v === 6 ? " v6" : ""}`, callback_data: `d:${node.uuid}:${i}` });
    if (row.length === 3) { rows.push(row); row = []; }
  });
  if (row.length) rows.push(row);
  rows.push([{ text: "🔄 立即檢測", callback_data: `t:${node.uuid}` }]);
  return { reply_markup: { inline_keyboard: rows } };
}

// ---------- 指令 ----------

async function nodeList(cfg) {
  const clients = await deps.listClients();
  const allowed = await deps.selectedNodes(cfg);
  return clients.filter((c) => allowed.includes(c.uuid)).sort((a, b) => a.weight - b.weight);
}

async function findNode(cfg, q) {
  const list = await nodeList(cfg);
  q = String(q || "").trim();
  if (!q) return { list };
  if (/^\d+$/.test(q) && list[Number(q) - 1]) return { node: list[Number(q) - 1], list };
  const lq = q.toLowerCase();
  const exact = list.find((c) => c.name.toLowerCase() === lq || c.uuid === q);
  if (exact) return { node: exact, list };
  const m = list.filter((c) => c.name.toLowerCase().includes(lq) || c.uuid.startsWith(q));
  if (m.length === 1) return { node: m[0], list };
  return { list, ambiguous: m };
}

function storedNode(c) {
  return deps.getResults()[c.uuid] || { uuid: c.uuid, name: c.name, targets: [] };
}

async function cmdList(cfg, chatId) {
  const list = await nodeList(cfg);
  if (!list.length) return send(cfg, chatId, "沒有可檢測的伺服器。");
  const lines = ["<b>伺服器列表</b>", ""];
  const rows = [];
  list.forEach((c, i) => {
    const n = storedNode(c);
    const tags = [];
    for (const t of n.targets || []) {
      const tag = (t.tags || [])[0];
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
    lines.push(`${i + 1}. <b>${esc(c.name)}</b>${deps.isRunning(c.uuid) ? " ⏳" : ""}  <i>${esc(ago(n.updated_at))}</i>`);
    lines.push(`    ${esc(tags.join(" / ") || "尚無結果")}`);
    if (i < 30) rows.push([{ text: `${i + 1}. ${c.name}`, callback_data: `r:${c.uuid}` }]);
  });
  return send(cfg, chatId, lines.join("\n"), { reply_markup: { inline_keyboard: rows } });
}

async function resolveOrHint(cfg, chatId, q, usage) {
  if (!q) { await send(cfg, chatId, usage); return null; }
  const r = await findNode(cfg, q);
  if (r.node) return r.node;
  if (r.ambiguous && r.ambiguous.length) {
    await send(cfg, chatId, "符合多台伺服器，請說得更精確：\n" + r.ambiguous.map((c) => "• " + esc(c.name)).join("\n"));
  } else {
    await send(cfg, chatId, `找不到伺服器「${esc(q)}」，用 /list 查看。`);
  }
  return null;
}

async function cmdRoute(cfg, chatId, q) {
  const c = await resolveOrHint(cfg, chatId, q, "用法：/route &lt;伺服器&gt;");
  if (!c) return;
  const n = storedNode(c);
  n.name = c.name;
  return send(cfg, chatId, fmtNode(n, { running: deps.isRunning(c.uuid) }), nodeButtons(n));
}

async function cmdTrace(cfg, chatId, args) {
  const [q, ip] = args;
  if (!q) return send(cfg, chatId, "用法：/trace &lt;伺服器|all&gt; [IP]");

  // 自訂 IP
  if (ip) {
    if (!cfg.tgAllowCustom) return send(cfg, chatId, "管理員已關閉自訂 IP 檢測。");
    if (!/^(\d{1,3}(\.\d{1,3}){3}|[0-9a-fA-F:]+:[0-9a-fA-F:]*)$/.test(ip)) return send(cfg, chatId, "IP 格式不正確（僅支援 IPv4 / IPv6，不支援網域）。");
    const c = await resolveOrHint(cfg, chatId, q, "");
    if (!c) return;
    const target = { id: "c0", v: ip.includes(":") ? 6 : 4, label: "自訂 " + ip, ip, port: 80, proto: "icmp", isp: "" };
    const msg = await send(cfg, chatId, `⏳ <b>${esc(c.name)}</b> → <code>${esc(ip)}</code> 檢測中…`);
    const r = await deps.probe([c.uuid], { targets: [target], store: false });
    if (!r.started.length) return replace(cfg, chatId, msg.message_id, r.busy && r.busy.length ? "⏳ 這台伺服器正在檢測中，請稍後再試。" : `❌ 下發失敗：${esc(r.error || "伺服器離線")}`);
    const out = await r.done;
    const n = out[c.uuid];
    if (!n || !n.targets || !n.targets.length) return replace(cfg, chatId, msg.message_id, `❌ ${esc(c.name)}：${esc((n && n.error) || "沒有結果")}`);
    return replace(cfg, chatId, msg.message_id, fmtTarget(n, n.targets[0]));
  }

  // 標準目標
  let nodes;
  if (q.toLowerCase() === "all") {
    nodes = await nodeList(cfg);
  } else {
    const c = await resolveOrHint(cfg, chatId, q, "");
    if (!c) return;
    nodes = [c];
  }
  const names = nodes.map((c) => c.name).join("、");
  const msg = await send(cfg, chatId, `⏳ 已下發回程檢測：${esc(names)}\n約需 1～3 分鐘…`);
  const r = await deps.probe(nodes.map((c) => c.uuid), { notifyChanges: false });
  if (!r.started.length) {
    return replace(cfg, chatId, msg.message_id, r.busy && r.busy.length ? "⏳ 伺服器正在檢測中，請稍後再用 /route 查看。" : `❌ 下發失敗：${esc(r.error || "伺服器離線")}`);
  }
  const out = await r.done;
  const uuids = Object.keys(out);
  if (uuids.length === 1) {
    const n = out[uuids[0]];
    return replace(cfg, chatId, msg.message_id, fmtNode(n), nodeButtons(n));
  }
  await replace(cfg, chatId, msg.message_id, `✅ 完成 ${uuids.length} 台：${esc(names)}`);
  for (const u of uuids) await send(cfg, chatId, fmtNode(out[u]), nodeButtons(out[u]));
}

async function cmdStatus(cfg, chatId) {
  const list = await nodeList(cfg);
  const busy = list.filter((c) => deps.isRunning(c.uuid)).map((c) => c.name);
  const lines = [
    "<b>狀態</b>",
    `伺服器：${list.length} 台`,
    `IPv4：${cfg.v4Enabled ? `${cfg.targets4.length} 個目標，${cfg.nodes4.length ? cfg.nodes4.length + " 台伺服器" : "全部伺服器"}` : "關閉"}`,
    `IPv6：${cfg.v6Enabled ? `${cfg.targets6.length} 個目標，${cfg.nodes6.length ? cfg.nodes6.length + " 台伺服器" : "全部伺服器"}` : "關閉"}`,
    `自動檢測：每 ${cfg.interval} 分鐘`,
    `線路變更通知：${cfg.tgNotify ? "開啟" : "關閉"}`,
    `檢測中：${busy.length ? esc(busy.join("、")) : "無"}`,
  ];
  return send(cfg, chatId, lines.join("\n"));
}

function authorized(cfg, chatId, userId) {
  return cfg.tgChats.includes(String(chatId)) || (userId !== undefined && cfg.tgChats.includes(String(userId)));
}

async function handleMessage(cfg, msg) {
  const text = String(msg.text || "").trim();
  if (!text.startsWith("/")) return;
  const parts = text.split(/\s+/);
  const cmd = parts[0].slice(1).split("@")[0].toLowerCase();
  const args = parts.slice(1);
  const chatId = msg.chat.id;
  const userId = msg.from && msg.from.id;

  if (!authorized(cfg, chatId, userId)) {
    if (cmd === "start" || cmd === "id") {
      await send(cfg, chatId, `⛔️ 未授權。\nchat id：<code>${chatId}</code>\nuser id：<code>${userId}</code>\n請把其中一個填到 Komari 插件設定的「允許的 Chat ID」。`);
    }
    deps.log("拒絕未授權的 Telegram 請求", chatId, userId, cmd);
    return;
  }
  switch (cmd) {
    case "start":
    case "help": return send(cfg, chatId, HELP);
    case "id": return send(cfg, chatId, `chat id：<code>${chatId}</code>\nuser id：<code>${userId}</code>`);
    case "list": return cmdList(cfg, chatId);
    case "route": return cmdRoute(cfg, chatId, args.join(" "));
    case "trace": {
      // 最後一個參數像 IP 時視為自訂目標，其餘是伺服器名稱（名稱可含空白）
      const last = args[args.length - 1] || "";
      const isIP = args.length >= 2 && /^[0-9a-fA-F.:]+$/.test(last) && /[.:]/.test(last);
      return cmdTrace(cfg, chatId, isIP ? [args.slice(0, -1).join(" "), last] : [args.join(" ")]);
    }
    case "status": return cmdStatus(cfg, chatId);
    default: return send(cfg, chatId, "未知指令，輸入 /help 查看。");
  }
}

async function handleCallback(cfg, cq) {
  const chatId = cq.message && cq.message.chat.id;
  if (!chatId || !authorized(cfg, chatId, cq.from && cq.from.id)) {
    return api(cfg, "answerCallbackQuery", { callback_query_id: cq.id, text: "未授權" });
  }
  const [kind, uuid, idx] = String(cq.data || "").split(":");
  const list = await nodeList(cfg);
  const c = list.find((x) => x.uuid === uuid);
  if (!c) return api(cfg, "answerCallbackQuery", { callback_query_id: cq.id, text: "伺服器不存在" });
  if (kind === "t") {
    await api(cfg, "answerCallbackQuery", { callback_query_id: cq.id, text: "已下發檢測" });
    return cmdTrace(cfg, chatId, [String(list.indexOf(c) + 1)]);
  }
  await api(cfg, "answerCallbackQuery", { callback_query_id: cq.id });
  const n = storedNode(c);
  n.name = c.name;
  if (kind === "r") return send(cfg, chatId, fmtNode(n, { running: deps.isRunning(c.uuid) }), nodeButtons(n));
  if (kind === "d") {
    const t = (n.targets || [])[Number(idx)];
    if (!t) return send(cfg, chatId, "沒有這個目標的結果。");
    return send(cfg, chatId, fmtTarget(n, t));
  }
}

// ---------- 主迴圈 ----------

function loadOffset() {
  try { offset = JSON.parse(require("fs").readFileSync(deps.storeDir + "/telegram.json", "utf8")).offset || 0; } catch (_) { offset = 0; }
}
function saveOffset() {
  try { require("fs").writeFileSync(deps.storeDir + "/telegram.json", JSON.stringify({ offset })); } catch (_) {}
}

async function loop(my) {
  while (my === gen) {
    let cfg;
    try { cfg = await deps.getCfg(); } catch (_) { await deps.sleep(10000); continue; }
    if (!cfg.tgToken) { await deps.sleep(15000); continue; }
    if (cfg.tgToken !== lastToken) {
      lastToken = cfg.tgToken;
      try {
        const me = await api(cfg, "getMe");
        deps.log("Telegram 機器人已連線 @" + me.username);
        await api(cfg, "setMyCommands", {
          commands: [
            { command: "list", description: "伺服器列表與線路" },
            { command: "route", description: "查看某台伺服器的回程" },
            { command: "trace", description: "立即檢測回程 / 自訂 IP" },
            { command: "status", description: "執行狀態" },
            { command: "help", description: "說明" },
          ],
        });
      } catch (e) {
        deps.log("Telegram 連線失敗", e.message || String(e));
      }
    }
    try {
      const updates = await api(cfg, "getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] });
      for (const u of updates || []) {
        offset = u.update_id + 1;
        const job = u.message ? handleMessage(cfg, u.message) : u.callback_query ? handleCallback(cfg, u.callback_query) : null;
        if (job) job.catch((e) => deps.log("處理 Telegram 指令失敗", e.message || String(e)));
      }
      if (updates && updates.length) saveOffset();
    } catch (e) {
      if (my !== gen) return;
      deps.log("Telegram getUpdates 失敗", e.message || String(e));
      await deps.sleep(10000);
    }
  }
}

function start(d) {
  deps = d;
  loadOffset();
  gen++;
  lastToken = "";
  const my = gen;
  setTimeout(() => loop(my), 1000);
}

function stop() {
  gen++;
}

// 自動檢測後若主要線路改變，推播給所有允許的 chat
// 推播用的「線路摘要」：國內段只分辨到電信商，骨幹 / 省網的差異（例如 4134(163) 與 電信省網、
// 4837(169) 與 聯通省網、9808 與 移動省網）多半只是某一跳這次有沒有回應，不算線路變更。
// 有意義的部分：交接業者、接入方式、入境網路（CN2 GIA / GT、CTGNet、9929、10099、CMIN2、CMI）、途中轉給哪家。
const GENERIC_NET = { "4134(163)": "電信", "4134": "電信", "電信省網": "電信", "4837(169)": "聯通", "4837": "聯通", "聯通省網": "聯通", "9808": "移動", "移動省網": "移動" };
const NET_FAMILY = { CTGNet: "電信", "CN2 GIA": "電信", "CN2 GT": "電信", CN2: "電信", "9929": "聯通", "10099": "聯通", CMIN2: "移動", CMI: "移動" };
function routeSummary(t) {
  const r = t.route;
  if (!r || !r.chip) return null; // 舊格式的結果不比較，避免插件更新後誤報
  const withTransit = r.connect === "long_haul" || r.connect === "local_transit";
  const nets = (r.chain || []).slice(withTransit ? 1 : 0);
  const classes = [];
  for (const n of nets) {
    const generic = GENERIC_NET[n];
    const fam = generic || NET_FAMILY[n] || n;
    const prev = classes[classes.length - 1];
    // 同一家：精品網之後接自家骨幹 / 省網、或連續的一般網路，都只算一段
    if (prev && prev.fam === fam && (generic || prev.name === n)) continue;
    classes.push({ fam, name: generic ? { 電信: "電信 163", 聯通: "聯通 4837", 移動: "移動 9808" }[fam] : n });
  }
  return {
    transit: r.handover || "",
    connect: r.connect || "",
    entry: classes.length ? classes[0].name : "",
    carriers: classes.map((c) => c.fam).join("→"),
    key: [r.connect, r.handover || "", classes.map((c) => c.name).join("→")].join("|"),
  };
}

function describeChange(a, b) {
  const parts = [];
  if (a.transit !== b.transit) parts.push(`交接業者：${a.transit || "無（直連）"} → ${b.transit || "無（直連）"}`);
  if (a.connect !== b.connect) {
    const name = { direct: "直連", overseas_transit: "海外交接", local_transit: "當地交接", long_haul: "長途承載" };
    parts.push(`接入方式：${name[a.connect] || a.connect} → ${name[b.connect] || b.connect}`);
  }
  if (a.entry !== b.entry) parts.push(`入境網路：${a.entry} → ${b.entry}`);
  else if (a.carriers !== b.carriers) parts.push(`途經電信商：${a.carriers} → ${b.carriers}`);
  return parts;
}

async function notifyChange(prev, node) {
  if (!deps || !prev || !prev.targets || !prev.targets.length) return;
  const cfg = await deps.getCfg();
  if (!cfg.tgToken || !cfg.tgNotify || !cfg.tgChats.length) return;
  const key = (t) => t.label + "|" + (t.v || 4);
  const before = {};
  for (const t of prev.targets) before[key(t)] = t;
  const blocks = [];
  for (const t of node.targets || []) {
    const old = before[key(t)];
    if (!old) continue;
    const a = routeSummary(old);
    const b = routeSummary(t);
    if (!a || !b || a.key === b.key) continue;
    const lineOf = (x) => `${x.route.chip}（${x.route.access}）`;
    blocks.push([
      `${ISP_ICON[t.isp] || "⚪️"} <b>${esc(t.label)}${t.v === 6 ? " (IPv6)" : ""}</b>`,
      ...describeChange(a, b).map((x) => `　• ${esc(x)}`),
      `　原本：${esc(lineOf(old))}`,
      `　現在：<b>${esc(lineOf(t))}</b>`,
    ].join("\n"));
  }
  if (!blocks.length) return;
  const text = `⚠️ <b>${esc(node.name)}</b> 回程線路變更\n\n${blocks.join("\n\n")}`;
  for (const chat of cfg.tgChats) {
    try { await send(cfg, chat, text, nodeButtons(node)); } catch (e) { deps.log("推播失敗", chat, e.message || String(e)); }
  }
}

module.exports = { start, stop, notifyChange, fmtNode, fmtTarget };
