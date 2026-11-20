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

  // 圖示：漸層圓角方塊 + 白色圖案（自繪，GPL-3.0；風格參考 Qure 彩色圖示集）
  var W = 'fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"';
  function tile(c1, c2, glyph) {
    return '<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="cnrg" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs>' +
      '<rect width="48" height="48" rx="12" fill="url(#cnrg)"/>' + glyph + "</svg>";
  }
  var ICONS = {
    route: tile("#3b82f6", "#06b6d4", '<circle cx="14" cy="34" r="3.2" fill="#fff"/><path ' + W + ' d="M17 32c8-2 4-12 12-14"/>' +
      '<path fill="#fff" d="M34 9a6 6 0 0 0-6 6c0 4.6 6 10 6 10s6-5.4 6-10a6 6 0 0 0-6-6z"/><circle cx="34" cy="15" r="2.2" fill="url(#cnrg)"/>'),
    globe: tile("#2563eb", "#7c3aed", '<circle ' + W + ' cx="24" cy="24" r="10"/><path ' + W + ' d="M14 24h20M24 14c-3.2 3-4.6 6.4-4.6 10s1.4 7 4.6 10M24 14c3.2 3 4.6 6.4 4.6 10s-1.4 7-4.6 10"/>' +
      '<path ' + W + ' d="M37.5 17.5A15 15 0 0 0 11 15"/><path ' + W + ' d="M11 10v5h5"/>'),
    hops: tile("#0ea5e9", "#10b981", '<path ' + W + ' d="M12 34l8-8 7 4 9-12"/><circle cx="12" cy="34" r="3" fill="#fff"/><circle cx="20" cy="26" r="3" fill="#fff"/>' +
      '<circle cx="27" cy="30" r="3" fill="#fff"/><circle cx="36" cy="18" r="3.6" fill="#fff"/><circle cx="36" cy="18" r="1.4" fill="#10b981"/>'),
    path: tile("#6366f1", "#06b6d4", '<path ' + W + ' d="M13 17h16a5 5 0 0 1 0 10H19a5 5 0 0 0 0 10h16"/><path ' + W + ' d="M31 33l4 4-4 4"/><circle cx="13" cy="17" r="3" fill="#fff"/>'),
  };

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
    host.style.cssText = "position:fixed;z-index:2147483000;bottom:20px;" + (cfg.position === "left" ? "left:20px;" : "right:20px;");
    document.body.appendChild(host);
    // Shadow DOM：避免和主題的樣式互相影響
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    root.innerHTML =
      "<style>" +
      ":host{all:initial}" +
      ".btn{display:block;width:48px;height:48px;padding:0;border:0;border-radius:12px;background:transparent;" +
      "cursor:grab;box-shadow:0 4px 14px rgba(0,0,0,.22);touch-action:none;user-select:none;-webkit-user-select:none;transition:transform .15s,box-shadow .15s}" +
      ".btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,0,0,.28)}" +
      ".btn:focus-visible{outline:2px solid #3b82f6;outline-offset:2px}" +
      ".btn.drag{cursor:grabbing;transform:none;box-shadow:0 10px 26px rgba(0,0,0,.32)}" +
      ".btn svg{display:block;width:48px;height:48px}" +
      ".mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:16px}" +
      ".mask.on{display:flex}" +
      ".box{position:relative;width:min(960px,100%);height:min(86vh,900px);background:var(--bg);border-radius:12px;overflow:hidden;" +
      "box-shadow:0 10px 40px rgba(0,0,0,.35);display:flex;flex-direction:column}" +
      ".bar{display:flex;align-items:center;justify-content:space-between;padding:8px 8px 8px 14px;border-bottom:1px solid var(--line);" +
      "color:var(--fg);font:600 14px -apple-system,BlinkMacSystemFont,'SF Pro Text','Inter Variable','Inter',system-ui,'PingFang TC','PingFang SC','Microsoft JhengHei','Microsoft YaHei',sans-serif}" +
      ".bar span:last-child{display:flex;align-items:center}" +
      ".bar a{color:var(--muted);font-weight:400;font-size:12px;text-decoration:none;margin-right:8px}" +
      ".x{border:0;background:transparent;color:var(--fg);font-size:22px;line-height:1;width:32px;height:32px;border-radius:6px;cursor:pointer}" +
      ".x:hover{background:var(--line)}" +
      "iframe{flex:1;border:0;width:100%;background:var(--bg)}" +
      "</style>" +
      '<button class="btn" type="button" aria-label="回程路由" title="回程路由">' + (ICONS[cfg.icon] || ICONS.route) + "</button>" +
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
        ? "--bg:#171a21;--fg:#e5e7eb;--muted:#9ca3af;--line:#2a2f3a"
        : "--bg:#ffffff;--fg:#1d2129;--muted:#6b7280;--line:#e5e7eb";
      host.dataset.vars = vars;
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
    var side = cfg.position === "left" ? "left" : "right";
    var stackBottom = 20;
    function findStack() {
      var vw = window.innerWidth, vh = window.innerHeight, bottom = 20;
      var list = [];
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
      if (pos) return; // 使用者拖曳過就以拖曳位置為準
      var b = findStack();
      if (b !== stackBottom) { stackBottom = b; applyStyle(); }
    }
    function applyStyle() {
      var css = "position:fixed;z-index:2147483000;bottom:" + stackBottom + "px;" + side + ":20px;";
      if (pos) { var c = clamp(pos); css = "position:fixed;z-index:2147483000;left:" + c.x + "px;top:" + c.y + "px;"; }
      host.style.cssText = css + (host.dataset.vars || "");
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
