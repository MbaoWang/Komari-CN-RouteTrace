// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 MbaoWang
// komari-cnroute 解析 / 遮罩 / AS 壓縮 / 線路判斷
// 可在 Komari 插件執行環境與 Node.js 中共用。

const PREFIX4 = require("./prefix4.js");
const PREFIX6 = require("./prefix6.js");

const I18N = require("./page/i18n.js");
// AS 名稱表在 page/i18n.js（中國三網依語系、國際業者各語系相同）；這裡保留繁中版本給舊程式使用
const AS_NAMES = {};
for (const k of Object.keys(I18N.INTL_AS)) AS_NAMES[k] = I18N.INTL_AS[k];
for (const k of Object.keys(I18N.CN_AS)) AS_NAMES[k] = I18N.CN_AS[k][0];

// ---- 骨幹網段（以網段為準，優先於追蹤工具查到的 ASN）----
// IPv4 / IPv6 都先用 bgp.tools 路由表的宣告前綴做最長前綴比對（prefix4.js / prefix6.js）。
// 骨幹路由器之間的互連位址常常不對外宣告（例如 CN2 的 59.43.0.0/16 在 BGP 上查不到），
// 這些才用下面的備援表（取自 oneclickvirt/backtrace）。
const PREFIX4_FALLBACK = [
  ["59.43.0.0", 16, 4809], // CN2 骨幹互連，未宣告
  ["69.194.160.0", 20, 23764], // CTGNet 骨幹互連，大部分未宣告（不可用整段 /16，以免誤蓋他網）
  ["203.22.176.0", 22, 23764], // CTGNet 香港骨幹互連，未宣告
  ["219.158.0.0", 17, 4837], // 聯通 169 骨幹互連，部分 /24 未宣告（128.0/17 屬 AS4808 會先命中 prefix4.js）
];
function v4(ip) {
  const s = String(ip);
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return null;
  const p = s.split(".").map(Number);
  return p.every((x) => x >= 0 && x <= 255) ? p : null;
}
function v4int(p) {
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
function inNet4(n, net, len) {
  if (len === 0) return true;
  const mask = len === 32 ? 0xffffffff : ((0xffffffff << (32 - len)) >>> 0);
  return ((n & mask) >>> 0) === ((net & mask) >>> 0);
}
const FALLBACK4 = PREFIX4_FALLBACK.map(([a, len, asn]) => [v4int(v4(a)), len, asn]);
// 依第一個位元組分桶（/8 以上的前綴才會放進桶），避免每次掃描整張表
const BUCKET4 = {};
const WIDE4 = [];
for (const e of PREFIX4) {
  if (e[1] >= 8) (BUCKET4[e[0] >>> 24] = BUCKET4[e[0] >>> 24] || []).push(e);
  else WIDE4.push(e);
}
function lookup4(n) {
  for (const [net, len, asn] of BUCKET4[n >>> 24] || []) if (inNet4(n, net, len)) return asn;
  for (const [net, len, asn] of WIDE4) if (inNet4(n, net, len)) return asn;
  for (const [net, len, asn] of FALLBACK4) if (inNet4(n, net, len)) return asn;
  return 0;
}
const BB_BY_ASN = { 4809: "cn2", 23764: "ctg", 58807: "cmin2", 58453: "cmi", 10099: "cug", 9929: "9929" };
// 展開 IPv6 成 8 組 4 位十六進位
function expand6(ip) {
  ip = String(ip).toLowerCase().split("%")[0];
  if (!ip.includes(":")) return null;
  const parts = ip.split("::");
  if (parts.length > 2) return null;
  const ha = parts[0] ? parts[0].split(":") : [];
  const hb = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 2 ? 8 - ha.length - hb.length : 0;
  if (parts.length === 2 && fill < 1) return null;
  const all = ha.concat(Array(fill).fill("0"), hb);
  if (all.length !== 8 || !all.every((x) => /^[0-9a-f]{1,4}$/.test(x))) return null;
  return all.map((x) => x.padStart(4, "0"));
}
function isIP(s) {
  s = String(s || "");
  return s.includes(":") ? expand6(s) !== null : v4(s) !== null;
}

// 回傳 { asn, bb }；bb 是骨幹種類（只有確定是骨幹網段時才有）
function prefixInfo(ip) {
  const p = v4(ip);
  if (p) {
    const asn = lookup4(v4int(p));
    if (!asn) return null;
    // AS4134 / 4837 / 9808 同時包含骨幹與省網：只有落在骨幹網段內才算骨幹
    let bb = BB_BY_ASN[asn] || "";
    if (asn === 4134 && p[0] === 202 && p[1] === 97) bb = "163";
    if (asn === 4837 && p[0] === 219 && p[1] === 158) bb = "169";
    if (asn === 9808 && ((p[0] === 221 && p[1] === 183) || (p[0] === 111 && p[1] === 24))) bb = "cmnet";
    return { asn, bb };
  }
  const h = expand6(ip);
  if (h) {
    let asn = lookup6(h.join(""));
    // 2400:9380::/32 是電信的骨幹 / 國際網設施段。bgp.tools 上的細分宣告：
    //   9xxx → AS4809（CN2）、axxx → AS23764（CTGNet）、8xxx → AS4134（163）。
    // 路由器互連位址的 /48 多半沒有宣告（例如香港的 2400:9380:a009::c），依同樣規則補上。
    if (!asn && h[0] === "2400" && h[1] === "9380") {
      asn = { "8": 4134, "9": 4809, a: 23764 }[h[2][0]] || 0;
    }
    if (!asn) return null;
    // AS4809 / 23764 / 58807 / 58453 / 10099 / 9929 只做骨幹或國際網，命中即可確認骨幹種類。
    // AS4134 / 4837 / 9808 的 IPv6 宣告是整片（例如 240e::/20），用以下骨幹設施段區分骨幹與省網：
    //   電信 163：240e:0::/32（骨幹互連，未宣告，相當於 IPv4 的 202.97）、2400:9380:8xxx
    //   移動 CMNET：2409:8080::/32（骨幹互連）
    let bb = BB_BY_ASN[asn] || "";
    if (asn === 4134 && ((h[0] === "240e" && h[1] === "0000") || (h[0] === "2400" && h[1] === "9380"))) bb = "163";
    if (asn === 9808 && h[0] === "2409" && h[1] === "8080") bb = "cmnet";
    //   聯通 169（4837）：2408:8000::/32（骨幹互連，相當於 IPv4 的 219.158）
    if (asn === 4837 && h[0] === "2408" && h[1] === "8000") bb = "169";
    return { asn, bb };
  }
  return null;
}

// IPv6 最長前綴比對（表格已依前綴長度由長到短排序，第一個命中的就是最長前綴）
// 依前 16 位元（4 個十六進位字元）分桶
const BUCKET6 = {};
const WIDE6 = [];
for (const e of PREFIX6) {
  if (e[1] >= 16) (BUCKET6[e[0].slice(0, 4)] = BUCKET6[e[0].slice(0, 4)] || []).push(e);
  else WIDE6.push(e);
}
function lookup6(hex32) {
  for (const [pfx, len, asn] of (BUCKET6[hex32.slice(0, 4)] || []).concat(WIDE6)) {
    const full = len >> 2;
    if (hex32.slice(0, full) !== pfx.slice(0, full)) continue;
    const rem = len & 3;
    if (rem) {
      const mask = (0xf << (4 - rem)) & 0xf;
      if ((parseInt(hex32[full], 16) & mask) !== (parseInt(pfx[full], 16) & mask)) continue;
    }
    return asn;
  }
  return 0;
}

function guessASN(ip) {
  const i = prefixInfo(ip);
  return i ? i.asn : 0;
}

// 三網 ASN 歸屬（含國際子網與部分省網）
const FAMILY_ASN = {
  ct: [4134, 4809, 23764, 4811, 4812, 4813, 4816, 23650, 23724],
  cu: [4837, 9929, 10099, 4808, 9800, 17621, 17622, 17623, 17816, 135061],
  cm: [9808, 58453, 58807, 24400, 56040, 56041, 56042, 56044, 56046, 56047, 56048],
};
const FAMILY_NAME = { ct: "電信", cu: "聯通", cm: "移動" };
function familyOf(asn, owner) {
  for (const f of Object.keys(FAMILY_ASN)) if (FAMILY_ASN[f].includes(asn)) return f;
  const o = String(owner || "");
  if (/china ?telecom|chinanet|中国电信|中國電信/i.test(o)) return "ct";
  if (/china ?unicom|cncgroup|中国联通|中國聯通/i.test(o)) return "cu";
  if (/china ?mobile|cmnet|中国移动|中國移動/i.test(o)) return "cm";
  return "";
}

function isPrivateIP(ip) {
  if (!ip) return false;
  if (ip.includes(":")) {
    const l = ip.toLowerCase();
    return l.startsWith("fe80") || l.startsWith("fc") || l.startsWith("fd") || l === "::1";
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => isNaN(x))) return false;
  return (
    p[0] === 10 ||
    p[0] === 127 ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || // CGNAT
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 169 && p[1] === 254)
  );
}

