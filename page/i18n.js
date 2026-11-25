// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 MbaoWang
// komari-cnroute 多語系：結果頁（瀏覽器）與插件後端（Telegram）共用。
// 支援 zh-TW / zh-CN / en / ja；其他語系（例如 Komari 的 id-ID）使用英文。
// 檢測結果只存語言中立的代碼，顯示時才依語系產生文字。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CNI18N = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LANGS = ["zh-TW", "zh-CN", "en", "ja"];

  // 與 Komari（komari-web）相同的語系判斷：zh-TW / zh-HK / zh-MO / zh-Hant → 繁中，其他 zh → 簡中
  function resolve(value) {
    var v = String(value || "").trim().replace(/_/g, "-").toLowerCase();
    if (!v) return "";
    if (v === "zh-tw" || v === "zh-hk" || v === "zh-mo" || v.indexOf("zh-hant") === 0) return "zh-TW";
    if (v === "zh" || v.indexOf("zh-") === 0) return "zh-CN";
    if (v === "ja" || v.indexOf("ja-") === 0) return "ja";
    return "en";
  }

  // ---------------- 字典 ----------------
  var D = {
    "zh-TW": {
      "carrier.ct": "電信", "carrier.cu": "聯通", "carrier.cm": "移動",
      "prov.ct": "電信省網", "prov.cu": "聯通省網", "prov.cm": "移動省網",
      "mix": "{x} 混合",
      "access.direct": "直連", "access.long": "長途承載", "access.local": "當地交接", "access.overseas": "經 {x} 海外交接", "access.overseasShort": "海外交接", "access.unknown": "國際段 AS 查詢失敗",
      "conf.inferred": "推測", "conf.insufficient": "證據不足", "unreached": "未到達",
      "none.short": "未入三網",
      "ev.none.noCarrier": "路徑上沒有出現電信 / 聯通 / 移動的 AS",
      "ev.none.noHops": "沒有任何回應的跳點",
      "ev.ct.gt.pre": "先經過電信 163（AS4134）再進 CN2",
      "ev.ct.gt.preOverseas": "先經過電信 163（AS4134，例如 163 的海外節點）再進 CN2",
      "ev.ct.gt.mid": "CN2 中間經過 163（AS4134）",
      "ev.ct.gt.post": "CN2 之後接上 202.97（163 骨幹）",
      "ev.ct.gt.post6": "CN2 之後接上 163 骨幹（240e:0:: / 2400:9380:8xxx）",
      "ev.ct.gia": "全程走 59.43（CN2），沒有經過 163，最後才交給當地電信",
      "ev.ct.gia6": "IPv6：{n} 跳 CN2（AS4809 前綴），沒有經過 163，最後才交給當地電信",
      "ev.ct.giaAmb": "IPv6：CN2 之後還有 {n} 跳 AS4134，可能是省網也可能是 163 骨幹",
      "ev.ct.cn2one": "只看到 1 跳 CN2，無法區分 GIA / GT",
      "ev.ct.ctg": "經過電信國際網 CTGNet（AS23764），未經 CN2",
      "ev.ct.ctg163": "經過電信國際網 CTGNet（AS23764），入境後接 163 骨幹，未經 CN2",
      "ev.ct.163": "經過{x}，沒有看到 CN2",
      "seen.bb202": "202.97 骨幹", "seen.bb6": "IPv6 163 骨幹段（240e:0:: / 2400:9380:8xxx）",
      "seen.overseas": "163 的海外節點（AS4134，例如 218.30.x）", "seen.as4134": "AS4134 骨幹（之後才交給當地電信省網）",
      "ev.ct.163v6multi": "IPv6：多跳 AS4134，無 CN2",
      "ev.ct.prov": "沒有經過 CN2 / 163 骨幹網段，直接進入電信當地網",
      "ev.cu.mix": "先經 4837 骨幹（{x}）再進 9929",
      "ev.cu.9929": "經過 AS9929（218.105 / 210.51）", "ev.cu.9929v6": "IPv6：經過 AS9929 的宣告前綴",
      "ev.cu.cug": "經過 AS10099", "ev.cu.cug169": "經過 AS10099，之後接 4837 骨幹",
      "ev.cu.4837": "經過 219.158（4837 / 169 骨幹）", "ev.cu.4837v6": "IPv6：經過 4837 / 169 骨幹（2408:8000::）",
      "ev.cu.4837v6multi": "IPv6：多跳 AS4837",
      "ev.cu.prov": "沒有經過 9929 / CUG / 4837 骨幹網段，直接進入聯通當地網",
      "ev.cm.mix": "先經 CMI（AS58453）再進 CMIN2", "ev.cm.cmin2": "經過 AS58807（CMIN2）",
      "ev.cm.cmi": "經過 AS58453（CMI），未見 CMIN2",
      "ev.cm.cmnet": "直接進 CMNET 骨幹（221.183 / 111.24）", "ev.cm.cmnetv6": "直接進 CMNET 骨幹（2409:8080::）",
      "ev.cm.prov": "沒有經過 CMIN2 / CMI / CMNET 骨幹，直接進入移動當地網",
      "ev.gap.entry": "交接點前有跳點沒有回應", "ev.asUnknown": "nexttrace 的 IP 資料查詢失敗（网络故障），部分跳點查不到 AS，看不出經過哪些國際業者", "intl.unknown": "部分跳點查不到 AS，無法判斷", "ev.gap.jump": "{x} 交接後延遲增加 {ms} ms，看不到三網自己的海外節點", "ev.ownLeg": "{x} 在海外（{g}）就交給 {n}，跨海由 {n} 自己的骨幹承載", "ev.ownLegNoGeo": "{x} 在海外就交給 {n}，跨海由 {n} 自己的骨幹承載", "ev.gap.unreached": "沒有到達目的地",
      "ev.cross": "{a}入境後才交給{b}", "ev.crossNear": "{a}入境後在目的地附近才交給{b}",
      "ev.sep": "；", "list.sep": "、",
      "intl.inside": "機房直接位於三網", "intl.direct": "機房直連三網",
      "intl.long": "；國際業者承載延遲 {ms} ms（長途承載）",
      "intl.shortOverseas": "；國際業者只承載 {ms} ms（在海外就交給三網，非直連）",
      "intl.shortLocal": "；國際業者只承載 {ms} ms（在當地就交給三網，非直連）",
      "seg.lan": "內網 / 本機閘道", "seg.lanIp": "內網", "seg.unknown": "未知 AS", "seg.local": "中國{x} 當地網", "seg.geoFixed": "依延遲修正，nexttrace 標示為 {x}",
      "err.login": "需要登入", "err.adminOnly": "僅管理員可觸發", "err.noResult": "沒有結果", "err.noIpv6": "此伺服器沒有 IPv6 路由", "err.resolve": "無法解析網域 {x}", "err.bigNeedNt": "{x} 的 TCP 模式不支援大封包，請安裝 nexttrace",
      "err.timeout": "等待結果逾時（agent 離線、未開放遠端執行，或探測時間過長）",
      "err.exec": "執行失敗 (exit {code})：{x}", "err.noTool": "找不到 nexttrace / mtr / traceroute，請在此伺服器安裝其中之一（建議 nexttrace 或 mtr）",
      "err.notSelected": "這台伺服器沒有被選入 IPv4 或 IPv6 檢測（請到插件設定選擇伺服器）",
      "page.title": "回程路由檢測", "page.sub": "每 {n} 分鐘自動檢測 · 點擊線路查看每個 AS 的詳細路徑",
      "page.runAll": "全部立即檢測", "page.run": "立即檢測", "page.running": "檢測中…",
      "page.noNodes": "沒有伺服器啟用 IPv{v} 檢測", "page.noResult": "尚無結果", "page.noData": "沒有資料",
      "page.why": "判斷依據", "page.intl": "國際段", "page.hops": "{n} 跳", "page.other": "其他",
      "page.loadFail": "讀取失敗：{x}", "page.runFail": "觸發失敗：{x}",
      "ago.never": "尚未檢測", "ago.s": "{n} 秒前", "ago.m": "{n} 分鐘前", "ago.h": "{n} 小時前", "ago.d": "{n} 天前",
      "float.title": "回程路由", "float.newTab": "新分頁開啟 ↗", "float.close": "關閉",
      "page.modeStd": "標準", "page.modeBig": "大包", "big.desc": "大包 TCP {port} · {size} 位元組", "big.short": "大包", "big.descAuto": "大包 TCP · {size} 位元組（port 依各目標）",
      "tg.help": "<b>回程路由檢測機器人</b>\n\n/list — 伺服器列表與目前線路\n/route &lt;伺服器&gt; — 查看最近一次結果\n/trace &lt;伺服器|all&gt; — 立即檢測回程\n/trace &lt;伺服器&gt; &lt;IP&gt; — 檢測到自訂 IP 的路徑\n/status — 執行狀態\n/id — 顯示你的 chat id\n\n&lt;伺服器&gt; 可填 /list 中的編號、名稱關鍵字或 UUID 開頭。",
      "tg.cmd.list": "伺服器列表與線路", "tg.cmd.route": "查看某台伺服器的回程", "tg.cmd.trace": "立即檢測回程 / 自訂 IP", "tg.cmd.status": "執行狀態", "tg.cmd.help": "說明",
      "tg.unauth": "⛔️ 未授權。\nchat id：<code>{chat}</code>\nuser id：<code>{user}</code>\n請把其中一個填到 Komari 插件設定的「允許的 Chat ID」。",
      "tg.id": "chat id：<code>{chat}</code>\nuser id：<code>{user}</code>", "tg.unknown": "未知指令，輸入 /help 查看。",
      "tg.noServers": "沒有可檢測的伺服器。", "tg.listTitle": "<b>伺服器列表</b>", "tg.noResultYet": "尚無結果",
      "tg.ambiguous": "符合多台伺服器，請說得更精確：", "tg.notFound": "找不到伺服器「{x}」，用 /list 查看。",
      "tg.usageRoute": "用法：/route &lt;伺服器&gt;", "tg.usageTrace": "用法：/trace &lt;伺服器|all&gt; [IP]",
      "tg.customOff": "管理員已關閉自訂 IP 檢測。", "tg.badIp": "IP 格式不正確（僅支援 IPv4 / IPv6，不支援網域）。",
      "tg.tracingCustom": "⏳ <b>{node}</b> → <code>{ip}</code> 檢測中…", "tg.busyOne": "⏳ 這台伺服器正在檢測中，請稍後再試。",
      "tg.dispatchFail": "❌ 下發失敗：{x}", "tg.offline": "伺服器離線", "tg.tracing": "⏳ 已下發回程檢測：{x}\n約需 1～3 分鐘…",
      "tg.busy": "⏳ 伺服器正在檢測中，請稍後再用 /route 查看。", "tg.done": "✅ 完成 {n} 台：{x}",
      "tg.custom": "自訂 {x}", "tg.line": "線路", "tg.why": "依據", "tg.intl": "國際段",
      "tg.btnTrace": "🔄 立即檢測", "tg.ok": "已下發檢測", "tg.cbUnauth": "未授權", "tg.cbNoServer": "伺服器不存在", "tg.noTarget": "沒有這個目標的結果。",
      "tg.statusTitle": "<b>狀態</b>", "tg.statusServers": "伺服器：{n} 台", "tg.statusV": "IPv{v}：{x}",
      "tg.statusVOn": "{t} 個目標，{s}", "tg.statusAll": "全部伺服器", "tg.statusN": "{n} 台伺服器", "tg.off": "關閉", "tg.on": "開啟",
      "tg.statusInterval": "自動檢測：每 {n} 分鐘", "tg.statusNotify": "線路變更通知：{x}", "tg.statusBusy": "檢測中：{x}", "tg.nothing": "無",
      "tg.changed": "⚠️ <b>{x}</b> 回程線路變更", "tg.chgTransit": "交接業者：{a} → {b}", "tg.noTransit": "無（直連）",
      "tg.chgConnect": "接入方式：{a} → {b}", "tg.chgEntry": "入境網路：{a} → {b}", "tg.chgCarriers": "途經電信商：{a} → {b}", "tg.chgRoute": "路徑網路：{a} → {b}",
      "tg.before": "原本", "tg.after": "現在", "tg.connect.overseas": "海外交接", "tg.generic.ct": "電信 163", "tg.generic.cu": "聯通 4837", "tg.generic.cm": "移動 9808",
      "tg.timeSep": "·"
    },
    "zh-CN": {
      "carrier.ct": "电信", "carrier.cu": "联通", "carrier.cm": "移动",
      "prov.ct": "电信省网", "prov.cu": "联通省网", "prov.cm": "移动省网",
      "mix": "{x} 混合",
      "access.direct": "直连", "access.long": "长途承载", "access.local": "当地交接", "access.overseas": "经 {x} 海外交接", "access.overseasShort": "海外交接", "access.unknown": "国际段 AS 查询失败",
      "conf.inferred": "推测", "conf.insufficient": "证据不足", "unreached": "未到达",
      "none.short": "未入三网",
      "ev.none.noCarrier": "路径上没有出现电信 / 联通 / 移动的 AS",
      "ev.none.noHops": "没有任何回应的跳点",
      "ev.ct.gt.pre": "先经过电信 163（AS4134）再进 CN2",
      "ev.ct.gt.preOverseas": "先经过电信 163（AS4134，例如 163 的海外节点）再进 CN2",
      "ev.ct.gt.mid": "CN2 中间经过 163（AS4134）",
      "ev.ct.gt.post": "CN2 之后接上 202.97（163 骨干）",
      "ev.ct.gt.post6": "CN2 之后接上 163 骨干（240e:0:: / 2400:9380:8xxx）",
      "ev.ct.gia": "全程走 59.43（CN2），没有经过 163，最后才交给当地电信",
      "ev.ct.gia6": "IPv6：{n} 跳 CN2（AS4809 前缀），没有经过 163，最后才交给当地电信",
      "ev.ct.giaAmb": "IPv6：CN2 之后还有 {n} 跳 AS4134，可能是省网也可能是 163 骨干",
      "ev.ct.cn2one": "只看到 1 跳 CN2，无法区分 GIA / GT",
      "ev.ct.ctg": "经过电信国际网 CTGNet（AS23764），未经 CN2",
      "ev.ct.ctg163": "经过电信国际网 CTGNet（AS23764），入境后接 163 骨干，未经 CN2",
      "ev.ct.163": "经过{x}，没有看到 CN2",
      "seen.bb202": "202.97 骨干", "seen.bb6": "IPv6 163 骨干段（240e:0:: / 2400:9380:8xxx）",
      "seen.overseas": "163 的海外节点（AS4134，例如 218.30.x）", "seen.as4134": "AS4134 骨干（之后才交给当地电信省网）",
      "ev.ct.163v6multi": "IPv6：多跳 AS4134，无 CN2",
      "ev.ct.prov": "没有经过 CN2 / 163 骨干网段，直接进入电信当地网",
      "ev.cu.mix": "先经 4837 骨干（{x}）再进 9929",
      "ev.cu.9929": "经过 AS9929（218.105 / 210.51）", "ev.cu.9929v6": "IPv6：经过 AS9929 的宣告前缀",
      "ev.cu.cug": "经过 AS10099", "ev.cu.cug169": "经过 AS10099，之后接 4837 骨干",
      "ev.cu.4837": "经过 219.158（4837 / 169 骨干）", "ev.cu.4837v6": "IPv6：经过 4837 / 169 骨干（2408:8000::）",
      "ev.cu.4837v6multi": "IPv6：多跳 AS4837",
      "ev.cu.prov": "没有经过 9929 / CUG / 4837 骨干网段，直接进入联通当地网",
      "ev.cm.mix": "先经 CMI（AS58453）再进 CMIN2", "ev.cm.cmin2": "经过 AS58807（CMIN2）",
      "ev.cm.cmi": "经过 AS58453（CMI），未见 CMIN2",
      "ev.cm.cmnet": "直接进 CMNET 骨干（221.183 / 111.24）", "ev.cm.cmnetv6": "直接进 CMNET 骨干（2409:8080::）",
      "ev.cm.prov": "没有经过 CMIN2 / CMI / CMNET 骨干，直接进入移动当地网",
      "ev.gap.entry": "交接点前有跳点没有回应", "ev.asUnknown": "nexttrace 的 IP 数据查询失败（网络故障），部分跳点查不到 AS，看不出经过哪些国际运营商", "intl.unknown": "部分跳点查不到 AS，无法判断", "ev.gap.jump": "{x} 交接后延迟增加 {ms} ms，看不到三网自己的海外节点", "ev.ownLeg": "{x} 在海外（{g}）就交给 {n}，跨海由 {n} 自己的骨干承载", "ev.ownLegNoGeo": "{x} 在海外就交给 {n}，跨海由 {n} 自己的骨干承载", "ev.gap.unreached": "没有到达目的地",
      "ev.cross": "{a}入境后才交给{b}", "ev.crossNear": "{a}入境后在目的地附近才交给{b}",
      "ev.sep": "；", "list.sep": "、",
      "intl.inside": "机房直接位于三网", "intl.direct": "机房直连三网",
      "intl.long": "；国际运营商承载延迟 {ms} ms（长途承载）",
      "intl.shortOverseas": "；国际运营商只承载 {ms} ms（在海外就交给三网，非直连）",
      "intl.shortLocal": "；国际运营商只承载 {ms} ms（在当地就交给三网，非直连）",
      "seg.lan": "内网 / 本机网关", "seg.lanIp": "内网", "seg.unknown": "未知 AS", "seg.local": "中国{x} 当地网", "seg.geoFixed": "依延迟修正，nexttrace 标示为 {x}",
      "err.login": "需要登录", "err.adminOnly": "仅管理员可触发", "err.noResult": "没有结果", "err.noIpv6": "此服务器没有 IPv6 路由", "err.resolve": "无法解析域名 {x}", "err.bigNeedNt": "{x} 的 TCP 模式不支持大封包，请安装 nexttrace",
      "err.timeout": "等待结果超时（agent 离线、未开放远程执行，或探测时间过长）",
      "err.exec": "执行失败 (exit {code})：{x}", "err.noTool": "找不到 nexttrace / mtr / traceroute，请在此服务器安装其中之一（建议 nexttrace 或 mtr）",
      "err.notSelected": "这台服务器没有被选入 IPv4 或 IPv6 检测（请到插件设置选择服务器）",
      "page.title": "回程路由检测", "page.sub": "每 {n} 分钟自动检测 · 点击线路查看每个 AS 的详细路径",
      "page.runAll": "全部立即检测", "page.run": "立即检测", "page.running": "检测中…",
      "page.noNodes": "没有服务器启用 IPv{v} 检测", "page.noResult": "暂无结果", "page.noData": "没有数据",
      "page.why": "判断依据", "page.intl": "国际段", "page.hops": "{n} 跳", "page.other": "其他",
      "page.loadFail": "读取失败：{x}", "page.runFail": "触发失败：{x}",
      "ago.never": "尚未检测", "ago.s": "{n} 秒前", "ago.m": "{n} 分钟前", "ago.h": "{n} 小时前", "ago.d": "{n} 天前",
      "float.title": "回程路由", "float.newTab": "新标签页打开 ↗", "float.close": "关闭",
      "page.modeStd": "标准", "page.modeBig": "大包", "big.desc": "大包 TCP {port} · {size} 字节", "big.short": "大包", "big.descAuto": "大包 TCP · {size} 字节（port 依各目标）",
      "tg.help": "<b>回程路由检测机器人</b>\n\n/list — 服务器列表与当前线路\n/route &lt;服务器&gt; — 查看最近一次结果\n/trace &lt;服务器|all&gt; — 立即检测回程\n/trace &lt;服务器&gt; &lt;IP&gt; — 检测到自定义 IP 的路径\n/status — 运行状态\n/id — 显示你的 chat id\n\n&lt;服务器&gt; 可填 /list 中的编号、名称关键字或 UUID 开头。",
      "tg.cmd.list": "服务器列表与线路", "tg.cmd.route": "查看某台服务器的回程", "tg.cmd.trace": "立即检测回程 / 自定义 IP", "tg.cmd.status": "运行状态", "tg.cmd.help": "说明",
      "tg.unauth": "⛔️ 未授权。\nchat id：<code>{chat}</code>\nuser id：<code>{user}</code>\n请把其中一个填到 Komari 插件设置的「允许的 Chat ID」。",
      "tg.id": "chat id：<code>{chat}</code>\nuser id：<code>{user}</code>", "tg.unknown": "未知命令，输入 /help 查看。",
      "tg.noServers": "没有可检测的服务器。", "tg.listTitle": "<b>服务器列表</b>", "tg.noResultYet": "暂无结果",
      "tg.ambiguous": "匹配到多台服务器，请说得更精确：", "tg.notFound": "找不到服务器「{x}」，用 /list 查看。",
      "tg.usageRoute": "用法：/route &lt;服务器&gt;", "tg.usageTrace": "用法：/trace &lt;服务器|all&gt; [IP]",
      "tg.customOff": "管理员已关闭自定义 IP 检测。", "tg.badIp": "IP 格式不正确（仅支持 IPv4 / IPv6，不支持域名）。",
      "tg.tracingCustom": "⏳ <b>{node}</b> → <code>{ip}</code> 检测中…", "tg.busyOne": "⏳ 这台服务器正在检测中，请稍后再试。",
      "tg.dispatchFail": "❌ 下发失败：{x}", "tg.offline": "服务器离线", "tg.tracing": "⏳ 已下发回程检测：{x}\n约需 1～3 分钟…",
      "tg.busy": "⏳ 服务器正在检测中，请稍后再用 /route 查看。", "tg.done": "✅ 完成 {n} 台：{x}",
      "tg.custom": "自定义 {x}", "tg.line": "线路", "tg.why": "依据", "tg.intl": "国际段",
      "tg.btnTrace": "🔄 立即检测", "tg.ok": "已下发检测", "tg.cbUnauth": "未授权", "tg.cbNoServer": "服务器不存在", "tg.noTarget": "没有这个目标的结果。",
      "tg.statusTitle": "<b>状态</b>", "tg.statusServers": "服务器：{n} 台", "tg.statusV": "IPv{v}：{x}",
      "tg.statusVOn": "{t} 个目标，{s}", "tg.statusAll": "全部服务器", "tg.statusN": "{n} 台服务器", "tg.off": "关闭", "tg.on": "开启",
      "tg.statusInterval": "自动检测：每 {n} 分钟", "tg.statusNotify": "线路变更通知：{x}", "tg.statusBusy": "检测中：{x}", "tg.nothing": "无",
      "tg.changed": "⚠️ <b>{x}</b> 回程线路变更", "tg.chgTransit": "交接运营商：{a} → {b}", "tg.noTransit": "无（直连）",
      "tg.chgConnect": "接入方式：{a} → {b}", "tg.chgEntry": "入境网络：{a} → {b}", "tg.chgCarriers": "途经运营商：{a} → {b}", "tg.chgRoute": "路径网络：{a} → {b}",
      "tg.before": "原本", "tg.after": "现在", "tg.connect.overseas": "海外交接", "tg.generic.ct": "电信 163", "tg.generic.cu": "联通 4837", "tg.generic.cm": "移动 9808",
      "tg.timeSep": "·"
    },
    "en": {
      "carrier.ct": "Telecom", "carrier.cu": "Unicom", "carrier.cm": "Mobile",
      "prov.ct": "Telecom provincial", "prov.cu": "Unicom provincial", "prov.cm": "Mobile provincial",
      "mix": "{x} mixed",
      "access.direct": "Direct", "access.long": "Long-haul transit", "access.local": "Local handoff", "access.overseas": "Via {x}, handed off abroad", "access.overseasShort": "Handed off abroad", "access.unknown": "Transit AS lookup failed",
      "conf.inferred": "Inferred", "conf.insufficient": "Insufficient evidence", "unreached": "Not reached",
      "none.short": "Not in China networks",
      "ev.none.noCarrier": "No China Telecom / Unicom / Mobile AS on the path",
      "ev.none.noHops": "No hop responded",
      "ev.ct.gt.pre": "Enters China Telecom 163 (AS4134) before CN2",
      "ev.ct.gt.preOverseas": "Enters China Telecom 163 (AS4134, e.g. an overseas 163 node) before CN2",
      "ev.ct.gt.mid": "Passes 163 (AS4134) in the middle of CN2",
      "ev.ct.gt.post": "CN2 continues onto 202.97 (163 backbone)",
      "ev.ct.gt.post6": "CN2 continues onto the 163 backbone (240e:0:: / 2400:9380:8xxx)",
      "ev.ct.gia": "CN2 (59.43) all the way without 163, handed to the local network only at the end",
      "ev.ct.gia6": "IPv6: {n} CN2 hops (AS4809 prefixes) without 163, handed to the local network only at the end",
      "ev.ct.giaAmb": "IPv6: {n} AS4134 hops after CN2, which may be provincial or the 163 backbone",
      "ev.ct.cn2one": "Only one CN2 hop seen; cannot tell GIA from GT",
      "ev.ct.ctg": "Via China Telecom's international network CTGNet (AS23764), no CN2",
      "ev.ct.ctg163": "Via CTGNet (AS23764), then the 163 backbone after entering China, no CN2",
      "ev.ct.163": "Via {x}; no CN2 seen",
      "seen.bb202": "the 202.97 backbone", "seen.bb6": "the IPv6 163 backbone (240e:0:: / 2400:9380:8xxx)",
      "seen.overseas": "an overseas 163 node (AS4134, e.g. 218.30.x)", "seen.as4134": "the AS4134 backbone (before the provincial network)",
      "ev.ct.163v6multi": "IPv6: several AS4134 hops, no CN2",
      "ev.ct.prov": "No CN2 / 163 backbone hops; enters the local Telecom network directly",
      "ev.cu.mix": "4837 backbone ({x}) before 9929",
      "ev.cu.9929": "Via AS9929 (218.105 / 210.51)", "ev.cu.9929v6": "IPv6: via announced AS9929 prefixes",
      "ev.cu.cug": "Via AS10099", "ev.cu.cug169": "Via AS10099, then the 4837 backbone",
      "ev.cu.4837": "Via 219.158 (4837 / 169 backbone)", "ev.cu.4837v6": "IPv6: via the 4837 / 169 backbone (2408:8000::)",
      "ev.cu.4837v6multi": "IPv6: several AS4837 hops",
      "ev.cu.prov": "No 9929 / CUG / 4837 backbone hops; enters the local Unicom network directly",
      "ev.cm.mix": "CMI (AS58453) before CMIN2", "ev.cm.cmin2": "Via AS58807 (CMIN2)",
      "ev.cm.cmi": "Via AS58453 (CMI), no CMIN2",
      "ev.cm.cmnet": "Directly into the CMNET backbone (221.183 / 111.24)", "ev.cm.cmnetv6": "Directly into the CMNET backbone (2409:8080::)",
      "ev.cm.prov": "No CMIN2 / CMI / CMNET backbone; enters the local Mobile network directly",
      "ev.gap.entry": "Some hops before the handoff did not respond", "ev.asUnknown": "nexttrace's IP lookup failed, so some hops have no AS and the transit carriers are unknown", "intl.unknown": "Some hops have no AS; cannot tell", "ev.gap.jump": "Latency rises {ms} ms after the {x} handoff; no overseas node of the China carrier is visible", "ev.ownLeg": "{x} hands over to {n} abroad ({g}); {n} carries it across the sea on its own backbone", "ev.ownLegNoGeo": "{x} hands over to {n} abroad; {n} carries it across the sea on its own backbone", "ev.gap.unreached": "Destination not reached",
      "ev.cross": "{a} carries it into China, then hands over to {b}", "ev.crossNear": "{a} carries it into China and hands over to {b} near the destination",
      "ev.sep": "; ", "list.sep": ", ",
      "intl.inside": "Server is inside a China carrier network", "intl.direct": "Server connects directly to China carriers",
      "intl.long": "; transit carried {ms} ms (long-haul)",
      "intl.shortOverseas": "; transit carried only {ms} ms (handed to China carriers abroad, not direct)",
      "intl.shortLocal": "; transit carried only {ms} ms (handed to China carriers locally, not direct)",
      "seg.lan": "LAN / local gateway", "seg.lanIp": "LAN", "seg.unknown": "Unknown AS", "seg.local": "China {x} local network", "seg.geoFixed": "corrected by latency; nexttrace said {x}",
      "err.login": "Login required", "err.adminOnly": "Admins only", "err.noResult": "No result", "err.noIpv6": "This server has no IPv6 route", "err.resolve": "Could not resolve {x}", "err.bigNeedNt": "{x} ignores packet size in TCP mode; install nexttrace",
      "err.timeout": "Timed out waiting for the result (agent offline, remote execution disabled, or the trace took too long)",
      "err.exec": "Execution failed (exit {code}): {x}", "err.noTool": "nexttrace / mtr / traceroute not found; install one of them on this server (nexttrace or mtr recommended)",
      "err.notSelected": "This server is not selected for IPv4 or IPv6 checks (choose servers in the plugin settings)",
      "page.title": "Return Route Check", "page.sub": "Checked every {n} minutes · click a route for per-AS details",
      "page.runAll": "Check all now", "page.run": "Check now", "page.running": "Checking…",
      "page.noNodes": "No server has IPv{v} checks enabled", "page.noResult": "No results yet", "page.noData": "No data",
      "page.why": "Basis", "page.intl": "International", "page.hops": "{n} hops", "page.hops_1": "{n} hop", "page.other": "Other",
      "page.loadFail": "Failed to load: {x}", "page.runFail": "Failed to start: {x}",
      "ago.never": "Not checked yet", "ago.s": "{n}s ago", "ago.m": "{n} min ago", "ago.h": "{n} h ago", "ago.d": "{n} d ago",
      "float.title": "Return Route", "float.newTab": "Open in new tab ↗", "float.close": "Close",
      "page.modeStd": "Standard", "page.modeBig": "Large", "big.desc": "Large packets, TCP {port} · {size} bytes", "big.short": "Large", "big.descAuto": "Large packets, TCP · {size} bytes (port per target)",
      "tg.help": "<b>Return route check bot</b>\n\n/list — servers and current routes\n/route &lt;server&gt; — latest result\n/trace &lt;server|all&gt; — check the return route now\n/trace &lt;server&gt; &lt;IP&gt; — trace to a custom IP\n/status — status\n/id — show your chat id\n\n&lt;server&gt; can be the number from /list, part of the name, or the start of the UUID.",
      "tg.cmd.list": "Servers and routes", "tg.cmd.route": "Return route of a server", "tg.cmd.trace": "Check now / custom IP", "tg.cmd.status": "Status", "tg.cmd.help": "Help",
      "tg.unauth": "⛔️ Not authorized.\nchat id: <code>{chat}</code>\nuser id: <code>{user}</code>\nAdd one of them to \"Allowed Chat IDs\" in the Komari plugin settings.",
      "tg.id": "chat id: <code>{chat}</code>\nuser id: <code>{user}</code>", "tg.unknown": "Unknown command. Send /help.",
      "tg.noServers": "No servers to check.", "tg.listTitle": "<b>Servers</b>", "tg.noResultYet": "No results yet",
      "tg.ambiguous": "Several servers match; be more specific:", "tg.notFound": "Server \"{x}\" not found. See /list.",
      "tg.usageRoute": "Usage: /route &lt;server&gt;", "tg.usageTrace": "Usage: /trace &lt;server|all&gt; [IP]",
      "tg.customOff": "Custom IP traces are disabled by the admin.", "tg.badIp": "Invalid IP (IPv4 / IPv6 only, no domains).",
      "tg.tracingCustom": "⏳ <b>{node}</b> → <code>{ip}</code> tracing…", "tg.busyOne": "⏳ This server is already being checked; try again later.",
      "tg.dispatchFail": "❌ Failed to dispatch: {x}", "tg.offline": "server offline", "tg.tracing": "⏳ Return route check started: {x}\nTakes about 1–3 minutes…",
      "tg.busy": "⏳ The server is being checked; use /route later.", "tg.done": "✅ Finished {n} servers: {x}",
      "tg.custom": "Custom {x}", "tg.line": "Route", "tg.why": "Basis", "tg.intl": "International",
      "tg.btnTrace": "🔄 Check now", "tg.ok": "Check started", "tg.cbUnauth": "Not authorized", "tg.cbNoServer": "Server not found", "tg.noTarget": "No result for this target.",
      "tg.statusTitle": "<b>Status</b>", "tg.statusServers": "Servers: {n}", "tg.statusV": "IPv{v}: {x}",
      "tg.statusVOn": "{t} targets, {s}", "tg.statusAll": "all servers", "tg.statusN": "{n} servers", "tg.off": "off", "tg.on": "on",
      "tg.statusInterval": "Auto check: every {n} min", "tg.statusNotify": "Route change alerts: {x}", "tg.statusBusy": "Checking: {x}", "tg.nothing": "none",
      "tg.changed": "⚠️ <b>{x}</b> return route changed", "tg.chgTransit": "Transit: {a} → {b}", "tg.noTransit": "none (direct)",
      "tg.chgConnect": "Access: {a} → {b}", "tg.chgEntry": "Entry network: {a} → {b}", "tg.chgCarriers": "Carriers on the way: {a} → {b}", "tg.chgRoute": "Route networks: {a} → {b}",
      "tg.before": "Before", "tg.after": "Now", "tg.connect.overseas": "Handoff abroad", "tg.generic.ct": "Telecom 163", "tg.generic.cu": "Unicom 4837", "tg.generic.cm": "Mobile 9808",
      "tg.timeSep": "·"
    },
    "ja": {
      "carrier.ct": "電信", "carrier.cu": "聯通", "carrier.cm": "移動",
      "prov.ct": "電信 省内網", "prov.cu": "聯通 省内網", "prov.cm": "移動 省内網",
      "mix": "{x} 混在",
      "access.direct": "直結", "access.long": "長距離中継", "access.local": "現地で引き渡し", "access.overseas": "{x} 経由・海外で引き渡し", "access.overseasShort": "海外で引き渡し", "access.unknown": "国際区間の AS 照会に失敗",
      "conf.inferred": "推定", "conf.insufficient": "根拠不足", "unreached": "未到達",
      "none.short": "中国キャリア網外",
      "ev.none.noCarrier": "経路上に中国電信 / 聯通 / 移動の AS がありません",
      "ev.none.noHops": "応答したホップがありません",
      "ev.ct.gt.pre": "中国電信 163（AS4134）を経由してから CN2 に入ります",
      "ev.ct.gt.preOverseas": "中国電信 163（AS4134、例：163 の海外ノード）を経由してから CN2 に入ります",
      "ev.ct.gt.mid": "CN2 の途中で 163（AS4134）を経由します",
      "ev.ct.gt.post": "CN2 の後に 202.97（163 バックボーン）へ接続します",
      "ev.ct.gt.post6": "CN2 の後に 163 バックボーン（240e:0:: / 2400:9380:8xxx）へ接続します",
      "ev.ct.gia": "全区間 59.43（CN2）で 163 を経由せず、最後に地域の電信網へ引き渡し",
      "ev.ct.gia6": "IPv6：CN2 が {n} ホップ（AS4809 プレフィックス）、163 を経由せず最後に地域網へ引き渡し",
      "ev.ct.giaAmb": "IPv6：CN2 の後に AS4134 が {n} ホップあり、省内網か 163 バックボーンか判別できません",
      "ev.ct.cn2one": "CN2 が 1 ホップのみで、GIA / GT を判別できません",
      "ev.ct.ctg": "中国電信の国際網 CTGNet（AS23764）経由、CN2 なし",
      "ev.ct.ctg163": "CTGNet（AS23764）経由、中国国内で 163 バックボーンへ接続、CN2 なし",
      "ev.ct.163": "{x}を経由、CN2 は見られません",
      "seen.bb202": "202.97 バックボーン", "seen.bb6": "IPv6 の 163 バックボーン（240e:0:: / 2400:9380:8xxx）",
      "seen.overseas": "163 の海外ノード（AS4134、例：218.30.x）", "seen.as4134": "AS4134 バックボーン（その後に省内網）",
      "ev.ct.163v6multi": "IPv6：AS4134 が複数ホップ、CN2 なし",
      "ev.ct.prov": "CN2 / 163 バックボーンを経由せず、地域の電信網に直接入ります",
      "ev.cu.mix": "4837 バックボーン（{x}）を経由してから 9929 に入ります",
      "ev.cu.9929": "AS9929（218.105 / 210.51）経由", "ev.cu.9929v6": "IPv6：AS9929 の広告プレフィックス経由",
      "ev.cu.cug": "AS10099 経由", "ev.cu.cug169": "AS10099 経由、その後 4837 バックボーン",
      "ev.cu.4837": "219.158（4837 / 169 バックボーン）経由", "ev.cu.4837v6": "IPv6：4837 / 169 バックボーン（2408:8000::）経由",
      "ev.cu.4837v6multi": "IPv6：AS4837 が複数ホップ",
      "ev.cu.prov": "9929 / CUG / 4837 バックボーンを経由せず、地域の聯通網に直接入ります",
      "ev.cm.mix": "CMI（AS58453）を経由してから CMIN2 に入ります", "ev.cm.cmin2": "AS58807（CMIN2）経由",
      "ev.cm.cmi": "AS58453（CMI）経由、CMIN2 なし",
      "ev.cm.cmnet": "CMNET バックボーン（221.183 / 111.24）に直接入ります", "ev.cm.cmnetv6": "CMNET バックボーン（2409:8080::）に直接入ります",
      "ev.cm.prov": "CMIN2 / CMI / CMNET バックボーンを経由せず、地域の移動網に直接入ります",
      "ev.gap.entry": "引き渡し前に応答しないホップがあります", "ev.asUnknown": "nexttrace の IP 情報照会に失敗し、一部のホップの AS が不明のため国際キャリアを判別できません", "intl.unknown": "一部のホップの AS が不明のため判別不可", "ev.gap.jump": "{x} での引き渡し後に遅延が {ms} ms 増加、中国キャリア自身の海外ノードは見えません", "ev.ownLeg": "{x} が海外（{g}）で {n} に引き渡し、海を越える区間は {n} 自身のバックボーン", "ev.ownLegNoGeo": "{x} が海外で {n} に引き渡し、海を越える区間は {n} 自身のバックボーン", "ev.gap.unreached": "宛先に到達していません",
      "ev.cross": "{a}が中国に入った後に{b}へ引き渡し", "ev.crossNear": "{a}が中国に入り、宛先付近で{b}へ引き渡し",
      "ev.sep": "；", "list.sep": "、",
      "intl.inside": "サーバーは中国キャリア網内にあります", "intl.direct": "サーバーは中国キャリアに直結",
      "intl.long": "；国際キャリアの中継 {ms} ms（長距離中継）",
      "intl.shortOverseas": "；国際キャリアの中継は {ms} ms のみ（海外で中国キャリアへ引き渡し、直結ではない）",
      "intl.shortLocal": "；国際キャリアの中継は {ms} ms のみ（現地で中国キャリアへ引き渡し、直結ではない）",
      "seg.lan": "LAN / ローカルゲートウェイ", "seg.lanIp": "LAN", "seg.unknown": "不明な AS", "seg.local": "中国{x} 地域網", "seg.geoFixed": "遅延から補正（nexttrace の表示：{x}）",
      "err.login": "ログインが必要です", "err.adminOnly": "管理者のみ実行できます", "err.noResult": "結果なし", "err.noIpv6": "このサーバーには IPv6 経路がありません", "err.resolve": "{x} を名前解決できません", "err.bigNeedNt": "{x} の TCP モードは大パケット非対応のため nexttrace を導入してください",
      "err.timeout": "結果待ちがタイムアウトしました（agent がオフライン、リモート実行が無効、またはトレースに時間がかかりすぎ）",
      "err.exec": "実行失敗 (exit {code})：{x}", "err.noTool": "nexttrace / mtr / traceroute が見つかりません。このサーバーにいずれかをインストールしてください（nexttrace か mtr 推奨）",
      "err.notSelected": "このサーバーは IPv4 / IPv6 の検査対象に選ばれていません（プラグイン設定で選択してください）",
      "page.title": "帰路ルート検査", "page.sub": "{n} 分ごとに自動検査 · ルートをクリックすると AS ごとの詳細を表示",
      "page.runAll": "すべて今すぐ検査", "page.run": "今すぐ検査", "page.running": "検査中…",
      "page.noNodes": "IPv{v} 検査が有効なサーバーがありません", "page.noResult": "まだ結果がありません", "page.noData": "データなし",
      "page.why": "判定根拠", "page.intl": "国際区間", "page.hops": "{n} ホップ", "page.other": "その他",
      "page.loadFail": "読み込み失敗：{x}", "page.runFail": "開始失敗：{x}",
      "ago.never": "未検査", "ago.s": "{n} 秒前", "ago.m": "{n} 分前", "ago.h": "{n} 時間前", "ago.d": "{n} 日前",
      "float.title": "帰路ルート", "float.newTab": "新しいタブで開く ↗", "float.close": "閉じる",
      "page.modeStd": "標準", "page.modeBig": "大パケット", "big.desc": "大パケット TCP {port} · {size} バイト", "big.short": "大", "big.descAuto": "大パケット TCP · {size} バイト（port はターゲットごと）",
      "tg.help": "<b>帰路ルート検査ボット</b>\n\n/list — サーバー一覧と現在のルート\n/route &lt;サーバー&gt; — 最新の結果\n/trace &lt;サーバー|all&gt; — 今すぐ帰路を検査\n/trace &lt;サーバー&gt; &lt;IP&gt; — 任意の IP までトレース\n/status — 状態\n/id — chat id を表示\n\n&lt;サーバー&gt; には /list の番号、名前の一部、UUID の先頭を指定できます。",
      "tg.cmd.list": "サーバー一覧とルート", "tg.cmd.route": "サーバーの帰路ルート", "tg.cmd.trace": "今すぐ検査 / 任意の IP", "tg.cmd.status": "状態", "tg.cmd.help": "ヘルプ",
      "tg.unauth": "⛔️ 権限がありません。\nchat id：<code>{chat}</code>\nuser id：<code>{user}</code>\nどちらかを Komari プラグイン設定の「許可する Chat ID」に追加してください。",
      "tg.id": "chat id：<code>{chat}</code>\nuser id：<code>{user}</code>", "tg.unknown": "不明なコマンドです。/help を送ってください。",
      "tg.noServers": "検査できるサーバーがありません。", "tg.listTitle": "<b>サーバー一覧</b>", "tg.noResultYet": "まだ結果がありません",
      "tg.ambiguous": "複数のサーバーが一致しました。もっと具体的に指定してください：", "tg.notFound": "サーバー「{x}」が見つかりません。/list を確認してください。",
      "tg.usageRoute": "使い方：/route &lt;サーバー&gt;", "tg.usageTrace": "使い方：/trace &lt;サーバー|all&gt; [IP]",
      "tg.customOff": "任意の IP へのトレースは管理者により無効化されています。", "tg.badIp": "IP の形式が正しくありません（IPv4 / IPv6 のみ、ドメイン不可）。",
      "tg.tracingCustom": "⏳ <b>{node}</b> → <code>{ip}</code> トレース中…", "tg.busyOne": "⏳ このサーバーは検査中です。しばらくしてから再試行してください。",
      "tg.dispatchFail": "❌ 送信失敗：{x}", "tg.offline": "サーバーがオフライン", "tg.tracing": "⏳ 帰路検査を開始しました：{x}\n約 1～3 分かかります…",
      "tg.busy": "⏳ サーバーは検査中です。後で /route で確認してください。", "tg.done": "✅ {n} 台完了：{x}",
      "tg.custom": "任意 {x}", "tg.line": "ルート", "tg.why": "根拠", "tg.intl": "国際区間",
      "tg.btnTrace": "🔄 今すぐ検査", "tg.ok": "検査を開始しました", "tg.cbUnauth": "権限がありません", "tg.cbNoServer": "サーバーが存在しません", "tg.noTarget": "この対象の結果はありません。",
      "tg.statusTitle": "<b>状態</b>", "tg.statusServers": "サーバー：{n} 台", "tg.statusV": "IPv{v}：{x}",
      "tg.statusVOn": "対象 {t} 件、{s}", "tg.statusAll": "全サーバー", "tg.statusN": "{n} 台", "tg.off": "オフ", "tg.on": "オン",
      "tg.statusInterval": "自動検査：{n} 分ごと", "tg.statusNotify": "ルート変更通知：{x}", "tg.statusBusy": "検査中：{x}", "tg.nothing": "なし",
      "tg.changed": "⚠️ <b>{x}</b> の帰路ルートが変わりました", "tg.chgTransit": "引き渡し事業者：{a} → {b}", "tg.noTransit": "なし（直結）",
      "tg.chgConnect": "接続方式：{a} → {b}", "tg.chgEntry": "入国ネットワーク：{a} → {b}", "tg.chgCarriers": "経由キャリア：{a} → {b}", "tg.chgRoute": "経路ネットワーク：{a} → {b}",
      "tg.before": "以前", "tg.after": "現在", "tg.connect.overseas": "海外で引き渡し", "tg.generic.ct": "電信 163", "tg.generic.cu": "聯通 4837", "tg.generic.cm": "移動 9808",
      "tg.timeSep": "·"
    }
  };

  function t(lang, key, p) {
    var d = D[lang] || D.en;
    var s = p && p.n === 1 && d[key + "_1"] !== undefined ? d[key + "_1"] : d[key]; // 單數形（英文 1 hop）
    if (s === undefined) s = D.en[key];
    if (s === undefined) s = key;
    if (p) s = String(s).replace(/\{(\w+)\}/g, function (m, k) { return p[k] === undefined ? m : p[k]; });
    return s;
  }

  // ---------------- 省份（Zstatic 節點代碼） ----------------
  var PROVINCES = {
    bj: ["北京", "北京", "Beijing", "北京"], tj: ["天津", "天津", "Tianjin", "天津"], he: ["河北", "河北", "Hebei", "河北"],
    sx: ["山西", "山西", "Shanxi", "山西"], nm: ["內蒙古", "内蒙古", "Inner Mongolia", "内モンゴル"], ln: ["遼寧", "辽宁", "Liaoning", "遼寧"],
    jl: ["吉林", "吉林", "Jilin", "吉林"], hl: ["黑龍江", "黑龙江", "Heilongjiang", "黒竜江"], sh: ["上海", "上海", "Shanghai", "上海"],
    js: ["江蘇", "江苏", "Jiangsu", "江蘇"], zj: ["浙江", "浙江", "Zhejiang", "浙江"], ah: ["安徽", "安徽", "Anhui", "安徽"],
    fj: ["福建", "福建", "Fujian", "福建"], jx: ["江西", "江西", "Jiangxi", "江西"], sd: ["山東", "山东", "Shandong", "山東"],
    ha: ["河南", "河南", "Henan", "河南"], hb: ["湖北", "湖北", "Hubei", "湖北"], hn: ["湖南", "湖南", "Hunan", "湖南"],
    gd: ["廣東", "广东", "Guangdong", "広東"], gx: ["廣西", "广西", "Guangxi", "広西"], hi: ["海南", "海南", "Hainan", "海南"],
    cq: ["重慶", "重庆", "Chongqing", "重慶"], sc: ["四川", "四川", "Sichuan", "四川"], gz: ["貴州", "贵州", "Guizhou", "貴州"],
    yn: ["雲南", "云南", "Yunnan", "雲南"], xz: ["西藏", "西藏", "Tibet", "チベット"], sn: ["陝西", "陕西", "Shaanxi", "陝西"],
    gs: ["甘肅", "甘肃", "Gansu", "甘粛"], qh: ["青海", "青海", "Qinghai", "青海"], nx: ["寧夏", "宁夏", "Ningxia", "寧夏"],
    xj: ["新疆", "新疆", "Xinjiang", "新疆"]
  };
  function province(lang, code) {
    var p = PROVINCES[code];
    if (!p) return code;
    return p[Math.max(0, LANGS.indexOf(lang))] || p[2];
  }
  // 目標名稱：Zstatic 目標依語系組合「省份 + 電信商」，自訂目標照原名
  function targetLabel(lang, tgt) {
    if (tgt && tgt.region) {
      var sep = lang === "en" ? " " : "";
      return province(lang, tgt.region) + sep + t(lang, "carrier." + tgt.isp);
    }
    if (tgt && tgt.custom) return t(lang, "tg.custom", { x: tgt.custom });
    return (tgt && tgt.label) || "";
  }

  // ---------------- AS 名稱 ----------------
  // 中國三網：依語系
  var CN_AS = {
    4134: ["中國電信 ChinaNet (163 骨幹 / 省網)", "中国电信 ChinaNet（163 骨干 / 省网）", "China Telecom ChinaNet (163 backbone / provincial)", "中国電信 ChinaNet（163 バックボーン / 省内網）"],
    4809: ["中國電信 CN2", "中国电信 CN2", "China Telecom CN2", "中国電信 CN2"],
    4812: ["中國電信 上海", "中国电信 上海", "China Telecom Shanghai", "中国電信 上海"],
    4811: ["中國電信 上海", "中国电信 上海", "China Telecom Shanghai", "中国電信 上海"],
    23764: ["中國電信 CTGNet", "中国电信 CTGNet", "China Telecom CTGNet", "中国電信 CTGNet"],
    23724: ["中國電信 IDC", "中国电信 IDC", "China Telecom IDC", "中国電信 IDC"],
    4837: ["中國聯通 (169 骨幹 / 省網)", "中国联通（169 骨干 / 省网）", "China Unicom (169 backbone / provincial)", "中国聯通（169 バックボーン / 省内網）"],
    9929: ["中國聯通 A網 (CUII)", "中国联通 A网（CUII）", "China Unicom CUII (9929)", "中国聯通 A網（CUII）"],
    10099: ["中國聯通國際 CUG", "中国联通国际 CUG", "China Unicom Global (CUG)", "中国聯通国際 CUG"],
    4808: ["中國聯通 北京", "中国联通 北京", "China Unicom Beijing", "中国聯通 北京"],
    17621: ["中國聯通 上海", "中国联通 上海", "China Unicom Shanghai", "中国聯通 上海"],
    17816: ["中國聯通 廣東", "中国联通 广东", "China Unicom Guangdong", "中国聯通 広東"],
    9808: ["中國移動 CMNET", "中国移动 CMNET", "China Mobile CMNET", "中国移動 CMNET"],
    58453: ["中國移動國際 CMI", "中国移动国际 CMI", "China Mobile International (CMI)", "中国移動国際 CMI"],
    58807: ["中國移動 CMIN2", "中国移动 CMIN2", "China Mobile CMIN2", "中国移動 CMIN2"],
    56040: ["中國移動 廣東", "中国移动 广东", "China Mobile Guangdong", "中国移動 広東"],
    56046: ["中國移動 江蘇", "中国移动 江苏", "China Mobile Jiangsu", "中国移動 江蘇"],
    24400: ["中國移動 上海", "中国移动 上海", "China Mobile Shanghai", "中国移動 上海"],
    4538: ["中國教育網 CERNET", "中国教育网 CERNET", "CERNET", "中国教育網 CERNET"]
  };
  // 國際業者：各語系相同
  var INTL_AS = {
    3356: "Lumen (Level3)", 209: "Lumen (CenturyLink)", 3549: "Lumen (GBLX)", 701: "Verizon", 702: "Verizon", 7018: "AT&T", 1239: "Sprint",
    2828: "Verizon (XO)", 3320: "DTAG", 1273: "Vodafone", 5511: "Orange", 12956: "Telxius", 9002: "RETN", 7922: "Comcast", 20940: "Akamai",
    2516: "KDDI", 4713: "NTT OCN", 17676: "SoftBank", 4766: "KT", 9318: "SK Broadband", 3786: "LG U+", 1221: "Telstra", 7545: "TPG",
    9498: "Airtel", 4755: "TATA India", 10026: "Telstra (Pacnet)", 64050: "BGPNET", 199524: "Gcore", 45102: "Alibaba", 132203: "Tencent",
    55990: "Huawei Cloud", 1299: "Arelion (Telia)", 2914: "NTT", 174: "Cogent", 6939: "Hurricane Electric", 3257: "GTT", 6453: "TATA",
    6461: "Zayo", 6762: "Telecom Italia Sparkle", 3491: "PCCW Global", 4637: "Telstra", 2497: "IIJ", 4635: "HKIX", 9304: "HGC", 4760: "HKT",
    7473: "Singtel", 13335: "Cloudflare", 15169: "Google", 16509: "Amazon", 8075: "Microsoft", 20473: "Vultr (Choopa)", 14061: "DigitalOcean",
    24940: "Hetzner", 16276: "OVH", 21859: "Zenlayer", 906: "DMIT", 54574: "DMIT", 35916: "Multacom", 25820: "IT7"
  };
  function asName(lang, asn, fallback) {
    var c = CN_AS[asn];
    if (c) return c[Math.max(0, LANGS.indexOf(lang))] || c[2];
    return INTL_AS[asn] || fallback || "";
  }

  // ---------------- 結果呈現 ----------------
  // 網路名稱：省網代碼（prov:ct 等）依語系，其餘（4134(163)、CTGNet、CN2 GIA…）各語系相同
  function net(lang, token) {
    var s = String(token || "");
    if (s.indexOf("prov:") === 0) return t(lang, "prov." + s.slice(5));
    if (s.indexOf("mix:") === 0) return t(lang, "mix", { x: s.slice(4) });
    return s;
  }
  function chain(lang, arr) { return (arr || []).map(function (x) { return net(lang, x); }).join(" → "); }
  function access(lang, r) {
    if (!r) return "";
    if (r.connect === "direct") return t(lang, "access.direct");
    if (r.connect === "long_haul") return t(lang, "access.long");
    if (r.connect === "local_transit") return t(lang, "access.local");
    if (r.connect === "unknown") return t(lang, "access.unknown");
    if (r.connect === "overseas_transit") {
      // 第一行已經寫了「業者 → …」時，小字不再重複業者名稱
      if (r.handover && r.chain && r.chain[0] === r.handover) return t(lang, "access.overseasShort");
      return t(lang, "access.overseas", { x: r.handover });
    }
    return "";
  }
  function chip(lang, r) {
    if (!r) return "";
    if (r.chain) return r.chain.length ? chain(lang, r.chain) : (r.connect === "none" ? t(lang, "none.short") : "");
    return r.chip || "";
  }
  function label(lang, r) { var a = access(lang, r); return chip(lang, r) + (a ? " · " + a : ""); }
  function confText(lang, c) {
    if (c === "inferred" || c === "推測") return t(lang, "conf.inferred");
    if (c === "insufficient" || c === "不足") return t(lang, "conf.insufficient");
    return "";
  }
  function evidence(lang, r) {
    if (!r) return "";
    if (!r.ev) return r.evidence || ""; // 舊版結果
    return r.ev.map(function (e) {
      var p = {};
      for (var k in (e.p || {})) p[k] = e.p[k];
      if (e.k === "ev.ct.163") p.x = (e.p.seen || []).map(function (s) { return t(lang, "seen." + s); }).join(t(lang, "list.sep"));
      if (e.k === "ev.cross" || e.k === "ev.crossNear") { p.a = t(lang, "carrier." + e.p.a); p.b = t(lang, "carrier." + e.p.b); }
      return t(lang, e.k, p);
    }).join(t(lang, "ev.sep"));
  }
  function intl(lang, r) {
    if (!r) return "";
    if (!r.intl_note) return r.intl_text || "";
    var n = r.intl_note;
    if (n.kind === "unknown") return t(lang, "intl.unknown");
    if (!r.intl || !r.intl.length) return t(lang, n.kind === "inside" ? "intl.inside" : "intl.direct");
    var list = r.intl.map(function (x) { return (asName(lang, x.asn, x.name) || "AS" + x.asn) + " (AS" + x.asn + ")"; }).join(" → ");
    if (n.ms === null || n.ms === undefined) return list;
    return list + t(lang, n.long ? "intl.long" : n.overseas ? "intl.shortOverseas" : "intl.shortLocal", { ms: n.ms });
  }
  function segName(lang, s) {
    if (!s) return "";
    if (s.key === "LAN") return t(lang, "seg.lan");
    var n = asName(lang, s.asn, "");
    if (n) return n;
    if (s.owner) return s.owner;
    if (s.fam) return t(lang, "seg.local", { x: t(lang, "carrier." + s.fam) });
    if (!s.asn) return t(lang, "seg.unknown");
    return s.name || "";
  }
  // 每段的位置與延遲：這段內位置或延遲有明顯變化時寫成「起 → 迄」，例如 CMI「日本 东京 → 中国 广东 广州 · 2.2 → 58.7 ms」
  var LOOKUP_FAIL = /网络故障|網路故障|网络错误|網路錯誤/;
  function segGeo(s) {
    if (!s || !s.geo || LOOKUP_FAIL.test(s.geo)) return ""; // 舊結果裡 nexttrace 查詢失敗的字樣不當地名
    return s.geo_in && s.geo_in !== s.geo ? s.geo_in + " → " + s.geo : s.geo;
  }
  function segRtt(s) {
    if (!s || s.rtt_out === null || s.rtt_out === undefined) return "";
    if (s.hops > 1 && s.rtt_in !== null && s.rtt_in !== undefined && Math.abs(s.rtt_out - s.rtt_in) >= 5) return s.rtt_in + " → " + s.rtt_out + " ms";
    return s.rtt_out + " ms";
  }

  function error(lang, e) {
    if (!e) return "";
    if (typeof e === "string") return e; // 舊版結果
    return t(lang, "err." + e.k, e.p);
  }
  function ago(lang, iso) {
    if (!iso) return t(lang, "ago.never");
    var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return t(lang, "ago.s", { n: s });
    if (s < 3600) return t(lang, "ago.m", { n: Math.round(s / 60) });
    if (s < 86400) return t(lang, "ago.h", { n: Math.round(s / 3600) });
    return t(lang, "ago.d", { n: Math.round(s / 86400) });
  }

  // 括號附註：中文 / 日文用全形括號，英文用半形
  function paren(lang, x) { return x ? (lang === "en" ? " (" + x + ")" : "（" + x + "）") : ""; }

  return {
    LANGS: LANGS, paren: paren, resolve: resolve, t: t, province: province, targetLabel: targetLabel, PROVINCES: PROVINCES,
    asName: asName, INTL_AS: INTL_AS, CN_AS: CN_AS, net: net, chain: chain, access: access, chip: chip, label: label,
    segGeo: segGeo, segRtt: segRtt, confText: confText, evidence: evidence, intl: intl, segName: segName, error: error, ago: ago
  };
});
