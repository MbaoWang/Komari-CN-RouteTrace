// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 MbaoWang
// komari-cnroute 浮動按鈕：注入到 Komari 前台頁面，點擊後以彈出視窗顯示回程路由結果（唯讀）
(function () {
  try {
    if (window.top !== window) return; // 不在 iframe 內顯示（例如後台嵌入的插件頁）
    var p = location.pathname;
    if (/^\/(admin|terminal|api)(\/|$)/.test(p)) return; // 只在前台顯示
    if (window.__cnrouteFloat) return;
    window.__cnrouteFloat = true;
  } catch (e) { return; }

  var PAGE = "/api/plugin/cnroute/page/index.html?embed=1";

  // 圖示：22px 單色線條（與 Komari-Plugin-UnlockTest 的浮動按鈕風格一致：白底黑圖示，深色主題自動反轉）
  // 圖案：起點 → 迂迴路徑 → 目的地定位點（自繪）
  var ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="5.5" cy="18.5" r="2.5"/>' +
    '<path d="M8 18.5h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H11"/>' +
    '<path d="M18 2.5a3 3 0 0 0-3 3c0 2.25 3 5 3 5s3-2.75 3-5a3 3 0 0 0-3-3z"/>' +
    '<circle cx="18" cy="5.5" r="0.6" fill="currentColor"/>' +
    "</svg>";

  function start() {
    fetch("/api/cnroute/button", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : { show: false }; })
      .then(function (cfg) { if (cfg && cfg.show) mount(cfg); })
      .catch(function () {});
  }

  function isDark() {
    var d = document.documentElement;
    if (d.classList.contains("dark") || d.getAttribute("data-theme") === "dark") return true;
    if (d.classList.contains("light") || d.getAttribute("data-theme") === "light") return false;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function mount(cfg) {
    var host = document.createElement("div");
    host.id = "cnroute-float";
    host.style.cssText = "position:fixed;z-index:2147483000;bottom:24px;" + (cfg.position === "left" ? "left:24px;" : "right:24px;");
    document.body.appendChild(host);
    // Shadow DOM：避免和主題的樣式互相影響
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    root.innerHTML =
      "<style>" +
      ":host{all:initial}" +
      ".btn{display:flex;align-items:center;justify-content:center;width:48px;height:48px;padding:0;margin:0;" +
      "border-radius:var(--btn-radius,12px);border:1px solid var(--btn-line);background:var(--btn-bg);color:var(--btn-fg);" +
      "cursor:grab;box-shadow:var(--btn-shadow,4px 6px 18px rgba(0,0,0,.18),1px 2px 4px rgba(0,0,0,.12));" +
      "touch-action:none;user-select:none;-webkit-user-select:none;transition:border-color .25s,box-shadow .25s,transform .15s}" +
      ".btn:hover{transform:translate(-1px,-1px) scale(1.04);box-shadow:6px 10px 24px rgba(0,0,0,.24),2px 3px 6px rgba(0,0,0,.14)}" +
      ".btn:focus-visible{outline:2px solid var(--btn-fg);outline-offset:2px}" +
      ".btn.drag{cursor:grabbing;transform:none}" +
      ".btn svg{display:block}" +
      ".mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:16px}" +
      ".mask.on{display:flex}" +
      ".box{position:relative;width:min(960px,100%);height:min(86vh,900px);background:var(--bg);border-radius:12px;overflow:hidden;" +
      "box-shadow:0 10px 40px rgba(0,0,0,.35);display:flex;flex-direction:column}" +
      ".bar{display:flex;align-items:center;justify-content:space-between;padding:8px 8px 8px 14px;border-bottom:1px solid var(--line);" +
      "color:var(--fg);font:600 14px -apple-system,BlinkMacSystemFont,'SF Pro Text','Inter Variable','Inter',system-ui,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif}" +
      ".bar span:last-child{display:flex;align-items:center}" +
      ".bar a{color:var(--muted);font-weight:400;font-size:12px;text-decoration:none;margin-right:8px}" +
      ".x{border:0;background:transparent;color:var(--fg);font-size:22px;line-height:1;width:32px;height:32px;border-radius:6px;cursor:pointer}" +
      ".x:hover{background:var(--line)}" +
      "iframe{flex:1;border:0;width:100%;background:var(--bg)}" +
      "</style>" +
      '<button class="btn" type="button" aria-label="回程路由" title="回程路由">' + ICON + "</button>" +
      '<div class="mask" role="dialog" aria-label="回程路由"><div class="box">' +
      '<div class="bar"><span>回程路由</span><span><a href="' + PAGE.replace("?embed=1", "") + '" target="_blank" rel="noopener">新分頁開啟 ↗</a>' +
      '<button class="x" type="button" aria-label="關閉">×</button></span></div>' +
      "<iframe title=\"回程路由\"></iframe></div></div>";

    var btn = root.querySelector(".btn");
    var mask = root.querySelector(".mask");
    var frame = root.querySelector("iframe");

    function theme() {
      var dark = isDark();
      var vars = dark
        ? "--bg:#171a21;--fg:#e5e7eb;--muted:#9ca3af;--line:#2a2f3a;--btn-bg:#1e293b;--btn-fg:#f8fafc;--btn-line:rgba(255,255,255,.12)"
        : "--bg:#ffffff;--fg:#1d2129;--muted:#6b7280;--line:#e5e7eb;--btn-bg:#ffffff;--btn-fg:#111827;--btn-line:rgba(15,23,42,.10)";
      host.dataset.vars = vars;
      syncLook();
    }
    // 外觀與 Komari-Plugin-UnlockTest 的浮動按鈕一致：
    //   頁面上有它的按鈕 → 直接沿用它實際的圓角、底色、邊框、陰影、圖示顏色；
    //   沒有 → 與它相同的規則：讀主題伺服器卡片的圓角（夾在 6～20px，預設 12px）
    function syncLook() {
      var look = "";
      try {
        var ut = document.querySelector("#km-ul-min-icon, .km-ul-trigger-btn, [data-km-fab='true']");
        if (ut && !host.contains(ut)) {
          var cs = window.getComputedStyle(ut);
          if (cs.borderTopLeftRadius) look += "--btn-radius:" + cs.borderTopLeftRadius + ";";
          if (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)") look += "--btn-bg:" + cs.backgroundColor + ";";
          if (cs.borderTopColor) look += "--btn-line:" + cs.borderTopColor + ";";
          if (cs.boxShadow && cs.boxShadow !== "none") look += "--btn-shadow:" + cs.boxShadow + ";";
          if (cs.color) look += "--btn-fg:" + cs.color + ";";
        } else {
          var card = document.querySelector(".node-card, .km-node-card, .km-instance-server-item, [data-node-uuid], [data-uuid], article");
          var r = card ? parseFloat(window.getComputedStyle(card).borderTopLeftRadius) : NaN;
          look += "--btn-radius:" + Math.max(6, Math.min(20, r || 12)) + "px;";
        }
      } catch (e) {}
      host.dataset.look = look;
      applyStyle();
    }
    // 位置：預設在右下 / 左下；拖曳後改用 left/top，記在這個瀏覽器（localStorage）
    var POS_KEY = "cnroute-float-pos";
    var pos = null;
    try { pos = JSON.parse(localStorage.getItem(POS_KEY) || "null"); } catch (e) { pos = null; }
    function clamp(p) {
      var w = host.offsetWidth || 48, h = host.offsetHeight || 48;
      return { x: Math.max(4, Math.min(window.innerWidth - w - 4, p.x)), y: Math.max(4, Math.min(window.innerHeight - h - 4, p.y)) };
    }
    // 同一個角落已有其他浮動按鈕（例如其他插件的按鈕）時，排在它們上方
    // 與 Komari-Plugin-UnlockTest 的浮動按鈕慣例對齊：距邊 24px、每格 60px（48px 按鈕 + 12px 間距）
    var side = cfg.position === "left" ? "left" : "right";
    var EDGE = 24;
    var stackBottom = EDGE;
    function findStack() {
      var vw = window.innerWidth, vh = window.innerHeight, bottom = EDGE;
      var list = [];
      // 已知的浮動按鈕（UnlockTest 等插件的 data-km-fab 慣例）
      try {
        var known = document.querySelectorAll("[data-km-fab='true'], .km-ul-trigger-btn, #km-ul-min-icon, .nf-trigger-sq");
        for (var q = 0; q < known.length; q++) list.push(known[q]);
      } catch (e) {}
      for (var i = 0; i < document.body.children.length; i++) {
        var el = document.body.children[i];
        list.push(el);
        for (var j = 0; j < el.children.length && j < 50; j++) list.push(el.children[j]);
      }
      for (var k = 0; k < list.length; k++) {
        var e = list[k];
        if (e === host || host.contains(e)) continue;
        var cs = window.getComputedStyle(e);
        if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
        var r = e.getBoundingClientRect();
        if (r.width < 16 || r.height < 16 || r.width > 240 || r.height > 240) continue;
        var nearSide = side === "right" ? r.right > vw - 140 : r.left < 140;
        if (!nearSide || r.bottom < vh - 260) continue;
        bottom = Math.max(bottom, Math.round(vh - r.top + 12));
      }
      return bottom;
    }
    function restack() {
      syncLook();
      if (pos) return; // 使用者拖曳過就以拖曳位置為準
      var b = findStack();
      if (b !== stackBottom) { stackBottom = b; applyStyle(); }
    }
    function applyStyle() {
      var css = "position:fixed;z-index:2147483000;bottom:" + stackBottom + "px;" + side + ":" + EDGE + "px;";
      if (pos) { var c = clamp(pos); css = "position:fixed;z-index:2147483000;left:" + c.x + "px;top:" + c.y + "px;"; }
      host.style.cssText = css + (host.dataset.vars || "") + ";" + (host.dataset.look || "");
    }
    window.addEventListener("resize", function () { applyStyle(); restack(); });
    // 其他插件的按鈕可能比較晚出現：載入後重新偵測幾次，並監看 body 新增的元素
    [300, 1500, 4000].forEach(function (t) { setTimeout(restack, t); });
    try {
      var timer = null;
      new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(restack, 200); })
        .observe(document.body, { childList: true });
    } catch (e) {}

    var drag = null, moved = false;
    btn.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      var r = host.getBoundingClientRect();
      drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top };
      moved = false;
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
    });
    btn.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return; // 小於 6px 視為點擊
      moved = true;
      btn.classList.add("drag");
      pos = { x: drag.ox + dx, y: drag.oy + dy };
      applyStyle();
    });
    function endDrag() {
      if (!drag) return;
      drag = null;
      btn.classList.remove("drag");
      if (moved && pos) {
        pos = clamp(pos);
        try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) {}
      }
    }
    btn.addEventListener("pointerup", endDrag);
    btn.addEventListener("pointercancel", endDrag);
    theme();
    try { new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] }); } catch (e) {}

    function open() {
      if (!frame.src) frame.src = PAGE;
      mask.classList.add("on");
    }
    function close() { mask.classList.remove("on"); }
    btn.addEventListener("click", function () {
      if (moved) { moved = false; return; } // 拖曳結束不要開視窗
      open();
    });
    root.querySelector(".x").addEventListener("click", close);
    mask.addEventListener("click", function (e) { if (e.target === mask) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