// 遮罩 IP：mode = "half"(保留前兩段) | "one"(保留第一段) | "full"(全隱藏)
function maskIP(ip, mode) {
  if (!ip) return "";
  mode = mode || "half";
  if (mode === "full") return ip.includes(":") ? "****:****:****:****" : "*.*.*.*";
  if (ip.includes(":")) {
    const h = expand6(ip);
    if (!h) return "****:****";
    const keep = mode === "one" ? 1 : 2;
    return h.slice(0, keep).map((x) => x.replace(/^0+/, "") || "0").join(":") + ":****:****";
  }
  const p = ip.split(".");
  if (p.length !== 4) return "***";
  return mode === "one" ? `${p[0]}.*.*.*` : `${p[0]}.${p[1]}.*.*`;
}

function normASN(v) {
  if (v === undefined || v === null) return 0;
  const m = String(v).match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function gi(o, ...keys) {
  if (!o || typeof o !== "object") return undefined;
  const low = {};
  for (const k of Object.keys(o)) low[k.toLowerCase()] = o[k];
  for (const k of keys) {
    const v = low[k.toLowerCase()];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

// ---- 各工具輸出 -> hops: [{ttl, ip, asn, owner, rtt, geo}] ----

function parseLines(text) {
  const hops = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("H|")) continue;
    const f = line.split("|");
    const ip = f[2] && f[2] !== "*" ? f[2] : "";
    hops.push({ ttl: Number(f[1]) || hops.length + 1, ip, asn: normASN(f[3]), owner: f[4] || "", rtt: num(f[5]), geo: f[6] || "" });
  }
  return hops;
}

function parseNtJSON(text) {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e < s) return [];
  let d;
  try { d = JSON.parse(text.slice(s, e + 1)); } catch (_) { return []; }
  const list = gi(d, "hops") || [];
  const hops = [];
  list.forEach((att, i) => {
    if (!Array.isArray(att)) att = [att];
    let hit = null;
    for (const a of att) {
      const addr = gi(a, "address");
      const ip = addr && typeof addr === "object" ? gi(addr, "ip") : addr;
      if (ip) { hit = { a, ip: String(ip) }; break; }
    }
    if (!hit) { hops.push({ ttl: i + 1, ip: "", asn: 0, owner: "", rtt: null, geo: "" }); return; }
    const geo = gi(hit.a, "geo") || {};
    const rtt = num(gi(hit.a, "rtt"));
    hops.push({
      ttl: Number(gi(hit.a, "ttl")) || i + 1,
      ip: hit.ip,
      asn: normASN(gi(geo, "asnumber", "asn")),
      owner: String(gi(geo, "owner", "isp", "whois") || ""),
      rtt: rtt === null ? null : Math.round(rtt / 1e5) / 10,
      geo: [gi(geo, "country"), gi(geo, "prov"), gi(geo, "city")].filter(Boolean).join(" "),
    });
  });
  return hops;
}

function parseMtrJSON(text) {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0) return [];
  let d;
  try { d = JSON.parse(text.slice(s, e + 1)); } catch (_) { return []; }
  const hubs = (d.report && d.report.hubs) || [];
  return hubs.map((h, i) => {
    const host = String(h.host || "");
    const ok = host && host !== "???";
    return { ttl: Number(h.count) || i + 1, ip: ok ? host : "", asn: normASN(h.ASN), owner: "", rtt: ok ? num(h.Avg) : null, geo: "" };
  });
}

function parseMtrText(text) {
  // "  5. AS4134   202.97.1.1   0.0%  2  10.1  10.2 ..."
  // "  2.|-- ???                 100.0  3   0.0   0.0 ..."（100% 丟包行無 % 符號）
  const hops = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(\d+)\.\s*(?:\|--)?\s+(AS\S+)?\s*(\S+)\s+([\d.]+)%?\s+\d+\s+([\d.]+)?\s*([\d.]+)?/);
    if (!m) continue;
    const ok = m[3] && m[3] !== "???";
    hops.push({ ttl: Number(m[1]), ip: ok ? m[3] : "", asn: normASN(m[2]), owner: "", rtt: ok ? num(m[6]) : null, geo: "" });
  }
  return hops;
}

