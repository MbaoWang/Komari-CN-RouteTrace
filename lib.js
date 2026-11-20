// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 MbaoWang
// komari-cnroute 解析 / 遮罩 / AS 壓縮 / 線路判斷
// 可在 Komari 插件執行環境與 Node.js 中共用。

const PREFIX4 = require("./prefix4.js");
const PREFIX6 = require("./prefix6.js");

// 常見 AS 名稱（中國三網與常見國際上游）
const AS_NAMES = {
  4134: "中國電信 ChinaNet (163 骨幹 / 省網)",
  4809: "中國電信 CN2",
  4812: "中國電信 上海",
  4811: "中國電信 上海",
  23764: "中國電信 CTGNet",
  23724: "中國電信 IDC",
  4837: "中國聯通 (169 骨幹 / 省網)",
  9929: "中國聯通 A網 (CUII)",
  10099: "中國聯通國際 CUG",
  4808: "中國聯通 北京",
  17621: "中國聯通 上海",
  17816: "中國聯通 廣東",
  9808: "中國移動 CMNET",
  58453: "中國移動國際 CMI",
  58807: "中國移動 CMIN2",
  56040: "中國移動 廣東",
  56046: "中國移動 江蘇",
  24400: "中國移動 上海",
  4538: "中國教育網 CERNET",
  3356: "Lumen (Level3)",
  1299: "Arelion (Telia)",
  2914: "NTT",
  174: "Cogent",
  6939: "Hurricane Electric",
  3257: "GTT",
  6453: "TATA",
  6461: "Zayo",
  6762: "Telecom Italia Sparkle",
  3491: "PCCW Global",
  4637: "Telstra",
  2497: "IIJ",
  4635: "HKIX",
  9304: "HGC",
  4760: "HKT",
  7473: "Singtel",
  13335: "Cloudflare",
  15169: "Google",
  16509: "Amazon",
  8075: "Microsoft",
  20473: "Vultr (Choopa)",
  14061: "DigitalOcean",
  24940: "Hetzner",
  16276: "OVH",
  21859: "Zenlayer",
  906: "DMIT",
  54574: "DMIT",
  35916: "Multacom",
  25820: "IT7",
};

// ---- 骨幹網段（以網段為準，優先於追蹤工具查到的 ASN）----
// IPv4 / IPv6 都先用 bgp.tools 路由表的宣告前綴做最長前綴比對（prefix4.js / prefix6.js）。
// 骨幹路由器之間的互連位址常常不對外宣告（例如 CN2 的 59.43.0.0/16 在 BGP 上查不到），
// 這些才用下面的備援表（取自 oneclickvirt/backtrace）。
const PREFIX4_FALLBACK = [
  ["59.43.0.0", 16, 4809], // CN2 骨幹互連，未宣告
  ["69.194.0.0", 16, 23764], // CTGNet，大部分未宣告
  ["203.22.0.0", 16, 23764], // CTGNet，未宣告
  ["202.77.0.0", 16, 10099], // CUG
  ["43.252.0.0", 16, 10099], // CUG
  ["61.14.0.0", 16, 10099], // CUG
];
function v4(ip) {
  const p = String(ip).split(".").map(Number);
  return p.length === 4 && p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) ? p : null;
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
  let [a, b] = ip.split("::");
  const ha = a ? a.split(":") : [];
  const hb = b !== undefined && b ? b.split(":") : [];
  const fill = b !== undefined ? 8 - ha.length - hb.length : 0;
  const all = ha.concat(Array(Math.max(0, fill)).fill("0"), hb);
  if (all.length !== 8) return null;
  return all.map((x) => x.padStart(4, "0"));
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
    const asn = lookup6(h.join(""));
    if (!asn) return null;
    // AS4809 / 23764 / 58807 / 58453 / 10099 / 9929 只做骨幹或國際網，命中即可確認骨幹種類。
    // AS4134 / 4837 / 9808 的 IPv6 宣告是整片（例如 240e::/20），骨幹與省網分不開，只用來辨識是哪一家。
    // 例外：2400:9380::/32 是電信骨幹設施位址段（CN2 / CTGNet / 163 的細分 /48 都在這裡），
    // 其中 AS4134 的 2400:9380:8xxx 視為 163 骨幹（推測）。
    const bb = BB_BY_ASN[asn] ||
      (asn === 4134 && h[0] === "2400" && h[1] === "9380" ? "163?" : "");
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
  if (mode === "full") return "*.*.*.*";
  if (ip.includes(":")) {
    const parts = ip.split(":").filter((x) => x !== "");
    const keep = mode === "one" ? 1 : 2;
    return parts.slice(0, keep).join(":") + ":****:****";
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
  const hops = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(\d+)\.(?:\|--)?\s+(AS\S+)?\s*(\S+)\s+([\d.]+)%\s+\d+\s+([\d.]+)?\s*([\d.]+)?/);
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

