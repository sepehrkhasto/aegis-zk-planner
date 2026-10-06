/* ui.js — in-app dialogs + undo toast, so we never fall back to the browser's
 * native confirm()/prompt() (which clash with the app's look). All functions
 * are promise-based and self-contained (no dependency on the app bundle).
 *
 *   await UI.confirm({ title, body, danger })  -> boolean
 *   await UI.prompt({ title, label, value, placeholder }) -> string | null
 *   UI.toast(message, { undo: fn, kind })      -> shows a toast, optional Undo
 */
(function (g) {
  "use strict";

  /* v3.8.2 — this used to be `var lang = …` evaluated ONCE when the file
   * loaded. The page ships as <html lang="fa">, and the language can change
   * afterwards (prefs.js on boot, or the in-app switch at any moment), so a
   * dialog opened after a switch still rendered its buttons in the language
   * the page happened to have at load time: an English app with «تایید» /
   * «انصراف» on every confirm and prompt. Reading it per call costs nothing
   * and is always right. */
  function lang() {
    return (document.documentElement.getAttribute("lang") === "en") ? "en" : "fa";
  }
  var TXT = {
    fa: { ok: "تایید", cancel: "انصراف", undo: "برگردان" },
    en: { ok: "OK", cancel: "Cancel", undo: "Undo" },
  };
  function t(k) { return (TXT[lang()] || TXT.fa)[k]; }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function dialog(opts) {
    return new Promise(function (resolve) {
      var prevFocus = document.activeElement;
      var ov = el("div", "overlay ui-dialog");
      var card = el("div", "overlay__card ui-dialog__card");
      // accessibility: proper dialog semantics
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      var titleId = "dlg-t-" + Math.random().toString(36).slice(2, 8);
      if (opts.title) {
        var h = el("h2", "panel__title", opts.title);
        h.id = titleId;
        card.appendChild(h);
        card.setAttribute("aria-labelledby", titleId);
      } else {
        card.setAttribute("aria-label", opts.body || "dialog");
      }
      if (opts.body) card.appendChild(el("p", "panel__text", opts.body));

      var input = null;
      if (opts.prompt) {
        input = el("input", "ui-dialog__input");
        input.type = opts.type || "text";
        if (opts.type === "password") { input.autocomplete = "off"; input.setAttribute("dir", "ltr"); }
        if (opts.value) input.value = opts.value;
        if (opts.placeholder) input.placeholder = opts.placeholder;
        if (opts.label) {
          var f = el("div", "field");
          var lb = el("label", null, opts.label);
          var inId = "dlg-i-" + Math.random().toString(36).slice(2, 8);
          lb.setAttribute("for", inId); input.id = inId;
          f.appendChild(lb);
          f.appendChild(input);
          card.appendChild(f);
        } else {
          card.appendChild(input);
        }
      }

      var actions = el("div", "overlay__actions");
      function done(val) {
        ov.remove();
        document.removeEventListener("keydown", onKey);
        if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} }
        resolve(val);
      }
      var cancel = el("button", "btn btn--ghost btn--sm", opts.cancelText || t("cancel"));
      cancel.addEventListener("click", function () { done(opts.prompt ? null : false); });
      var ok = el("button",
        "btn btn--sm " + (opts.danger ? "btn--danger" : "btn--primary"),
        opts.okText || t("ok"));
      ok.addEventListener("click", function () { done(opts.prompt ? input.value : true); });

      actions.appendChild(cancel);
      actions.appendChild(ok);
      card.appendChild(actions);
      ov.appendChild(card);

      // focus trap: keep Tab within the dialog
      function focusables() {
        return Array.prototype.slice.call(
          card.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])')
        ).filter(function (n) { return !n.disabled && n.offsetParent !== null; });
      }
      function onKey(e) {
        if (e.key === "Escape") { done(opts.prompt ? null : false); return; }
        if (e.key === "Enter" && (opts.prompt || document.activeElement === ok)) {
          done(opts.prompt ? input.value : true); return;
        }
        if (e.key === "Tab") {
          var f = focusables();
          if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener("keydown", onKey);
      ov.addEventListener("click", function (e) { if (e.target === ov) done(opts.prompt ? null : false); });

      document.body.appendChild(ov);
      if (input) input.focus();
      else ok.focus();
    });
  }

  function confirmDialog(opts) {
    if (typeof opts === "string") opts = { body: opts };
    return dialog(Object.assign({ prompt: false }, opts));
  }
  function promptDialog(opts) {
    if (typeof opts === "string") opts = { label: opts };
    return dialog(Object.assign({ prompt: true }, opts));
  }

  // ---- undo toast ---------------------------------------------------------
  var toastTimer = null;
  function toast(message, opts) {
    opts = opts || {};
    var host = document.getElementById("ui-toast");
    if (!host) {
      host = el("div", "ui-toast");
      host.id = "ui-toast";
      host.setAttribute("role", "status");
      host.setAttribute("aria-live", "polite");
      document.body.appendChild(host);
    }
    host.textContent = "";
    host.className = "ui-toast ui-toast--" + (opts.kind || "info") + " show";
    host.appendChild(el("span", "ui-toast__msg", message));
    if (typeof opts.undo === "function") {
      var b = el("button", "ui-toast__undo", t("undo"));
      b.addEventListener("click", function () {
        if (toastTimer) clearTimeout(toastTimer);
        host.classList.remove("show");
        opts.undo();
      });
      host.appendChild(b);
    }
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { host.classList.remove("show"); },
      opts.duration || 5000);
  }

  // ---- unified loading (v1.13.3, فاز C مورد ۱۶) --------------------------
  // ONE spinner and ONE skeleton for every waiting state in the app; the CSS
  // (.spinner / .sk*) already respects prefers-reduced-motion.
  function spinner(lg) { return el("span", "spinner" + (lg ? " spinner--lg" : "")); }
  function skeleton(host) {
    var w = el("div", "sk-wrap");
    w.appendChild(el("div", "sk sk-title"));
    var grid = el("div", "sk-grid");
    for (var i = 0; i < 3; i++) grid.appendChild(el("div", "sk sk-card"));
    w.appendChild(grid);
    for (var j = 0; j < 4; j++) w.appendChild(el("div", "sk sk-row"));
    host.appendChild(w);
    return w;
  }

  g.UI = { confirm: confirmDialog, prompt: promptDialog, toast: toast,
    spinner: spinner, skeleton: skeleton };

  /* TaskColor — one place that knows how a task color paints an element.
   * Presets stay CSS classes ("c0".."c7"); a custom color is any "#rrggbb",
   * applied as the same --tc custom property the preset classes set. Setting
   * --tc via CSSOM keeps the strict CSP happy (no style="" attributes), and
   * the existing [class*="task-c"] selectors match "task-cx" too, so every
   * surface (rows, chips, kanban cards, timeline blocks) just works. */
  g.TaskColor = {
    isCustom: function (c) { return typeof c === "string" && c.charAt(0) === "#"; },
    // class string for building elements: "task-c3" or "task-cx"
    cls: function (c) { return g.TaskColor.isCustom(c) ? "task-cx" : "task-" + (c || "c0"); },
    // paint an already-created element (adds class and, for hex, the --tc var)
    apply: function (elm, c) {
      elm.classList.add.apply(elm.classList, g.TaskColor.cls(c).split(" "));
      if (g.TaskColor.isCustom(c)) elm.style.setProperty("--tc", c);
      return elm;
    },
  };
})(window);
