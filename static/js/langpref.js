/* langpref.js — THE single source of truth for the language preference.
 *
 * History: the landing/about pages once kept their own key (sp_land_lang),
 * so a visitor could pick English on the landing page and still get Persian
 * on the login form — five i18n surfaces, two keys, guaranteed drift. Every
 * surface now reads and writes through this module, and the old key is
 * migrated once, so this class of bug is structurally gone.
 *
 * Load this before any *_i18n/landing/about script. No dependencies.
 */
(function (g) {
  "use strict";

  var KEY = "sp_lang";
  var LEGACY = "sp_land_lang";

  function get() {
    try {
      var v = localStorage.getItem(KEY);
      if (v === "en" || v === "fa") return v;
      // one-time migration from the landing page's old private key
      var old = localStorage.getItem(LEGACY);
      if (old === "en" || old === "fa") {
        localStorage.setItem(KEY, old);
        localStorage.removeItem(LEGACY);
        return old;
      }
    } catch (e) {}
    return "fa";
  }

  function set(lang) {
    var v = lang === "en" ? "en" : "fa";
    try {
      localStorage.setItem(KEY, v);
      localStorage.removeItem(LEGACY);
    } catch (e) {}
    return v;
  }

  g.LangPref = { KEY: KEY, get: get, set: set };
})(window);