function parseTraceroute(text) {
  // " 5  202.97.1.1 [AS4134]  10.123 ms"   " 6  *"
  const hops = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const rest = m[2];
    const ipm = rest.match(/(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F]*:[0-9a-fA-F:]+)/);
    const asm = rest.match(/\[(?:AS)?(\d+)[^\]]*\]/i);
    const rtm = rest.match(/([\d.]+)\s*ms/);
    hops.push({ ttl: Number(m[1]), ip: ipm ? ipm[1] : "", asn: asm ? Number(asm[1]) : 0, owner: "", rtt: rtm ? num(rtm[1]) : null, geo: "" });
  }
  return hops;
}

// nexttrace 的 IP 資料 API 連不上時，位置 / 業者欄位會變成「网络故障」等字樣，AS 也查不到。
// 清掉這些字樣（不當成地名），查不到 AS 的跳點標記 lookup_failed，之後由插件改用 RIPEstat 補查。
const LOOKUP_FAIL = /网络故障|網路故障|网络错误|網路錯誤|network\s*(error|failure)|api\s*error/i;
function cleanHops(hops) {
  for (const h of hops) {
    let failed = false;
    if (LOOKUP_FAIL.test(h.geo || "")) { h.geo = ""; failed = true; }
    if (LOOKUP_FAIL.test(h.owner || "")) { h.owner = ""; failed = true; }
    if (failed && h.ip && !h.asn) h.lookup_failed = true;
  }
  return hops;
}

function parseBlock(fmt, text) {
  return cleanHops(parseBlockRaw(fmt, text));
}
function parseBlockRaw(fmt, text) {
  switch (fmt) {
    case "lines": {
      const h = parseLines(text);
      return h.length ? h : parseNtJSON(text); // python 失敗時原樣回傳 JSON
    }
    case "ntjson": return parseNtJSON(text);
    case "mtrjson": return parseMtrJSON(text);
    case "mtrtxt": return parseMtrText(text);
    case "tr": return parseTraceroute(text);
  }
  return [];
}

