// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 MbaoWang
// komari-cnroute Telegram 機器人：長輪詢接收指令，遠端觸發回程檢測並回報結果
// 僅回應設定中允許的 chat id / user id。
// 語系跟隨 Telegram 使用者自己的語言（message.from.language_code）；
// 主動推播時用該聊天最後一次互動的語言，沒有紀錄時用插件設定的預設語言。

const I18N = require("./page/i18n.js");

let deps = null;
let gen = 0;
let offset = 0;
let lastToken = "";
let chatLang = {}; // chat id → 最後一次互動的語言
let routeState = {}; // [nodeUuid][targetKey] → { confirmed, pending }（連續 2 輪確認防抖）

function esc(s) {
  return String(s === undefined || s === null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
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

// Telegram 4096 字元上限是「剝掉 HTML 標籤、還原實體後」的純文字長度
function plainLen(s) {
  return String(s).replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot);/g, "x").length;
}

// 超過 Telegram 4096 純文字字元上限時，優先按空白行（整個目標區塊）切開，單一區塊仍超長時再按行切
function chunks(text, limit = 3900) {
  const out = [];
  let cur = "";
  for (const block of String(text).split("\n\n")) {
    const sep = cur ? "\n\n" : "";
    if (plainLen(cur) + sep.length + plainLen(block) <= limit) {
      cur += sep + block;
    } else if (plainLen(block) <= limit) {
      if (cur) out.push(cur);
      cur = block;
    } else {
      const lines = block.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const lsep = cur ? (i === 0 ? "\n\n" : "\n") : "";
        if (cur && plainLen(cur) + lsep.length + plainLen(lines[i]) > limit) {
          out.push(cur);
          cur = lines[i];
        } else {
          cur += lsep + lines[i];
        }
      }
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
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

// ---------- 語言 ----------

function defaultLang(cfg) { return I18N.resolve(cfg && cfg.tgDefaultLang) || "zh-TW"; }
function langFor(cfg, chatId, from) {
  const l = I18N.resolve(from && from.language_code);
  if (l) {
    if (chatLang[chatId] !== l) { chatLang[chatId] = l; saveState(); }
    return l;
  }
  return chatLang[chatId] || defaultLang(cfg);
}

// ---------- 格式化 ----------

function targetName(L, t) { return I18N.targetLabel(L, t); }

// 一行線路：路徑 · 接入方式（推測 / 證據不足）
function lineText(L, t) {
  const r = t.route;
  if (!r) return (t.tags || [])[0] || "—";
  const conf = I18N.confText(L, r.confidence);
  return I18N.label(L, r) + I18N.paren(L, conf);
}

function fmtNode(L, node, opts) {
  opts = opts || {};
  const ver = opts.ver === 4 || opts.ver === 6 ? opts.ver : 0;
  const srcList = ver === 4 ? [node.src_masked] : ver === 6 ? [node.src6_masked] : [node.src_masked, node.src6_masked];
  const src = srcList.filter(Boolean).map((x) => `<code>${esc(x)}</code>`).join(" ");
  const verTag = ver ? ` · IPv${ver}` : "";
  const lines = [`🖥 <b>${esc(node.name)}</b>${verTag}${src ? "  " + src : ""}`];
  lines.push(`🕒 ${esc(I18N.ago(L, node.updated_at))}${node.tool ? " · " + esc(node.tool) : ""}${opts.running ? " · ⏳ " + esc(I18N.t(L, "page.running")) : ""}`);
  if (node.error && opts.showError !== false) lines.push(`⚠️ ${esc(I18N.error(L, node.error))}`);
  const targets = node.targets || [];
  const scoped = ver ? targets.filter((t) => (t.v || 4) === ver) : targets;
  const hasBig = scoped.some((t) => t.big);
  const showHeader = ver ? hasBig : (targets.some((t) => t.v === 6) || hasBig);
  const pairs = ver ? [[ver, false], [ver, true]] : [[4, false], [4, true], [6, false], [6, true]];
  // 分段：IPv4 / IPv6 × 標準 / 大包
  pairs.forEach(([v, big]) => {
    const list = targets.filter((t) => (t.v || 4) === v && !!t.big === big);
    if (!list.length) return;
    if (showHeader) {
      // 各目標 port 相同時標出 port，不同時（依各目標）只標封包大小
      const samePort = list.every((t) => t.port === list[0].port);
      const bigTxt = big ? " · " + I18N.t(L, samePort ? "big.desc" : "big.descAuto", { port: list[0].port, size: list[0].psize }) : "";
      lines.push("", `<b>— IPv${v}${esc(bigTxt)} —</b>`);
    }
    for (const t of list) {
      const rtt = t.last_rtt !== null && t.last_rtt !== undefined ? `${t.last_rtt} ms` : "—";
      lines.push("");
      if (t.error) { lines.push(`${ISP_ICON[t.isp] || "⚪️"} <b>${esc(targetName(L, t))}</b>  ⚠️ ${esc(I18N.error(L, t.error))}`); continue; }
      lines.push(`${ISP_ICON[t.isp] || "⚪️"} <b>${esc(targetName(L, t))}</b>  ${esc(lineText(L, t))} · ${rtt}${t.reached === false ? " · " + esc(I18N.t(L, "unreached")) : ""}`);
      if (t.route && t.route.intl && t.route.intl.length) lines.push(`🌐 ${esc(I18N.intl(L, t.route))}`);
      lines.push(`<code>${esc(t.as_path || "")}</code>`);
    }
  });
  return lines.join("\n");
}

function fmtTarget(L, node, t) {
  const lines = [
    `🖥 <b>${esc(node.name)}</b> → ${ISP_ICON[t.isp] || "⚪️"} <b>${esc(targetName(L, t))}</b>${t.v === 6 ? " (IPv6)" : ""} <code>${esc(t.ip)}</code>` +
      (t.big ? "\n📦 " + esc(I18N.t(L, "big.desc", { port: t.port, size: t.psize })) : ""),
    `${esc(I18N.t(L, "tg.line"))}: <b>${esc(lineText(L, t))}</b>${t.reached === false ? esc(I18N.paren(L, I18N.t(L, "unreached"))) : ""}`,
  ];
  if (t.route) {
    const ev = I18N.evidence(L, t.route);
    if (ev) lines.push(`${esc(I18N.t(L, "tg.why"))}: ${esc(ev)}`);
    lines.push(`${esc(I18N.t(L, "tg.intl"))}: ${esc(I18N.intl(L, t.route) || "—")}`);
  }
  lines.push("");
  for (const s of t.segments || []) {
    const rtt = s.rtt_out !== null && s.rtt_out !== undefined ? ` · ${I18N.segRtt(s)}` : "";
    const name = I18N.segName(L, s);
    const geo = s.geo ? ` (${esc(I18N.segGeo(s))}${s.geo_orig ? "；" + esc(I18N.t(L, "seg.geoFixed", { x: s.geo_orig })) : ""})` : "";
    const ips = (s.ips || []).map((x) => (x === "LAN" || x === "內網" ? I18N.t(L, "seg.lanIp") : x));
    lines.push(`<b>${esc(s.key)}</b>${name ? " " + esc(name) : ""}${geo}`);
    lines.push(`   ${esc(I18N.t(L, "page.hops", { n: s.hops }))}${s.timeouts ? ` +${s.timeouts}*` : ""}${rtt}${ips.length ? "  <code>" + esc(ips.join(" ")) + "</code>" : ""}`);
  }
  if (!(t.segments || []).length) lines.push(esc(t.error ? I18N.error(L, t.error) : I18N.t(L, "page.noData")));
  return lines.join("\n");
}

function nodeButtons(L, node, opts) {
  opts = opts || {};
  const ver = opts.ver === 4 || opts.ver === 6 ? opts.ver : 0;
  const withTrace = opts.withTrace !== false;
  const rows = [];
  let row = [];
  // Telegram 單則訊息 inline_keyboard 上限為 100 顆按鈕；有底部「立即檢測」時保留 1 顆
  const maxBtns = withTrace ? 99 : 100;
  const items = [];
  (node.targets || []).forEach((t, i) => {
    if (ver && (t.v || 4) !== ver) return;
    items.push({ t, i });
  });
  for (const { t, i } of items.slice(0, maxBtns)) {
    const vTag = !ver && t.v === 6 ? " v6" : "";
    row.push({ text: `${ISP_ICON[t.isp] || "⚪️"} ${targetName(L, t)}${vTag}${t.big ? " " + I18N.t(L, "big.short") : ""}`, callback_data: `d:${node.uuid}:${i}` });
    if (row.length === 3) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  if (withTrace) rows.push([{ text: I18N.t(L, "tg.btnTrace"), callback_data: `t:${node.uuid}` }]);
  return rows.length ? { reply_markup: { inline_keyboard: rows } } : {};
}

// 雙棧節點分兩則訊息送出：IPv4（標準＋大包）一則、IPv6（標準＋大包）一則；
// 單棧或無目標時維持一則。若有 replaceMessageId，第一則優先編輯原訊息。
async function sendNode(cfg, L, chatId, node, opts) {
  opts = opts || {};
  const targets = node.targets || [];
  const hasV4 = targets.some((t) => (t.v || 4) === 4);
  const hasV6 = targets.some((t) => t.v === 6);
  const sendFirst = (text, extra) => opts.replaceMessageId
    ? replace(cfg, chatId, opts.replaceMessageId, text, extra)
    : send(cfg, chatId, text, extra);
  if (hasV4 && hasV6) {
    await sendFirst(
      fmtNode(L, node, { running: opts.running, ver: 4 }),
      nodeButtons(L, node, { ver: 4, withTrace: false }),
    );
    return send(
      cfg,
      chatId,
      fmtNode(L, node, { running: opts.running, ver: 6, showError: false }),
      nodeButtons(L, node, { ver: 6, withTrace: true }),
    );
  }
  return sendFirst(fmtNode(L, node, { running: opts.running }), nodeButtons(L, node));
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

async function cmdList(cfg, L, chatId) {
  const list = await nodeList(cfg);
  if (!list.length) return send(cfg, chatId, I18N.t(L, "tg.noServers"));
  const lines = [I18N.t(L, "tg.listTitle"), ""];
  const rows = [];
  list.forEach((c, i) => {
    const n = storedNode(c);
    const tags = [];
    for (const t of n.targets || []) {
      if (t.error) continue;
      const tag = lineText(L, t);
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
    lines.push(`${i + 1}. <b>${esc(c.name)}</b>${deps.isRunning(c.uuid) ? " ⏳" : ""}  <i>${esc(I18N.ago(L, n.updated_at))}</i>`);
    lines.push(`    ${esc(tags.join(" / ") || I18N.t(L, "tg.noResultYet"))}`);
    if (i < 30) rows.push([{ text: `${i + 1}. ${c.name}`, callback_data: `r:${c.uuid}` }]);
  });
  return send(cfg, chatId, lines.join("\n"), { reply_markup: { inline_keyboard: rows } });
}

async function resolveOrHint(cfg, L, chatId, q, usage) {
  if (!q) { await send(cfg, chatId, usage); return null; }
  const r = await findNode(cfg, q);
  if (r.node) return r.node;
  if (r.ambiguous && r.ambiguous.length) {
    await send(cfg, chatId, I18N.t(L, "tg.ambiguous") + "\n" + r.ambiguous.map((c) => "• " + esc(c.name)).join("\n"));
  } else {
    await send(cfg, chatId, I18N.t(L, "tg.notFound", { x: esc(q) }));
  }
  return null;
}

async function cmdRoute(cfg, L, chatId, q) {
  const c = await resolveOrHint(cfg, L, chatId, q, I18N.t(L, "tg.usageRoute"));
  if (!c) return;
  const n = storedNode(c);
  n.name = c.name;
  return sendNode(cfg, L, chatId, n, { running: deps.isRunning(c.uuid) });
}

async function cmdTrace(cfg, L, chatId, args) {
  const [q, ip] = args;
  if (!q) return send(cfg, chatId, I18N.t(L, "tg.usageTrace"));
  const failText = (r) => I18N.t(L, "tg.dispatchFail", { x: esc(r.error ? I18N.error(L, r.error) : I18N.t(L, "tg.offline")) });

  // 自訂 IP
  if (ip) {
    if (!cfg.tgAllowCustom) return send(cfg, chatId, I18N.t(L, "tg.customOff"));
    if (!deps.lib.isIP(ip)) return send(cfg, chatId, I18N.t(L, "tg.badIp"));
    const c = await resolveOrHint(cfg, L, chatId, q, "");
    if (!c) return;
    const target = { id: "c0", v: ip.includes(":") ? 6 : 4, label: ip, custom: ip, ip, port: 80, proto: "icmp", isp: "" };
    const msg = await send(cfg, chatId, I18N.t(L, "tg.tracingCustom", { node: esc(c.name), ip: esc(ip) }));
    const r = await deps.probe([c.uuid], { targets: [target], store: false });
    if (!r.started.length) return replace(cfg, chatId, msg.message_id, r.busy && r.busy.length ? I18N.t(L, "tg.busyOne") : failText(r));
    const out = await r.done;
    const n = out[c.uuid];
    if (!n || !n.targets || !n.targets.length) {
      return replace(cfg, chatId, msg.message_id, `❌ ${esc(c.name)}: ${esc(n && n.error ? I18N.error(L, n.error) : I18N.t(L, "err.noResult"))}`);
    }
    return replace(cfg, chatId, msg.message_id, fmtTarget(L, n, n.targets[0]));
  }

  // 標準目標
  let nodes;
  if (q.toLowerCase() === "all") {
    nodes = await nodeList(cfg);
  } else {
    const c = await resolveOrHint(cfg, L, chatId, q, "");
    if (!c) return;
    nodes = [c];
  }
  const names = nodes.map((c) => c.name).join(I18N.t(L, "list.sep"));
  const msg = await send(cfg, chatId, I18N.t(L, "tg.tracing", { x: esc(names) }));
  const r = await deps.probe(nodes.map((c) => c.uuid), { notifyChanges: false });
  if (!r.started.length) return replace(cfg, chatId, msg.message_id, r.busy && r.busy.length ? I18N.t(L, "tg.busy") : failText(r));
  const out = await r.done;
  const uuids = Object.keys(out);
  if (uuids.length === 1) {
    return sendNode(cfg, L, chatId, out[uuids[0]], { replaceMessageId: msg.message_id });
  }
  await replace(cfg, chatId, msg.message_id, I18N.t(L, "tg.done", { n: uuids.length, x: esc(names) }));
  for (const u of uuids) await sendNode(cfg, L, chatId, out[u]);
}

async function cmdStatus(cfg, L, chatId) {
  const list = await nodeList(cfg);
  const busy = list.filter((c) => deps.isRunning(c.uuid)).map((c) => c.name);
  const ver = (on, targets, nodes) => on
    ? I18N.t(L, "tg.statusVOn", { t: targets.length, s: nodes.length ? I18N.t(L, "tg.statusN", { n: nodes.length }) : I18N.t(L, "tg.statusAll") })
    : I18N.t(L, "tg.off");
  const lines = [
    I18N.t(L, "tg.statusTitle"),
    I18N.t(L, "tg.statusServers", { n: list.length }),
    I18N.t(L, "tg.statusV", { v: 4, x: ver(cfg.v4Enabled, cfg.targets4, cfg.nodes4) }),
    I18N.t(L, "tg.statusV", { v: 6, x: ver(cfg.v6Enabled, cfg.targets6, cfg.nodes6) }),
    I18N.t(L, "page.modeBig") + ": " + (cfg.bigEnabled ? I18N.t(L, cfg.bigPort ? "big.desc" : "big.descAuto", { port: cfg.bigPort, size: cfg.bigPsize }) : I18N.t(L, "tg.off")),
    I18N.t(L, "tg.statusInterval", { n: cfg.interval }),
    I18N.t(L, "tg.statusNotify", { x: I18N.t(L, cfg.tgNotify ? "tg.on" : "tg.off") }),
    I18N.t(L, "tg.statusBusy", { x: busy.length ? esc(busy.join(I18N.t(L, "list.sep"))) : I18N.t(L, "tg.nothing") }),
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
      const L = I18N.resolve(msg.from && msg.from.language_code) || defaultLang(cfg);
      await send(cfg, chatId, I18N.t(L, "tg.unauth", { chat: chatId, user: userId }));
    }
    deps.log("拒絕未授權的 Telegram 請求", chatId, userId, cmd);
    return;
  }
  const L = langFor(cfg, chatId, msg.from);
  switch (cmd) {
    case "start":
    case "help": return send(cfg, chatId, I18N.t(L, "tg.help"));
    case "id": return send(cfg, chatId, I18N.t(L, "tg.id", { chat: chatId, user: userId }));
    case "list": return cmdList(cfg, L, chatId);
    case "route": return cmdRoute(cfg, L, chatId, args.join(" "));
    case "trace": {
      // 最後一個參數像 IP（有效 IPv4 / IPv6，或四段數字 / 含冒號）時視為自訂目標，其餘是伺服器名稱（名稱可含空白）
      const last = args[args.length - 1] || "";
      const isIP = args.length >= 2 && (deps.lib.isIP(last) || /^\d+\.\d+\.\d+\.\d+$/.test(last) || (/^[0-9a-fA-F:]+$/.test(last) && last.includes(":")));
      return cmdTrace(cfg, L, chatId, isIP ? [args.slice(0, -1).join(" "), last] : [args.join(" ")]);
    }
    case "status": return cmdStatus(cfg, L, chatId);
    default: return send(cfg, chatId, I18N.t(L, "tg.unknown"));
  }
}

async function handleCallback(cfg, cq) {
  const chatId = cq.message && cq.message.chat.id;
  const L0 = I18N.resolve(cq.from && cq.from.language_code) || defaultLang(cfg);
  if (!chatId || !authorized(cfg, chatId, cq.from && cq.from.id)) {
    return api(cfg, "answerCallbackQuery", { callback_query_id: cq.id, text: I18N.t(L0, "tg.cbUnauth") });
  }
  const L = langFor(cfg, chatId, cq.from);
  const [kind, uuid, idx] = String(cq.data || "").split(":");
  const list = await nodeList(cfg);
  const c = list.find((x) => x.uuid === uuid);
  if (!c) return api(cfg, "answerCallbackQuery", { callback_query_id: cq.id, text: I18N.t(L, "tg.cbNoServer") });
  if (kind === "t") {
    await api(cfg, "answerCallbackQuery", { callback_query_id: cq.id, text: I18N.t(L, "tg.ok") });
    return cmdTrace(cfg, L, chatId, [String(list.indexOf(c) + 1)]);
  }
  await api(cfg, "answerCallbackQuery", { callback_query_id: cq.id });
  const n = storedNode(c);
  n.name = c.name;
  if (kind === "r") return sendNode(cfg, L, chatId, n, { running: deps.isRunning(c.uuid) });
  if (kind === "d") {
    const t = (n.targets || [])[Number(idx)];
    if (!t) return send(cfg, chatId, I18N.t(L, "tg.noTarget"));
    return send(cfg, chatId, fmtTarget(L, n, t));
  }
}

// ---------- 主迴圈 ----------

function loadState() {
  try {
    const s = JSON.parse(require("fs").readFileSync(deps.storeDir + "/telegram.json", "utf8"));
    offset = s.offset || 0;
    chatLang = s.lang || {};
    routeState = s.routes && typeof s.routes === "object" ? s.routes : {};
  } catch (_) { offset = 0; chatLang = {}; routeState = {}; }
}
function saveState() {
  try { require("fs").writeFileSync(deps.storeDir + "/telegram.json", JSON.stringify({ offset, lang: chatLang, routes: routeState })); } catch (_) {}
}

// 指令說明依 Telegram 使用者語言顯示（language_code 只能是兩碼，zh 依預設語言決定繁 / 簡）
async function setCommands(cfg) {
  const cmds = (L) => ["list", "route", "trace", "status", "help"].map((c) => ({ command: c, description: I18N.t(L, "tg.cmd." + c) }));
  const def = defaultLang(cfg);
  await api(cfg, "setMyCommands", { commands: cmds(def) });
  const zh = def === "zh-CN" ? "zh-CN" : "zh-TW";
  for (const [code, L] of [["en", "en"], ["ja", "ja"], ["zh", zh]]) {
    try { await api(cfg, "setMyCommands", { commands: cmds(L), language_code: code }); } catch (_) {}
  }
}

async function loop(my) {
  while (my === gen) {
    let cfg;
    try { cfg = await deps.getCfg(); } catch (_) { await deps.sleep(10000); continue; }
    if (!cfg.tgToken) { await deps.sleep(15000); continue; }
    const tokenKey = cfg.tgToken + "|" + defaultLang(cfg);
    if (tokenKey !== lastToken) {
      lastToken = tokenKey;
      try {
        const me = await api(cfg, "getMe");
        deps.log("Telegram 機器人已連線 @" + me.username);
        await setCommands(cfg);
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
      if (updates && updates.length) saveState();
    } catch (e) {
      if (my !== gen) return;
      deps.log("Telegram getUpdates 失敗", e.message || String(e));
      await deps.sleep(10000);
    }
  }
}

function start(d) {
  deps = d;
  loadState();
  gen++;
  lastToken = "";
  const my = gen;
  setTimeout(() => loop(my), 1000);
}

function stop() {
  gen++;
}

// ---------- 線路變更推播 ----------
// 推播用的「線路摘要」：國內段只分辨到電信商，骨幹 / 省網的差異（例如 4134(163) 與 電信省網、
// 4837(169) 與 聯通省網、9808 與 移動省網）多半只是某一跳這次有沒有回應，不算線路變更。
// 有意義的部分：交接業者、接入方式、入境網路（CN2 GIA / GT、CTGNet、9929、10099、CMIN2、CMI）、途中轉給哪家。
const GENERIC_NET = {
  "4134(163)": "ct", "4134": "ct", "prov:ct": "ct", "電信省網": "ct",
  "4837(169)": "cu", "4837": "cu", "prov:cu": "cu", "聯通省網": "cu",
  "9808": "cm", "prov:cm": "cm", "移動省網": "cm",
};
const NET_FAMILY = { CTGNet: "ct", "CN2 GIA": "ct", "CN2 GT": "ct", CN2: "ct", "9929": "cu", "10099": "cu", CMIN2: "cm", CMI: "cm" };
function routeSummary(t) {
  const r = t && t.route;
  if (!r || !r.chip) return null; // 舊格式的結果不比較，避免插件更新後誤報
  if (r.connect === "unknown" || r.connect === "none" || r.intl_unknown || r.confidence === "insufficient") return null; // 查無 AS、未入三網或證據不足（例如單跳 CN2）不比較，避免誤報
  // 第一行開頭是交接業者時先去掉（交接業者另外比較）
  const withTransit = !!r.handover && (r.chain || [])[0] === r.handover;
  const nets = (r.chain || []).slice(withTransit ? 1 : 0);
  const classes = [];
  for (const n of nets) {
    const generic = GENERIC_NET[n];
    const fam = generic || NET_FAMILY[n] || n;
    const prev = classes[classes.length - 1];
    // 同一家：精品網之後接自家骨幹 / 省網、或連續的一般網路，都只算一段
    if (prev && prev.fam === fam && (generic || prev.name === n)) continue;
    classes.push({ fam, generic: !!generic, name: generic ? "generic:" + fam : n });
  }
  // 接入方式只區分「直連」與「轉接」，不因轉接細分（海外交接 / 當地交接 / 長途承載）漂移而誤報
  const conn = r.connect === "direct" ? "direct" : "transit";
  return {
    transit: r.handover || "",
    connect: conn,
    classes,
    key: [conn, r.handover || "", classes.map((c) => c.name).join("→")].join("|"),
  };
}

function snapshotRoute(r) {
  return { chain: r.chain, chip: r.chip, connect: r.connect, handover: r.handover };
}

function describeChange(L, a, b) {
  const parts = [];
  const cls = (c) => (c ? (c.generic ? I18N.t(L, "tg.generic." + c.fam) : c.name) : "—");
  const fams = (x) => {
    const out = [];
    for (const c of x.classes) {
      const f = I18N.t(L, "carrier." + c.fam) || c.fam;
      if (out[out.length - 1] !== f) out.push(f);
    }
    return out.join("→");
  };
  const nets = (x) => x.classes.map(cls).join(" → ") || "—";
  const conn = (c) => (c === "overseas_transit" ? I18N.t(L, "tg.connect.overseas") : I18N.access(L, { connect: c }) || c || "—");
  if (a.transit !== b.transit) parts.push(I18N.t(L, "tg.chgTransit", { a: a.transit || I18N.t(L, "tg.noTransit"), b: b.transit || I18N.t(L, "tg.noTransit") }));
  if (a.connect !== b.connect) parts.push(I18N.t(L, "tg.chgConnect", { a: conn(a.connect), b: conn(b.connect) }));
  const ea = cls(a.classes[0]), eb = cls(b.classes[0]);
  if (ea !== eb) parts.push(I18N.t(L, "tg.chgEntry", { a: ea, b: eb }));
  else if (fams(a) !== fams(b)) parts.push(I18N.t(L, "tg.chgCarriers", { a: fams(a), b: fams(b) }));
  else if (nets(a) !== nets(b)) parts.push(I18N.t(L, "tg.chgRoute", { a: nets(a), b: nets(b) }));
  return parts;
}

async function notifyChange(prev, node) {
  if (!deps || !node || !node.targets || !node.targets.length) return;
  const cfg = await deps.getCfg();
  if (!cfg.tgToken || !cfg.tgNotify || !cfg.tgChats.length) return;
  const key = (t) => t.label + "|" + (t.v || 4) + (t.big ? "|big" : "");
  const before = {};
  for (const t of (prev && prev.targets) || []) before[key(t)] = t;
  const ns = routeState[node.uuid] || (routeState[node.uuid] = {});
  const changed = [];
  let dirty = false;
  for (const t of node.targets || []) {
    const k = key(t);
    const b = routeSummary(t);
    const st = ns[k];
    if (!b) {
      if (st && st.pending) { delete st.pending; dirty = true; }
      continue;
    }
    if (!st || !st.confirmed || !st.confirmed.summary) {
      const old = before[k];
      const a = old ? routeSummary(old) : null;
      if (a && a.key !== b.key) {
        ns[k] = { confirmed: { summary: a, route: snapshotRoute(old.route) }, pending: { key: b.key } };
      } else {
        ns[k] = { confirmed: { summary: b, route: snapshotRoute(t.route) } };
      }
      dirty = true;
      continue;
    }
    if (b.key === st.confirmed.summary.key) {
      st.confirmed.route = snapshotRoute(t.route);
      if (st.pending) delete st.pending;
      dirty = true;
      continue;
    }
    // 連續 2 輪出現相同新路線才視為真正變更並推播，避免單跳逾時造成誤報
    if (st.pending && st.pending.key === b.key) {
      changed.push({ t, oldRoute: st.confirmed.route, a: st.confirmed.summary, b });
      ns[k] = { confirmed: { summary: b, route: snapshotRoute(t.route) } };
      dirty = true;
    } else {
      st.pending = { key: b.key };
      dirty = true;
    }
  }
  if (dirty) saveState();
  if (!changed.length) return;
  for (const chat of cfg.tgChats) {
    const L = chatLang[chat] || defaultLang(cfg);
    const lineOf = (r) => I18N.chip(L, r) + I18N.paren(L, I18N.access(L, r));
    const blocks = changed.map(({ t, oldRoute, a, b }) => [
      `${ISP_ICON[t.isp] || "⚪️"} <b>${esc(targetName(L, t))}${t.v === 6 ? " (IPv6)" : ""}${t.big ? " · " + esc(I18N.t(L, "big.desc", { port: t.port, size: t.psize })) : ""}</b>`,
      ...describeChange(L, a, b).map((x) => `　• ${esc(x)}`),
      `　${esc(I18N.t(L, "tg.before"))}: ${esc(lineOf(oldRoute))}`,
      `　${esc(I18N.t(L, "tg.after"))}: <b>${esc(lineOf(t.route))}</b>`,
    ].join("\n"));
    const text = `${I18N.t(L, "tg.changed", { x: esc(node.name) })}\n\n${blocks.join("\n\n")}`;
    try { await send(cfg, chat, text, nodeButtons(L, node)); } catch (e) { deps.log("推播失敗", chat, e.message || String(e)); }
  }
}

module.exports = { start, stop, notifyChange, fmtNode, fmtTarget };