function parseBlock(fmt, text) {
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
// 把連續同 AS 的跳點合併成一段；逾時(*) 的跳點併入前一段計數；
// 內網段標為 LAN。第一個公網 AS（本機機房）內的 IP 會被遮罩。
function compressPath(hops, opts) {
  opts = opts || {};
  const maskMode = opts.maskMode || "half";
  const maskFirstAS = opts.maskFirstAS !== false;
  const segs = [];
  let lastRtt = null;
  for (const h of hops) {
    if (!h.ip) {
      if (segs.length) segs[segs.length - 1].timeouts++;
      continue;
    }
    const priv = isPrivateIP(h.ip);
    let asn = priv ? 0 : guessASN(h.ip) || h.asn;
    const key = priv ? "LAN" : asn ? "AS" + asn : "?";
    let seg = segs[segs.length - 1];
    // 未知 AS 的單跳夾在同一 AS 之間時視為同段
    if (!seg || (seg.key !== key && !(key === "?" && seg.key !== "LAN"))) {
      seg = {
        key,
        asn,
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
    let shownIP = h.ip;
    if (priv) shownIP = "內網";
    else if (h.ip === opts.srcIP || (maskFirstAS && seg === firstPublicSeg)) shownIP = maskIP(h.ip, maskMode);
    seg.hops++;
    if (shownIP && !seg.ips.includes(shownIP) && seg.ips.length < 6) seg.ips.push(shownIP);
    if (!seg.name && h.owner) seg.name = h.owner;
    if (h.geo && !priv) seg.geo = h.geo;
    if (h.rtt !== null && h.rtt !== undefined) {
      if (seg.rtt_in === null || seg.rtt_in === undefined) seg.rtt_in = h.rtt;
      seg.rtt_out = h.rtt;
      lastRtt = h.rtt;
    }
  }
  // 第一公網段的地理位置也會暴露本機，一併隱藏
  if (maskFirstAS) {
    const s = segs.find((x) => x.key !== "LAN");
    if (s) s.geo = "";
  }
  return { segments: segs, last_rtt: lastRtt };
}

// ---- 線路判斷 ----
// 1. 找出回程「第一個進入的中國三網」(入境點)，線路只看這一段，
//    之後在境內轉交其他電信商的部分不算（例如 163 入境再轉聯通 4837，線路是 163，不是 4837）。
// 2. 同一家的骨幹之後交給當地省網是正常的（例如 CN2 GIA 最後交 AS4134 省網 / AS4812），不影響判斷。
// 3. 入境前經過的國際 AS 依序列出。
// 標籤用的短名稱：「Lumen (Level3)」→「Lumen」，沒有名稱就用 AS 號
function shortName(asn, name) {
  const n = String(AS_NAMES[asn] || name || "").replace(/\s*\(.*\)\s*$/, "").trim();
  return n || "AS" + asn;
}

function asLabel(asn, owner) {
  if (!asn) return owner || "未知 AS";
  return `${AS_NAMES[asn] || owner || "AS" + asn} (AS${asn})`;
}

// dst：目標 IP。目的地本身那一跳不算骨幹證據（例如廣州聯通 IPv6 目標在 AS9929 宣告的位址段內）
// opts.transitRtt：國際業者承載的延遲超過這個毫秒數，才在標籤寫出國際業者（預設 50）
function classify(hops, isp, dst, opts) {
  opts = opts || {};
  const transitRtt = Number.isFinite(Number(opts.transitRtt)) ? Number(opts.transitRtt) : 50;
  const pub = [];
  for (const h of hops) {
    if (!h.ip || isPrivateIP(h.ip)) continue;
    const pi = prefixInfo(h.ip);
    const asn = pi ? pi.asn : h.asn || 0;
    pub.push({ ip: h.ip, asn, owner: h.owner || "", bb: pi ? pi.bb : "", fam: familyOf(asn, h.owner), v6: h.ip.includes(":"), dst: !!dst && sameIP(h.ip, dst), rtt: typeof h.rtt === "number" ? h.rtt : null });
  }
  const isV6 = pub.length ? pub[pub.length - 1].v6 : false;
  const res = { label: "", line: "", carrier: "", cross: false, confidence: "", evidence: "", intl: [], intl_text: "" };

  const entry = pub.findIndex((h) => h.fam);
  // 國際段：機房自己的 AS 之後、入境之前經過的 AS
  const before = pub.slice(0, entry < 0 ? pub.length : entry);
  const runs = [];
  for (const h of before) {
    const last = runs[runs.length - 1];
    if (last && (last.asn === h.asn || !h.asn)) continue;
    runs.push({ asn: h.asn, owner: h.owner });
  }
  res.intl = runs.slice(1).filter((r) => r.asn).map((r) => ({ asn: r.asn, name: AS_NAMES[r.asn] || r.owner || "" }));
  res.intl_text = res.intl.length ? res.intl.map((r) => asLabel(r.asn, r.name)).join(" → ") : entry === 0 ? "機房直接位於三網" : "機房直連三網";

  // 交接延遲：機房第一跳 → 第一個三網跳點之間增加的延遲。
  // 路由器回應 ICMP 常被降低優先而虛高，所以每一跳取「這跳以及之後所有跳點的最低延遲」。
  const eff = new Array(pub.length).fill(null);
  let low = null;
  for (let i = pub.length - 1; i >= 0; i--) {
    if (pub[i].rtt !== null && (low === null || pub[i].rtt < low)) low = pub[i].rtt;
    eff[i] = low;
  }
  res.handoff_delta = entry > 0 && eff[0] !== null && eff[entry] !== null ? Math.round((eff[entry] - eff[0]) * 10) / 10 : null;
  // 交接前延遲沒增加多少（例如 NTT 在美國當地就交給電信）→ 國際業者只是機房旁的一小段，不寫進標籤
  res.transit_shown = res.intl.length > 0 && (res.handoff_delta === null || res.handoff_delta >= transitRtt);
  if (res.intl.length && res.handoff_delta !== null) {
    res.intl_text += res.transit_shown
      ? `；交接前延遲增加 ${res.handoff_delta} ms（國際業者承載長距離）`
      : `；交接前延遲只增加 ${res.handoff_delta} ms（機房附近就交給三網）`;
  }

  if (entry < 0) {
    res.label = res.line = "未進入中國三網";
    res.confidence = "不足";
    res.evidence = pub.length ? "路徑上沒有出現電信 / 聯通 / 移動的 AS" : "沒有任何回應的跳點";
    return withTags(res);
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
  let line, conf = "確認", ev = "";

  if (F === "ct") {
    const cn2 = cnt(asnIs(4809));
    const b163 = cnt(bbIs("163"));
    const firstCn2 = idx(asnIs(4809));
    if (cn2 > 0) {
      if (!isV6) {
        if (b163 > 0) {
          line = "電信 CN2 GT";
          ev = idx(bbIs("163")) < firstCn2 ? "先進 202.97（163 骨幹）再進 59.43" : "59.43（CN2）之後接上 202.97（163 骨幹）";
        } else if (cn2 >= 2) {
          line = "電信 CN2 GIA";
          ev = "全程走 59.43（CN2），未經 202.97，最後才交給當地電信";
        } else {
          line = "電信 CN2"; conf = "不足"; ev = "只看到 1 跳 59.43，無法區分 GIA / GT";
        }
      } else {
        // IPv6：CN2 用 bgp.tools 的 AS4809 前綴確認；163 骨幹只有 2400:9380:8xxx 可當證據，
        // 其餘 240e::/20 的 AS4134 跳點可能是骨幹也可能是省網，用位置與數量判斷。
        const b163v6 = cnt(bbIs("163?"));
        const lastCn2 = core.length - 1 - core.slice().reverse().findIndex(asnIs(4809));
        const ct4134Before = core.slice(0, firstCn2).filter(asnIs(4134)).length;
        const ct4134After = core.slice(lastCn2 + 1).filter(asnIs(4134)).length;
        if (b163v6 > 0) {
          line = "電信 CN2 GT"; conf = "推測"; ev = "IPv6：CN2（AS4809）之外經過 2400:9380:8xxx（AS4134 骨幹設施段）";
        } else if (ct4134Before > 0) {
          line = "電信 CN2 GT"; conf = "推測"; ev = "IPv6：AS4134 出現在 CN2（AS4809）之前";
        } else if (cn2 >= 2 && ct4134After <= 2) {
          line = "電信 CN2 GIA"; ev = `IPv6：${cn2} 跳 CN2（AS4809 前綴），之後只剩 ${ct4134After} 跳 AS4134 就到目的地（交給當地電信）`;
        } else if (cn2 >= 2) {
          line = "電信 CN2 GIA"; conf = "推測"; ev = `IPv6：CN2 之後還有 ${ct4134After} 跳 AS4134，可能是省網也可能是 163 骨幹`;
        } else {
          line = "電信 CN2"; conf = "不足"; ev = "IPv6：只看到 1 跳 CN2";
        }
      }
    } else if (cnt(asnIs(23764)) > 0) {
      line = "電信 CTGNet"; ev = "經過 AS23764";
    } else if (b163 > 0) {
      line = "電信 163"; ev = "經過 202.97（163 骨幹）";
    } else if (isV6 && cnt(bbIs("163?")) > 0) {
      line = "電信 163"; conf = "推測"; ev = "IPv6：經過 2400:9380:8xxx（AS4134 骨幹設施段），無 CN2";
    } else if (isV6 && cnt(asnIs(4134)) >= 2) {
      line = "電信 163"; conf = "推測"; ev = "IPv6：多跳 AS4134，無 CN2";
    } else {
      line = "國內電信"; conf = "推測"; ev = "沒有經過 CN2 / 163 骨幹網段，直接進入電信當地網";
    }
  } else if (F === "cu") {
    const f9929 = idx(asnIs(9929));
    const f169 = idx(bbIs("169"));
    if (f9929 >= 0) {
      if (f169 >= 0 && f169 < f9929) { line = "聯通 4837/9929 混合"; conf = "推測"; ev = "先經 219.158（4837 骨幹）再進 9929"; }
      else { line = "聯通 9929"; ev = isV6 ? "IPv6：經過 AS9929 的宣告前綴" : "經過 AS9929（218.105 / 210.51）"; }
    } else if (cnt(asnIs(10099)) > 0) {
      line = "聯通 CUG (10099)"; ev = "經過 AS10099" + (f169 >= 0 ? "，之後接 4837 骨幹" : "");
    } else if (f169 >= 0) {
      line = "聯通 4837"; ev = "經過 219.158（4837 / 169 骨幹）";
    } else if (isV6 && cnt(asnIs(4837)) >= 2) {
      line = "聯通 4837"; conf = "推測"; ev = "IPv6：多跳 AS4837";
    } else {
      line = "國內聯通"; conf = "推測"; ev = "沒有經過 9929 / CUG / 4837 骨幹網段，直接進入聯通當地網";
    }
  } else {
    const fCmin2 = idx(asnIs(58807));
    const fCmi = idx(asnIs(58453));
    if (fCmin2 >= 0) {
      if (fCmi >= 0 && fCmi < fCmin2) { line = "移動 CMI/CMIN2 混合"; conf = "推測"; ev = "先經 CMI（AS58453）再進 CMIN2"; }
      else { line = "移動 CMIN2"; ev = "經過 AS58807（CMIN2）"; }
    } else if (fCmi >= 0) {
      line = "移動 CMI"; ev = "經過 AS58453（CMI），未見 CMIN2";
    } else if (cnt(bbIs("cmnet")) > 0) {
      line = "移動 CMNET"; ev = "直接進 CMNET 骨幹（221.183 / 111.24）";
    } else {
      line = "國內移動"; conf = "推測"; ev = "沒有經過 CMIN2 / CMI / CMNET 骨幹，直接進入移動當地網";
    }
  }

  res.line = line;
  res.confidence = conf;
  res.evidence = ev;
  // 經國際業者交給三網時，標示是哪家國際業者交接的，例如「Lumen 轉國內移動」「NTT 轉電信 CN2 GIA」
  const handover = res.transit_shown ? res.intl[res.intl.length - 1] : null;
  res.handover = handover ? shortName(handover.asn, handover.name) : "";
  let label = handover ? `${res.handover} 轉${line}` : line.startsWith("國內") && !res.intl.length ? "直連" + line : line;
  // 入境的電信商與目標不同：之後是境內轉網，不能算是走目標電信商的線路
  if (isp && F !== isp) {
    res.cross = true;
    label += ` → 境內轉${FAMILY_NAME[isp]}`;
    res.evidence += `；入境後${handoff ? "" : "在目的地附近"}才交給${FAMILY_NAME[isp]}`;
  }
  res.label = label;
  return withTags(res);
}

function sameIP(a, b) {
  if (String(a).includes(":")) {
    const x = expand6(a), y = expand6(b);
    return !!x && !!y && x.join("") === y.join("");
  }
  return a === b;
}

function withTags(res) {
  res.tags = [res.label];
  return res;
}

function parseTargets(text, ver) {
  const out = [];
  const pfx = ver === 6 ? "s" : "t";
  String(text || "").split("\n").forEach((line, i) => {
    line = line.trim();
    if (!line || line.startsWith("#")) return;
    const f = line.split(/[,，\s]+/).filter(Boolean);
    if (f.length < 2) return;
    const ip = f[1];
    if (!/^[0-9a-fA-F:.]+$/.test(ip)) return;
    const v = ip.includes(":") ? 6 : 4;
    if (ver && v !== ver) return;
    const isp = (f[2] || "").toLowerCase();
    out.push({ id: pfx + i, v, label: f[0], ip, isp: ["ct", "cu", "cm"].includes(isp) ? isp : guessIsp(f[0]) });
  });
  return out;
}

function guessIsp(label) {
  if (/電信|电信|CT/i.test(label)) return "ct";
  if (/聯通|联通|CU/i.test(label)) return "cu";
  if (/移動|移动|CM/i.test(label)) return "cm";
  return "";
}

module.exports = { AS_NAMES, FAMILY_NAME, prefixInfo, familyOf, isPrivateIP, maskIP, parseOutput, parseBlock, compressPath, classify, parseTargets };
