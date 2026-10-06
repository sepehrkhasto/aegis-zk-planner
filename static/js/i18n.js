/* i18n.js — bilingual layer, one language on the wire.
 *
 * The dictionaries live in i18n.fa.js / i18n.en.js and the page loads only the
 * active one. Switching language fetches the other on demand: a rare action
 * paying a small cost, instead of every session paying for a language it never
 * shows.
 *
 * If the dictionary somehow isn't there, t() returns the key. A missing string
 * is a visible blemish; a thrown error is a blank app.
 */
(function (g) {
  "use strict";

  var current = "fa";

  function dict() {
    return (current === "en" ? g.__I18N_EN : g.__I18N_FA) || {};
  }

  function set(lang) {
    current = (lang === "en") ? "en" : "fa";
  }

  /* v6.3 — a Persian speaker must never be shown an English key.
   *
   * The dictionaries load as separate files. When one fails to arrive — a
   * dropped request, a stale cache, a flaky connection — t() used to return
   * the key itself, and the keys are English identifiers like `setupTitle`.
   * Real users hit exactly that and reported "English text on a Persian
   * site". Returning a raw key was a bad trade and this is the fix: the
   * handful of strings the boot screens need are inlined here, so the first
   * screens are always readable even with nothing else loaded.
   *
   * Only boot-critical strings live here. Everything else still comes from
   * the dictionary — this is a floor, not a second copy to keep in sync. */
  var CORE_FA = {
    appName: "Aegis Planner",
    loading: "در حال باز کردن…",
    unlockTitle: "قفل ولت",
    setupTitle: "ساخت رمز اصلی",
    masterPw: "رمز اصلی",
    repeatPw: "تکرار رمز",
    createVault: "بساز",
    unlockBtn: "باز کن",
    boot_failTitle: "باز نشد",
    boot_failBody: "ارتباط با سرور برقرار نشد. اینترنتت را چک کن و دوباره بزن.",
    boot_retry: "دوباره تلاش کن",
    boot_signOut: "خروج",
    msg_serverErr: "ارتباط با سرور برقرار نشد.",
  };

  function t(key) {
    var d = dict();
    if (d && d[key] !== undefined) return d[key];
    // dictionary missing or incomplete
    if (current !== "en" && CORE_FA[key] !== undefined) return CORE_FA[key];
    return key;
  }

  /* Fetch the other language's dictionary. Resolves immediately when it is
     already present, so callers can await unconditionally. */
  function load(lang, cb) {
    lang = (lang === "en") ? "en" : "fa";
    if (lang === "en" ? g.__I18N_EN : g.__I18N_FA) { if (cb) cb(); return; }
    var s = document.createElement("script");
    s.src = (g.__I18N_BASE || "/static/js/") + "i18n." + lang + ".js";
    s.onload = function () { if (cb) cb(); };
    s.onerror = function () { if (cb) cb(); };   // fall back to keys, never hang
    document.head.appendChild(s);
  }

  g.I18N = { set: set, t: t, load: load, get lang() { return current; } };
})(window);
