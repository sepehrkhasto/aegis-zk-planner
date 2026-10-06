/* prefs.js — applies saved UI preferences to <html> before paint.
 * These are non-sensitive display prefs, so localStorage is fine (and lets
 * them apply before the vault is unlocked). Nothing here touches the vault.
 */
(function () {
  "use strict";
  try {
    var root = document.documentElement;
    var theme = localStorage.getItem("sp_theme") || "dark";
    var lang = localStorage.getItem("sp_lang") || "fa";
    var font = localStorage.getItem("sp_font") || "vazir";
    var scale = localStorage.getItem("sp_fontscale") || "1";
    var density = localStorage.getItem("sp_density") || "normal";

    root.setAttribute("data-theme", theme);
    root.setAttribute("data-font", font);
    root.setAttribute("data-density", density);
    root.style.setProperty("--font-scale", scale);
    /* v4.0.1 — the calendar's fullscreen and sidebar-collapse states are
     * applied HERE, in the boot script, for the same reason the theme is:
     * doing it later would render the chrome first and then yank it away,
     * which is a visible flash on every load. */
    if (localStorage.getItem("sp_calfs") === "1") root.classList.add("cal-fs");
    if (localStorage.getItem("sp_sidebar") === "0") root.classList.add("sb-collapsed");
    root.setAttribute("lang", lang === "en" ? "en" : "fa");
    /* v5.4 — mirror the language into a cookie.
     *
     * The dictionary is now one file per language, and only the active one is
     * sent. The choice lives in localStorage, which the server cannot read, so
     * it is mirrored here into a cookie the template can branch on. That keeps
     * the decision on the server: no client-side script injection, no blocking
     * document.write, and no flash of the wrong language.
     *
     * The cookie carries a display preference and nothing else — no identifier,
     * nothing about the vault. SameSite=Lax so it is not sent cross-site. */
    try {
      var want = (lang === "en" ? "en" : "fa");
      if (document.cookie.indexOf("ui_lang=" + want) === -1) {
        document.cookie = "ui_lang=" + want +
          ";path=/;max-age=31536000;samesite=Lax" +
          (location.protocol === "https:" ? ";secure" : "");
      }
    } catch (e) {}
    root.setAttribute("dir", lang === "en" ? "ltr" : "rtl");

    // Personal multi-colour theme (v1.15, فاز E مورد ۳۰): the user picks six
    // primitives (bg, panel, text, accent, danger, ok); every secondary token
    // (panel-2, line, muted, accent shades) is derived here so the whole UI
    // stays readable whatever they choose. Same CSSOM-over-theme technique as
    // the custom accent below — the 62 built-in themes stay untouched.
    function mixHex(a, b, t) {
      function ch(h, i) { return parseInt(h.slice(i, i + 2), 16); }
      var out = "#";
      for (var i = 1; i < 7; i += 2) {
        out += Math.round(ch(a, i) * (1 - t) + ch(b, i) * t).toString(16).padStart(2, "0");
      }
      return out;
    }
    function applyCustomTheme(c) {
      var HEX = /^#[0-9a-fA-F]{6}$/;
      if (!c || !HEX.test(c.ink) || !HEX.test(c.panel) || !HEX.test(c.text) ||
          !HEX.test(c.accent) || !HEX.test(c.danger) || !HEX.test(c.ok)) return;
      root.style.setProperty("--ink", c.ink);
      root.style.setProperty("--panel", c.panel);
      root.style.setProperty("--panel-2", mixHex(c.panel, c.text, 0.07));
      root.style.setProperty("--line", mixHex(c.panel, c.text, 0.17));
      root.style.setProperty("--text", c.text);
      root.style.setProperty("--muted", mixHex(c.text, c.panel, 0.45));
      root.style.setProperty("--danger", c.danger);
      root.style.setProperty("--ok", c.ok);
      var r2 = parseInt(c.accent.slice(1, 3), 16),
          g2 = parseInt(c.accent.slice(3, 5), 16),
          b3 = parseInt(c.accent.slice(5, 7), 16);
      root.style.setProperty("--accent", c.accent);
      root.style.setProperty("--accent-2", "#" + [r2, g2, b3].map(function (v) {
        return Math.max(0, Math.round(v * 0.82)).toString(16).padStart(2, "0");
      }).join(""));
      root.style.setProperty("--accent-ink",
        (r2 * 299 + g2 * 587 + b3 * 114) / 1000 >= 150 ? "#111318" : "#ffffff");
    }
    window.PrefsCustomTheme = applyCustomTheme;
    if (theme === "custom") {
      var cu = null;
      try { cu = JSON.parse(localStorage.getItem("sp_theme_custom") || "null"); } catch (e2) {}
      if (cu) applyCustomTheme(cu);
    }

    /* v6.4 — a saved custom accent is no longer painted.
     *
     * This runs before first paint, so leaving it in would flash a user's old
     * colour over the brand on every load. The signature is fixed now: the
     * stored value is dropped here as well as in the app, so nothing is left
     * to reappear on the next boot. */
    try { localStorage.removeItem("sp_accent"); } catch (e) {}
  } catch (e) {
    /* ignore — defaults in CSS handle it */
  }
})();