// 解析整份 agent 輸出 -> { tool, error, blocks: {id: {ip, hops}} }
function parseOutput(output) {
  const res = { tool: "", error: "", blocks: {} };
  const lines = String(output || "").split("\n");
  let cur = null;
  let buf = [];
  for (const line of lines) {
    if (line.startsWith("##TOOL ")) { res.tool = line.slice(7).trim(); continue; }
    if (line.startsWith("##ERROR ")) { res.error = line.slice(8).trim(); continue; }
    const b = line.match(/^##BEGIN (\S+) (\S+) (\S+)/);
    if (b) { cur = { id: b[1], ip: b[2], fmt: b[3] }; buf = []; continue; }
    const e = line.match(/^##END (\S+)/);
    if (e && cur) {
      const note = (buf.find((l) => l.startsWith("##NOTE ")) || "").slice(7).trim();
      res.blocks[cur.id] = { ip: cur.ip, note, hops: parseBlock(cur.fmt, buf.join("\n")) };
      cur = null;
      continue;
    }
    if (cur) buf.push(line);
  }
  return res;
}

// ---- AS 壓縮 ----
function ip16(ip) {
  const s = String(ip || "");
  return s.includes(":") ? s.toLowerCase().split(":").slice(0, 2).join(":") : s.split(".").slice(0, 2).join(".");
}

// 純國際骨幹 / 區域轉接業者（不含雲端機房）：當本機機房第一跳是內網或逾時而漏掉時，
// 避免把這些業者誤當成本機機房 AS 丟棄或遮罩。
const TRANSIT_ONLY_AS = new Set([
  174, 209, 701, 702, 1239, 1273, 1299, 2497, 2516, 2828, 2914, 3257, 3320, 3356, 3491,
  3549, 3786, 4635, 4637, 4713, 4755, 4760, 4766, 5511, 6453, 6461, 6762, 6939, 7018,
  7473, 9002, 9304, 9318, 9498, 10026, 12956, 17676,
]);
function isOwnFirstAS(asn, firstPubIdx, opts) {
  if (!asn) return false;
  const srcASN = Number(opts && opts.srcASN) || 0;
  if (srcASN) {
    if (asn === srcASN) return true;
    if (firstPubIdx > 0 || TRANSIT_ONLY_AS.has(asn)) return false;
    return true;
  }
  if (firstPubIdx > 0 && TRANSIT_ONLY_AS.has(asn)) return false;
  return true;
}

// ---- 位置校正 ----
// nexttrace 標的位置有時是「註冊地」而非實際位置（例如香港註冊、實際在東京的 akari.hk 會標成「中国 香港」）。
// 光在光纖中每 1 ms 來回最多約 100 km，延遲和伺服器最近的跳點只差幾 ms 的跳點，一定和伺服器在同一個城市。
// 取這些近距離跳點多數不同網路（AS）標示的國家當作伺服器所在地，標成其他國家的改正，原本的標示留在 geo_orig。
const NEAR_MS = 5;
const MULTI_WORD_COUNTRIES = /^(united states|united kingdom|hong kong|south korea|north korea|new zealand|south africa|czech republic|saudi arabia|united arab emirates|costa rica|puerto rico|sri lanka)/i;
function geoCountry(g) {
  const s = String(g || "").trim();
  if (!s) return "";
  if (/^(中国|中國)\s+(台湾|台灣)/.test(s)) return "台湾";
  const mw = s.match(MULTI_WORD_COUNTRIES);
  if (mw) return mw[1].toLowerCase();
  return s.split(/\s+/)[0] || "";
}
function fixGeo(hops) {
  if (!Array.isArray(hops) || hops.some((h) => h && h.geo_orig !== undefined)) return hops;
  const pubRtt = hops.filter((h) => h && h.ip && !isPrivateIP(h.ip) && typeof h.rtt === "number").map((h) => h.rtt);
  if (!pubRtt.length) return hops;
  const base = Math.min(...pubRtt);
  const near = hops.filter((h) => h && h.ip && !isPrivateIP(h.ip) && h.geo && typeof h.rtt === "number" && h.rtt - base <= NEAR_MS);
  // 依不同網路（AS 或 /16）計票，避免單一機房連續多跳標錯註冊地就反過來蓋掉正確的上游業者位置
  const netsByCountry = {};
  for (const h of near) {
    const c = geoCountry(h.geo);
    if (!c) continue;
    const asn = guessASN(h.ip) || h.asn;
    const netId = asn ? "AS" + asn : ip16(h.ip);
    (netsByCountry[c] = netsByCountry[c] || new Set()).add(netId);
  }
  const ranked = Object.entries(netsByCountry).map(([c, s]) => [c, s.size]).sort((a, b) => b[1] - a[1]);
  // 至少兩個不同網路一致、而且比其他國家多，才算確定
  if (!ranked.length || ranked[0][1] < 2 || (ranked[1] && ranked[1][1] >= ranked[0][1])) return hops;
  const home = ranked[0][0];
  const full = {};
  for (const h of near) if (geoCountry(h.geo) === home) full[h.geo] = (full[h.geo] || 0) + 1;
  const homeGeo = Object.entries(full).sort((a, b) => b[1] - a[1])[0][0];
  return hops.map((h) => (near.includes(h) && geoCountry(h.geo) !== home ? Object.assign({}, h, { geo: homeGeo, geo_orig: h.geo }) : h));
}

// 把連續同 AS 的跳點合併成一段；逾時(*) 的跳點併入前一段計數；
// 內網段標為 LAN。第一個公網 AS（本機機房）內的 IP 會被遮罩。
function compressPath(hops, opts) {
  opts = opts || {};
  const maskMode = opts.maskMode || "half";
  const maskFirstAS = opts.maskFirstAS !== false;
  hops = fixGeo(hops);
  const segs = [];
  let lastRtt = null;
  let firstPubIdx = -1;
  for (let hi = 0; hi < hops.length; hi++) {
    const h = hops[hi];
    if (!h.ip) {
      if (segs.length) segs[segs.length - 1].timeouts++;
      continue;
    }
    const priv = isPrivateIP(h.ip);
    if (!priv && firstPubIdx < 0) firstPubIdx = hi;
    let asn = priv ? 0 : guessASN(h.ip) || h.asn;
    const key = priv ? "LAN" : asn ? "AS" + asn : "?";
    let seg = segs[segs.length - 1];
    // 未知 AS 的單跳夾在同一 AS 之間時視為同段；
    // AS 查詢失敗的跳點不併入前一段（否則國際業者的跳點會被當成本機機房而遮罩），同一個 /16 的連續跳點才合併
    const failedSplit = !priv && !asn && h.lookup_failed && seg && seg.last_ip && ip16(seg.last_ip) !== ip16(h.ip);
    if (!seg || failedSplit || (seg.key !== key && !(key === "?" && seg.key !== "LAN"))) {
      seg = {
        key,
        asn,
        owner: priv ? "" : h.owner || "",
        fam: priv ? "" : familyOf(asn, h.owner),
        name: priv ? "內網 / 本機閘道" : AS_NAMES[asn] || h.owner || (familyOf(asn) ? "中國" + FAMILY_NAME[familyOf(asn)] + " 當地網" : asn ? "" : "未知 AS"),
        hops: 0,
        timeouts: 0,
        ips: [],
        geo: "",
        rtt_in: h.rtt,
        rtt_out: h.rtt,
      };
      segs.push(seg);
    }
    const firstPublicSeg = segs.find((s) => s.key !== "LAN");
    const shouldMaskFirst = maskFirstAS && firstPublicSeg && (!firstPublicSeg.asn || isOwnFirstAS(firstPublicSeg.asn, firstPubIdx, opts));
    let shownIP = h.ip;
    if (priv) shownIP = "LAN";
    else if ((opts.srcIP && sameIP(h.ip, opts.srcIP)) || (shouldMaskFirst && seg === firstPublicSeg)) shownIP = maskIP(h.ip, maskMode);
    seg.hops++;
    if (!priv) seg.last_ip = h.ip;
    if (shownIP && !seg.ips.includes(shownIP) && seg.ips.length < 6) seg.ips.push(shownIP);
    if (!seg.name && h.owner) seg.name = h.owner;
    // geo_in：這段第一跳的位置，geo：最後一跳的位置（例如 CMI 從東京跨海到廣州）
    if (h.geo && !priv) { if (!seg.geo_in) seg.geo_in = h.geo; seg.geo = h.geo; seg.geo_orig = h.geo_orig || ""; }
    if (h.rtt !== null && h.rtt !== undefined) {
      if (seg.rtt_in === null || seg.rtt_in === undefined) seg.rtt_in = h.rtt;
      seg.rtt_out = h.rtt;
      lastRtt = h.rtt;
    }
  }
  // 第一公網段為本機機房時，地理位置也會暴露本機，一併隱藏
  if (maskFirstAS) {
    const s = segs.find((x) => x.key !== "LAN");
    if (s && (!s.asn || isOwnFirstAS(s.asn, firstPubIdx, opts))) { s.geo = ""; s.geo_in = ""; s.geo_orig = ""; }
  }
  for (const s of segs) delete s.last_ip;
  return { segments: segs, last_rtt: lastRtt };
}

// ---- 線路判斷 ----
// 1. 找出回程「第一個進入的中國三網」(入境點)，線路只看這一段，
//    之後在境內轉交其他電信商的部分不算（例如 163 入境再轉聯通 4837，線路是 163，不是 4837）。
// 2. 同一家的骨幹之後交給當地省網是正常的（例如 CN2 GIA 最後交 AS4134 省網 / AS4812），不影響判斷。
// 3. 入境前經過的國際 AS 依序列出。
// 標籤用的短名稱：「Lumen (Level3)」→「Lumen」，沒有名稱就用 AS 號
function shortName(asn, name) {
  let n = String(AS_NAMES[asn] || name || "").replace(/\s*\(.*\)\s*$/, "").trim();
  const dom = n.match(/^(?:www\.)?([a-z0-9-]+)\.(?:com|net|org|io|co|jp|hk|sg|us|de|uk)(?:\.[a-z]{2})?$/i);
  if (dom) n = dom[1].charAt(0).toUpperCase() + dom[1].slice(1);
  return n || "AS" + asn;
}

function asLabel(asn, owner) {
  if (!asn) return owner || "未知 AS";
  return `${AS_NAMES[asn] || owner || "AS" + asn} (AS${asn})`;
}

// dst：目標 IP。目的地本身那一跳不算骨幹證據（例如廣州聯通 IPv6 目標在 AS9929 宣告的位址段內）
// opts.transitRtt：國際業者承載的延遲超過這個毫秒數，才在標籤寫出國際業者（預設 50）
// 國際業者最後一跳 → 三網第一跳的延遲增加超過這個值，表示看不到三網自己的海外段
const HANDOFF_JUMP_MS = 20;
const NEAR_HANDOFF_MS = 20;
function classify(hops, isp, dst, opts) {
  opts = opts || {};
  const transitRtt = Number.isFinite(Number(opts.transitRtt)) ? Number(opts.transitRtt) : 50;
  hops = fixGeo(hops);
  const pub = [];
  for (let hi = 0; hi < hops.length; hi++) {
    const h = hops[hi];
    if (!h.ip || isPrivateIP(h.ip)) continue;
    const pi = prefixInfo(h.ip);
    const asn = pi ? pi.asn : h.asn || 0;
    pub.push({ ip: h.ip, asn, owner: h.owner || "", bb: pi ? pi.bb : "", fam: familyOf(asn, h.owner), v6: h.ip.includes(":"), failed: !!h.lookup_failed && !(pi && pi.asn), dst: !!dst && sameIP(h.ip, dst), rtt: typeof h.rtt === "number" ? h.rtt : null, idx: hi, geo: h.geo || "" });
  }
  const isV6 = pub.length ? pub[pub.length - 1].v6 : false;
  const res = { label: "", line: "", carrier: "", cross: false, confidence: "", evidence: "", intl: [], intl_text: "" };

  const entry = pub.findIndex((h) => h.fam);
  // 國際段：機房自己的 AS 之後、入境之前經過的 AS
  const before = pub.slice(0, entry < 0 ? pub.length : entry);
  const runs = [];
  for (const h of before) {
    if (!h.asn) continue;
    const last = runs[runs.length - 1];
    if (last && last.asn === h.asn) continue;
    runs.push({ asn: h.asn, owner: h.owner, idx: h.idx });
  }
  const firstIsOwn = runs.length > 0 && isOwnFirstAS(runs[0].asn, runs[0].idx, opts);
  res.intl = (firstIsOwn ? runs.slice(1) : runs).map((r) => ({ asn: r.asn, name: I18N.INTL_AS[r.asn] || r.owner || "" }));
  // 入境前有跳點查不到 AS（nexttrace 的資料 API 失敗、RIPEstat 也查不到）：看不出經過哪些國際業者，不能當成直連
  res.intl_unknown = before.some((h, k) => (k > 0 || h.idx > 0) && h.failed);
  const srcInside = entry === 0 && (opts.srcASN ? !!familyOf(Number(opts.srcASN)) : pub[0].idx === 0);
  res.intl_note = { kind: res.intl_unknown && !res.intl.length ? "unknown" : res.intl.length ? "transit" : srcInside ? "inside" : "direct", ms: null, long: false, overseas: false, ownLeg: false };

  // 交接延遲：機房第一跳 → 第一個三網跳點之間增加的延遲。
  // 路由器回應 ICMP 常被降低優先而虛高，所以每一跳取「這跳以及之後所有跳點的最低延遲」。
  const eff = new Array(pub.length).fill(null);
  let low = null;
  for (let i = pub.length - 1; i >= 0; i--) {
    if (pub[i].rtt !== null && (low === null || pub[i].rtt < low)) low = pub[i].rtt;
    eff[i] = low;
  }
  let lastEff = null;
  for (let i = eff.length - 1; i >= 0; i--) { if (eff[i] !== null) { lastEff = eff[i]; break; } }
  const farFromChina = eff[0] !== null && lastEff !== null && lastEff - eff[0] >= transitRtt;
  res.handoff_delta = entry > 0 && eff[0] !== null && eff[entry] !== null ? Math.round((eff[entry] - eff[0]) * 10) / 10 : null;
  // 國際業者承載了多遠：看它自己最後一跳的延遲（不是第一個三網跳點，
  // 因為三網的海外交接點常常沒回應，第一個看到的三網跳點可能已經跨海進到國內）
  let lastIntlIdx = -1;
  if (res.intl.length) {
    const lastAsn = res.intl[res.intl.length - 1].asn;
    for (let k = entry - 1; k >= 0; k--) if (pub[k].asn === lastAsn) { lastIntlIdx = k; break; }
  }
  res.transit_delta = lastIntlIdx >= 0 && eff[0] !== null && eff[lastIntlIdx] !== null ? Math.round((eff[lastIntlIdx] - eff[0]) * 10) / 10 : null;
  const carried = res.transit_delta !== null ? res.transit_delta : res.handoff_delta;
  res.transit_shown = res.intl.length > 0 && (carried === null || carried >= transitRtt);
  const inChina = (g) => !/台湾|台灣|Taiwan/i.test(g || "") && /中国|中國|香港|澳门|澳門|China|Hong ?Kong|Macau/i.test(g || "");
  // 判斷機房本身是否在中國 / 香港 / 澳門：只看延遲與機房相差 <= 10 ms 的近跳（已經 fixGeo 校正），
  // 依不同網路（AS 或 /16）計票，避免單一跳點標錯註冊地。
  const nearChinaNets = new Set(), nearAbroadNets = new Set();
  for (let i = 0; i < pub.length; i++) {
    const h = pub[i];
    if (!h.geo || eff[i] === null || eff[0] === null || eff[i] - eff[0] > 10) continue;
    const nid = h.asn ? "AS" + h.asn : ip16(h.ip);
    if (inChina(h.geo)) nearChinaNets.add(nid);
    else nearAbroadNets.add(nid);
  }
  const homeGeoKnown = nearChinaNets.size > 0 || nearAbroadNets.size > 0;
  const homeIsChina = homeGeoKnown && nearChinaNets.size >= nearAbroadNets.size;
  if (entry >= 0) {
    let seenCn2 = false;
    for (let k = entry; k < pub.length; k++) {
      const h = pub[k];
      if (!h.fam || h.dst) break;
      if (h.asn === 4809) seenCn2 = true;
      // 物理延遲明確證實仍在海外近端（機房不在中國/香港，這跳離機房 < 20 ms 且後續仍有 >= 20 ms 跨海延遲）；
      // 或有地理位置標示在海外（排除中國/香港機房本地跳點被誤標）。
      const nearAbroadByRtt = (homeGeoKnown ? !homeIsChina : farFromChina) &&
        eff[k] !== null && eff[0] !== null && lastEff !== null &&
        eff[k] - eff[0] < NEAR_HANDOFF_MS && lastEff - eff[k] >= HANDOFF_JUMP_MS;
      const foreign = nearAbroadByRtt || (!!h.geo && !inChina(h.geo) && !(homeIsChina && eff[k] !== null && eff[0] !== null && eff[k] - eff[0] <= 10));
      if (!foreign) break;
      if (!h.bb && !(seenCn2 && h.asn === 4134 && !h.geo)) {
        h.bb = { 4134: "163", 4837: "169", 9808: "cmnet" }[h.asn] || "";
      }
      h.overseas = true;
    }
  }
  // 骨幹推斷：AS4134 / AS4837 / AS9808 的跳點，若之後還有同一家的省網 AS（例如 4811 上海電信、17621 上海聯通、24400 上海移動），
  // 表示它不是終點的省網，而是骨幹（例如 IPv6 的 240e:20::）。只推斷 CN2 之前的跳點，CN2 之後的交給 GIA / GT 規則判斷。
  const BACKBONE_ASN = [4134, 4809, 23764, 4837, 9929, 10099, 9808, 58453, 58807];
  if (entry >= 0) {
    const firstCn2Pub = pub.findIndex((h, k) => k >= entry && h.asn === 4809);
    const stop = firstCn2Pub >= 0 ? firstCn2Pub : pub.length;
    for (let k = entry; k < stop; k++) {
      const h = pub[k];
      if (h.bb || h.dst || ![4134, 4837, 9808].includes(h.asn)) continue;
      const provAfter = pub.slice(k + 1).some((x) => x.fam === h.fam && x.asn && !BACKBONE_ASN.includes(x.asn));
      if (provAfter) h.bb = { 4134: "163", 4837: "169", 9808: "cmnet" }[h.asn];
    }
  }
  // 交接地點：看國際業者最後一跳（沒有就看第一個三網跳點）的地理位置在不在中國 / 香港
  const handHop = entry > 0 ? pub[entry] : null;
  const transitHop = lastIntlIdx >= 0 ? pub[lastIntlIdx] : null;
  const geoHop = transitHop && transitHop.geo ? transitHop : handHop;
  res.handoff_geo_known = !!(geoHop && geoHop.geo);
  res.handoff_overseas = !!(handHop && (handHop.overseas || (geoHop && geoHop.geo && !inChina(geoHop.geo))));
  if (res.intl.length && carried !== null) {
    res.intl_note.ms = carried;
    res.intl_note.long = res.transit_shown;
    res.intl_note.overseas = res.handoff_overseas;
  }

  if (entry < 0) {
    res.line = "none";
    res.short = "";
    res.chain = [];
    res.chain_full = res.intl.map((r) => shortName(r.asn, r.name));
    res.connect = "none";
    res.confidence = "insufficient";
    res.ev = [{ k: pub.length ? "ev.none.noCarrier" : "ev.none.noHops" }];
    return finish(res);
  }

  const F = pub[entry].fam;
  res.carrier = F;
  const seg = [];
  let handoff = "";
  for (let i = entry; i < pub.length; i++) {
    if (pub[i].fam && pub[i].fam !== F) { handoff = pub[i].fam; break; }
    seg.push(pub[i]);
  }
  const core = seg.filter((h) => !h.dst);
  const idx = (pred) => core.findIndex(pred);
  const cnt = (pred) => core.filter(pred).length;
  const asnIs = (a) => (h) => h.asn === a;
  const bbIs = (b) => (h) => h.bb === b;
  let line, conf = "confirmed", ev = [];
  const E = (k, p) => ({ k, p: p || {} });
  let ambiguous = false; // 路徑再完整也無法斷定的情況（保留「推測」）

  if (F === "ct") {
    const cn2 = cnt(asnIs(4809));
    const b163 = cnt(bbIs("163"));
    const firstCn2 = idx(asnIs(4809));
    if (cn2 > 0) {
      // GIA = 全程走 CN2（CTGNet 國際網入境後接 CN2 也算），最後才交給當地電信。
      // GT  = 中間經過 163：163 骨幹段（202.97 / 240e:0::），或 CN2 之前出現的 AS4134
      //       （例如電信 163 的海外節點 218.30.x，在 CN2 之前就是走 163 入境）。
      //       CN2 之後的 AS4134 若不是骨幹段，視為交給當地電信省網，不影響判斷。
      const lastCn2 = core.length - 1 - core.slice().reverse().findIndex(asnIs(4809));
      const pre163 = core.slice(0, firstCn2).filter((h) => h.asn === 4134).length;
      const mid163 = core.slice(firstCn2, lastCn2 + 1).filter((h) => h.asn === 4134).length;
      const post4134 = core.slice(lastCn2 + 1).filter((h) => h.asn === 4134 && h.bb !== "163").length;
      if (b163 > 0 || pre163 > 0 || mid163 > 0) {
        line = "電信 CN2 GT";
        if (pre163 > 0) ev = [E(b163 > 0 ? "ev.ct.gt.pre" : "ev.ct.gt.preOverseas")];
        else if (mid163 > 0) ev = [E("ev.ct.gt.mid")];
        else ev = [E(isV6 ? "ev.ct.gt.post6" : "ev.ct.gt.post")];
      } else if (cn2 >= 2 && (!isV6 || post4134 <= 2)) {
        line = "電信 CN2 GIA";
        ev = [isV6 ? E("ev.ct.gia6", { n: cn2 }) : E("ev.ct.gia")];
      } else if (cn2 >= 2) {
        line = "電信 CN2 GIA"; conf = "inferred"; ambiguous = true;
        ev = [E("ev.ct.giaAmb", { n: post4134 })];
      } else {
        line = "電信 CN2"; conf = "insufficient"; ev = [E("ev.ct.cn2one")];
      }
    } else if (cnt(asnIs(23764)) > 0) {
      line = "電信 CTGNet";
      ev = [E(b163 > 0 ? "ev.ct.ctg163" : "ev.ct.ctg")];
    } else if (b163 > 0) {
      line = "電信 163";
      // 依實際看到的 163 跳點寫依據
      const h163 = core.filter(bbIs("163"));
      const seen = [];
      if (h163.some((h) => /^202\.97\./.test(h.ip))) seen.push("bb202");
      if (h163.some((h) => /^240e:0+:/i.test(h.ip) || /^2400:9380:8/i.test(h.ip))) seen.push("bb6");
      if (h163.some((h) => h.overseas)) seen.push("overseas");
      if (!seen.length) seen.push("as4134");
      ev = [E("ev.ct.163", { seen })];
    } else if (isV6 && cnt(asnIs(4134)) >= 2) {
      line = "電信 163"; conf = "inferred"; ev = [E("ev.ct.163v6multi")];
    } else {
      line = "國內電信"; conf = "inferred"; ev = [E("ev.ct.prov")];
    }
  } else if (F === "cu") {
    const f9929 = idx(asnIs(9929));
    const f169 = idx(bbIs("169"));
    if (f9929 >= 0) {
      if (f169 >= 0 && f169 < f9929) { line = "聯通 mix:4837/9929"; conf = "inferred"; ev = [E("ev.cu.mix", { x: isV6 ? "2408:8000::" : "219.158" })]; }
      else { line = "聯通 9929"; ev = [E(isV6 ? "ev.cu.9929v6" : "ev.cu.9929")]; }
    } else if (cnt(asnIs(10099)) > 0) {
      line = "聯通 CUG (10099)"; ev = [E(f169 >= 0 ? "ev.cu.cug169" : "ev.cu.cug")];
    } else if (f169 >= 0) {
      line = "聯通 4837"; ev = [E(isV6 ? "ev.cu.4837v6" : "ev.cu.4837")];
    } else if (isV6 && cnt(asnIs(4837)) >= 2) {
      line = "聯通 4837"; conf = "inferred"; ev = [E("ev.cu.4837v6multi")];
    } else {
      line = "國內聯通"; conf = "inferred"; ev = [E("ev.cu.prov")];
    }
  } else {
    const fCmin2 = idx(asnIs(58807));
    const fCmi = idx(asnIs(58453));
    if (fCmin2 >= 0) {
      if (fCmi >= 0 && fCmi < fCmin2) { line = "移動 mix:CMI/CMIN2"; conf = "inferred"; ev = [E("ev.cm.mix")]; }
      else { line = "移動 CMIN2"; ev = [E("ev.cm.cmin2")]; }
    } else if (fCmi >= 0) {
      line = "移動 CMI"; ev = [E("ev.cm.cmi")];
    } else if (cnt(bbIs("cmnet")) > 0) {
      line = "移動 CMNET"; ev = [E(isV6 ? "ev.cm.cmnetv6" : "ev.cm.cmnet")];
    } else {
      line = "國內移動"; conf = "inferred"; ev = [E("ev.cm.prov")];
    }
  }

  // 路徑清楚（到達目的地，且交接點前後沒有逾時）時，看到的就是事實，不標「推測」
  const reached = dst ? pub.some((h) => h.dst) : true;
  const prevIdx = entry > 0 ? pub[entry - 1].idx : -1;
  const gapAtEntry = hops.slice(prevIdx + 1, pub[entry].idx).some((h) => !h.ip);
  res.path_clear = reached && !gapAtEntry;
  if (conf === "inferred" && res.path_clear && !ambiguous) conf = "confirmed";
  if (conf === "inferred" && !res.path_clear) ev.push(E(reached ? "ev.gap.entry" : "ev.gap.unreached"));

  if (res.intl_unknown) { if (conf === "confirmed") conf = "inferred"; ev.push(E("ev.asUnknown")); }
  res.line = line;
  res.confidence = conf;
  res.ev = ev;
  // 標籤固定寫成「線路 · 接入方式 [· 轉網]」：
  //   short   骨幹名稱：CN2 GIA / CN2 GT / 163 / CTGNet / 9929 / CUG / 4837 / CMIN2 / CMI / CMNET / 省網直入
  //   access  接入方式：直連 / 經 Lumen（在當地交接）/ NTT 長途承載（國際業者先帶一大段才交接）
  //   cross   入境的電信商與目標不同時：轉聯通 … （之後是境內轉網）
  // short：線路名稱（語言中立；省網為 prov:ct 等代碼，混合為 mix:… 代碼）
  res.short = line.startsWith("國內") ? "prov:" + F : line.replace(/^(電信|聯通|移動) /, "");
  const last = res.intl.length ? res.intl[res.intl.length - 1] : null;
  res.handover = last ? shortName(last.asn, last.name) : "";

  // 網路名稱：ASN 加骨幹名稱，例如 4134(163)、4837(169)、9808、10099、9929、CMIN2、CMI、CTGNet、CN2 GIA
  const netName = (h) => {
    if (h.fam === "ct") return h.asn === 23764 ? "CTGNet" : h.asn === 4809 ? "CN2" : h.bb === "163" ? "4134(163)" : h.asn === 4134 ? "4134" : "prov:ct";
    if (h.fam === "cu") return h.asn === 9929 ? "9929" : h.asn === 10099 ? "10099" : h.bb === "169" ? "4837(169)" : h.asn === 4837 ? "4837" : "prov:cu";
    if (h.fam === "cm") return h.asn === 58807 ? "CMIN2" : h.asn === 58453 ? "CMI" : h.asn === 9808 || h.bb === "cmnet" ? "9808" : "prov:cm";
    return null;
  };
  const tail = pub.slice(entry);
  const isBackbone = (h) => [4809, 23764, 58807, 58453, 10099, 9929].includes(h.asn) || ["163", "169", "cmnet"].includes(h.bb);
  const lastBB = {};
  tail.forEach((h, k) => { if (h.fam && isBackbone(h)) lastBB[h.fam] = k; });
  const isEndNet = (n) => /^prov:/.test(n) || /^(4134|4837)$/.test(n);
  const items = [];
  let seenOtherFam = false;
  for (let k = 0; k < tail.length; k++) {
    const h = tail[k];
    let name = netName(h);
    if (!name) continue;
    if (h.fam !== F) seenOtherFam = true;
    // 骨幹之前的 AS4134 / AS4837 / AS9808 也是骨幹（例如海外節點），之後的才是交給省網
    if ((/^prov:/.test(name) || /^(4134|4837)$/.test(name)) && lastBB[h.fam] !== undefined && k < lastBB[h.fam]) {
      name = { 4134: "4134(163)", 4837: "4837(169)", 9808: "9808" }[h.asn] || name;
    }
    if (/^CN2/.test(res.short) && !seenOtherFam && h.fam === "ct" && !/^prov:/.test(name)) name = res.short; // 只寫 CN2 GIA / CN2 GT
    const prev = items[items.length - 1];
    // 同一家的骨幹之後緊接自家省網或一般 4134 / 4837（無論在結尾或跨網前）直接併入前一段；9808 屬 CMNET 骨幹，保留在完整走法 chain_full
    if (prev && (prev.name === name || (prev.fam === h.fam && isEndNet(name) && !/^prov:/.test(prev.name)))) continue;
    items.push({ fam: h.fam, name });
  }
  const netsFull = items.map((it) => it.name);
  // 第一行：移動的國際網（CMI / CMIN2）入境後一定接 9808，目標也是移動時省略最後的 9808
  const nets = netsFull.slice();
  if (nets.length >= 2 && nets[nets.length - 1] === "9808" && /^CMI/.test(nets[nets.length - 2])) nets.pop();

  // 交接寫法（極簡兩態，不受 GeoIP 漂移或單跳丟包影響）：
  //   直連：機房直接接三網     → 只寫網路，例如「CN2 GIA」「CTGNet → 4134(163)」
  //   國際轉接：經過國際業者   → 一律寫「業者 → 三網 · 國際轉接」，例如「SoftBank → CMI」「Lumen → CMI」
  const entryHop = entry >= 0 ? pub[entry] : null;
  const jump = lastIntlIdx >= 0 && entryHop && eff[lastIntlIdx] !== null && eff[entry] !== null ? Math.round((eff[entry] - eff[lastIntlIdx]) * 10) / 10 : null;
  res.handoff_jump = jump;
  const handoffLimit = Math.min(NEAR_HANDOFF_MS, transitRtt);
  const serverAbroad = homeGeoKnown ? !homeIsChina : farFromChina;
  const ownLeg = !!(
    last &&
    entryHop &&
    serverAbroad &&
    carried !== null && carried < handoffLimit &&
    jump !== null && jump < HANDOFF_JUMP_MS &&
    eff[entry] !== null && eff[0] !== null && eff[entry] - eff[0] < NEAR_HANDOFF_MS &&
    lastEff !== null && lastEff - eff[entry] >= HANDOFF_JUMP_MS
  );
  if (res.intl.length && carried !== null) {
    res.intl_note.ownLeg = ownLeg;
  }
  if (!last) {
    res.connect = res.intl_unknown ? "unknown" : "direct";
  } else {
    res.connect = "transit";
    if (ownLeg && nets.length && !/^(prov|mix):/.test(nets[0])) {
      const overseasGeo = entryHop.geo && !inChina(entryHop.geo) ? entryHop.geo : "";
      res.ev.push(E(overseasGeo ? "ev.ownLeg" : "ev.ownLegNoGeo", { x: res.handover, n: nets[0], g: overseasGeo }));
    }
  }

  res.chain = (last ? [res.handover] : []).concat(nets);
  // 完整走法：所有國際業者 + 經過的網路
  res.chain_full = res.intl.map((r) => shortName(r.asn, r.name)).concat(netsFull);

  if (isp && F !== isp) {
    res.cross = true;
    res.cross_to = isp;
    res.ev.push(E(handoff ? "ev.cross" : "ev.crossNear", { a: F, b: isp }));
  }
  return finish(res);
}

function sameIP(a, b) {
  if (String(a).includes(":")) {
    const x = expand6(a), y = expand6(b);
    return !!x && !!y && x.join("") === y.join("");
  }
  return a === b;
}

function finish(res) {
  res.chip = I18N.chip("zh-TW", res);
  res.access = I18N.access("zh-TW", res);
  res.label = I18N.label("zh-TW", res);
  res.tags = [res.label];
  return res;
}

// Zstatic CDN 三網節點（https://www.zstaticcdn.com/ ，節點清單取自其 /api/v1/DescribeAllNodes）。
// 每個省份電信 / 聯通 / 移動各一個節點：<代碼>-<ct|cu|cm>-v4.ip.zstaticcdn.com，開放 TCP 80。
// IPv6 節點把 v4 換成 v6（與網站的 IPv6 切換相同）：<代碼>-<ct|cu|cm>-v6.ip.zstaticcdn.com
const ZSTATIC_PROVINCES = [
  ["bj", "北京", "北京"], ["tj", "天津", "天津"], ["he", "河北", "河北"], ["sx", "山西", "山西"], ["nm", "內蒙古", "内蒙古"],
  ["ln", "遼寧", "辽宁"], ["jl", "吉林", "吉林"], ["hl", "黑龍江", "黑龙江"], ["sh", "上海", "上海"], ["js", "江蘇", "江苏"],
  ["zj", "浙江", "浙江"], ["ah", "安徽", "安徽"], ["fj", "福建", "福建"], ["jx", "江西", "江西"], ["sd", "山東", "山东"],
  ["ha", "河南", "河南"], ["hb", "湖北", "湖北"], ["hn", "湖南", "湖南"], ["gd", "廣東", "广东"], ["gx", "廣西", "广西"],
  ["hi", "海南", "海南"], ["cq", "重慶", "重庆"], ["sc", "四川", "四川"], ["gz", "貴州", "贵州"], ["yn", "雲南", "云南"],
  ["xz", "西藏", "西藏"], ["sn", "陝西", "陕西"], ["gs", "甘肅", "甘肃"], ["qh", "青海", "青海"], ["nx", "寧夏", "宁夏"],
  ["xj", "新疆", "新疆"],
];

// 「北京,上海,廣東」/「bj,sh,gd」/「全部」→ Zstatic 目標
function zstaticTargets(spec, ver) {
  const v = ver === 6 ? 6 : 4;
  const words = String(spec || "").split(/[\s,，、]+/).map((x) => x.trim()).filter(Boolean);
  const all = words.some((w) => /^(全部|all|すべて)$/i.test(w));
  // 也接受英文 / 日文省名（例如 Beijing、Guangdong）
  const names = (code) => (I18N.PROVINCES[code] || []).map((x) => String(x).toLowerCase());
  const picked = all ? ZSTATIC_PROVINCES : ZSTATIC_PROVINCES.filter(([code, tw, cn]) =>
    words.some((w) => w.toLowerCase() === code || w === tw || w === cn || tw.startsWith(w) || cn.startsWith(w) || names(code).includes(w.toLowerCase())));
  const out = [];
  for (const [code, tw] of picked) {
    for (const [isp, name] of [["ct", "電信"], ["cu", "聯通"], ["cm", "移動"]]) {
      out.push({ id: (v === 6 ? "y" : "z") + code + isp, v, region: code, label: tw + name, ip: `${code}-${isp}-v${v}.ip.zstaticcdn.com`, port: 80, isp });
    }
  }
  return out;
}

// 每行：名稱,目標[,ct|cu|cm[,port]]；目標可填 IP 或網域（網域由伺服器自己解析）
function parseTargets(text, ver) {
  const out = [];
  const pfx = ver === 6 ? "s" : "t";
  String(text || "").split("\n").forEach((line, i) => {
    line = line.trim();
    if (!line || line.startsWith("#")) return;
    // 有逗號時按逗號切（允許名稱內含空白，例如 "Beijing Telecom,219.141.140.10,ct"）；沒逗號時才按空白切
    const f = (/[,，]/.test(line) ? line.split(/[,，]+/) : line.split(/\s+/)).map((x) => x.trim()).filter(Boolean);
    if (f.length < 2) return;
    const ip = f[1];
    const ipLiteral = isIP(ip);
    const isDomain = !ipLiteral && /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(ip) && /[A-Za-z]/.test(ip);
    if (!ipLiteral && !isDomain) return;
    // IP 依位址格式決定版本；網域在已指定清單版本（ver=4/6）時依清單版本，未指定才看 v6 / ipv6 字樣
    const v = ipLiteral ? (ip.includes(":") ? 6 : 4) : (ver || (/(^|[.-])(v6|ipv6)([.-]|$)/i.test(ip) ? 6 : 4));
    if (ver && v !== ver) return;
    const rawPort = /^\d{1,5}$/.test(f[3] || "") ? Number(f[3]) : 80;
    const port = rawPort >= 1 && rawPort <= 65535 ? rawPort : 80;
    const isp = (f[2] || "").toLowerCase();
    out.push({ id: pfx + i, v, label: f[0], ip, port, isp: ["ct", "cu", "cm"].includes(isp) ? isp : guessIsp(f[0]) });
  });
  return out;
}

function guessIsp(label) {
  if (/電信|电信|CT/i.test(label)) return "ct";
  if (/聯通|联通|CU/i.test(label)) return "cu";
  if (/移動|移动|CM/i.test(label)) return "cm";
  return "";
}

module.exports = { fixGeo, I18N, ZSTATIC_PROVINCES, zstaticTargets, AS_NAMES, FAMILY_NAME, prefixInfo, familyOf, isIP, sameIP, isPrivateIP, maskIP, parseOutput, parseBlock, compressPath, classify, parseTargets };
