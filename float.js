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
    host.dataset.base = host.style.cssText;
    document.body.appendChild(host);
    // Shadow DOM：避免和主題的樣式互相影響
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    root.innerHTML =
      "<style>" +
      ":host{all:initial}" +
      ".btn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;width:56px;height:56px;padding:0;" +
      "border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--fg);" +
      "font:500 10px/1 system-ui,-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif;" +
      "cursor:grab;box-shadow:0 4px 14px rgba(0,0,0,.18);touch-action:none;user-select:none;-webkit-user-select:none}" +
      ".btn:hover{border-color:var(--muted)}" +
      ".btn.drag{cursor:grabbing;box-shadow:0 8px 24px rgba(0,0,0,.28)}" +
      ".btn svg{width:22px;height:22px}" +
      ".mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:16px}" +
      ".mask.on{display:flex}" +
      ".box{position:relative;width:min(960px,100%);height:min(86vh,900px);background:var(--bg);border-radius:12px;overflow:hidden;" +
      "box-shadow:0 10px 40px rgba(0,0,0,.35);display:flex;flex-direction:column}" +
      ".bar{display:flex;align-items:center;justify-content:space-between;padding:8px 8px 8px 14px;border-bottom:1px solid var(--line);" +
      "color:var(--fg);font:600 14px system-ui,-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif}" +
      ".bar span:last-child{display:flex;align-items:center}" +
      ".bar a{color:var(--muted);font-weight:400;font-size:12px;text-decoration:none;margin-right:8px}" +
      ".x{border:0;background:transparent;color:var(--fg);font-size:22px;line-height:1;width:32px;height:32px;border-radius:6px;cursor:pointer}" +
      ".x:hover{background:var(--line)}" +
      "iframe{flex:1;border:0;width:100%;background:var(--bg)}" +
      "</style>" +
      '<button class="btn" type="button" aria-label="回程路由">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7"/></svg>' +
      "<span>回程路由</span></button>" +
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
      var w = host.offsetWidth || 56, h = host.offsetHeight || 56;
      return { x: Math.max(4, Math.min(window.innerWidth - w - 4, p.x)), y: Math.max(4, Math.min(window.innerHeight - h - 4, p.y)) };
    }
    function applyStyle() {
      var css = host.dataset.base;
      if (pos) { var c = clamp(pos); css = "position:fixed;z-index:2147483000;left:" + c.x + "px;top:" + c.y + "px;"; }
      host.style.cssText = css + (host.dataset.vars || "");
    }
    window.addEventListener("resize", applyStyle);

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
