/* cmdk.js — Command palette (Ctrl/Cmd+K). Fuzzy-search across pages, tasks,
 * notes, goals, journal and habits, then jump or act. Keyboard-first.
 */
(function (g) {
  "use strict";
  var ctx = null;
  var openEl = null;

  function init(c) { ctx = c; }
  function t(k) { return ctx.T.t(k); }
  function el(a, b, c) { return ctx.el(a, b, c); }

  // page id doubles as the SVG sprite icon id (#ic-<page>) — same icon set
  // as the sidebar, so the palette matches the app's current iconography
  var PAGES = [
    ["dashboard", "dashboard"], ["calendar", "calendar"], ["tasks", "tasks"], ["kanban", "kanban"],
    ["goals", "goals"], ["work", "work"], ["habits", "habits"],
    ["lists", "lists"], ["reports", "reports"], ["focus", "focus"],
    ["review", "review"], ["notes", "notes"], ["tags", "tags"], ["trash", "trash"],
    ["settings", "settings"], ["help", "help"],
  ];

  function norm(s) { return (s || "").toString().toLowerCase(); }
  function match(hay, q) {
    hay = norm(hay); q = norm(q);
    if (!q) return true;
    // simple subsequence fuzzy
    var i = 0;
    for (var c = 0; c < hay.length && i < q.length; c++) {
      if (hay[c] === q[i]) i++;
    }
    return i === q.length;
  }

  // v1.8.1 — the palette can now *do* things, not just navigate: create a task,
  // jump the calendar to today, flip theme/language/density, lock the vault.
  function actions() {
    var A = window.AppView || {};
    var list = [
      { icon: "plus", label: t("cmd_newTask"), kind: t("cmdk_action"),
        act: function () { window.TasksView.openNew(null); } },
      { icon: "calendar", label: t("cmd_today"), kind: t("cmdk_action"),
        act: function () { if (A.gotoToday) A.gotoToday(); } },
      { icon: "focus", label: t("cmd_zen"), kind: t("cmdk_action"), go: "#/focus" },
      { icon: "settings", label: t("cmd_lang"), kind: t("cmdk_action"),
        act: function () { if (A.toggleLang) A.toggleLang(); } },
      { icon: "settings", label: t("cmd_density"), kind: t("cmdk_action"),
        act: function () { if (A.cycleDensity) A.cycleDensity(); } },
      { icon: "settings", label: t("cmd_theme"), kind: t("cmdk_action"), go: "#/settings" },
      { icon: "passwords", label: t("cmd_lock"), kind: t("cmdk_action"),
        act: function () { if (A.lock) A.lock(); } },
    ];
    return list;
  }

  function results(q) {
    var out = [];
    var v = ctx.S.vault;
    actions().forEach(function (a) { if (match(a.label, q)) out.push(a); });
    PAGES.forEach(function (p) {
      var label = t("nav_" + p[0]);
      if (match(label + " " + p[0], q)) {
        out.push({ icon: p[1], label: label, kind: t("cmdk_page"), go: "#/" + p[0] });
      }
    });
    (v.tasks || []).forEach(function (x) {
      if (!x.archived && match(x.title, q)) {
        out.push({ icon: "tasks", label: x.title, kind: t("nav_tasks"), act: function () { window.TasksView.openById(x.id); } });
      }
    });
    (v.goals || []).forEach(function (x) {
      if (match(x.title, q)) out.push({ icon: "goals", label: x.title, kind: t("nav_goals"), go: "#/goals" });
    });
    (v.notes || []).forEach(function (x) {
      if (match((x.title || "") + " " + (x.body || ""), q)) {
        out.push({ icon: "notes", label: x.title || t("untitled"), kind: t("nav_notes"), go: "#/notes" });
      }
    });
    return out.slice(0, 40);
  }

  function open() {
    if (openEl) return;
    var ov = el("div", "cmdk-ov");
    var box = el("div", "cmdk");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", t("cmdk_ph"));
    var input = el("input", "cmdk__input");
    input.type = "text"; input.placeholder = t("cmdk_ph");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-autocomplete", "list");
    box.appendChild(input);
    var list = el("div", "cmdk__list");
    box.appendChild(list);
    var hint = el("div", "cmdk__hint");
    hint.appendChild(el("span", null, "↑↓ " + t("cmdk_nav")));
    hint.appendChild(el("span", null, "↵ " + t("cmdk_open")));
    hint.appendChild(el("span", null, "Esc " + t("cmdk_close")));
    box.appendChild(hint);
    ov.appendChild(box);
    document.body.appendChild(ov);
    openEl = ov;

    var sel = 0, items = [];
    function paint() {
      list.textContent = "";
      items = results(input.value);
      if (!items.length) {
        list.appendChild(el("div", "cmdk__empty", t("cmdk_none")));
        return;
      }
      if (sel >= items.length) sel = items.length - 1;
      if (sel < 0) sel = 0;
      items.forEach(function (r, i) {
        var row = el("div", "cmdk__item" + (i === sel ? " active" : ""));
        var icw = el("span", "cmdk__ic");
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "ic");
        var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#ic-" + r.icon);
        svg.appendChild(use);
        icw.appendChild(svg);
        row.appendChild(icw);
        row.appendChild(el("span", "cmdk__label", r.label));
        row.appendChild(el("span", "cmdk__kind", r.kind));
        row.addEventListener("click", function () { run(r); });
        row.addEventListener("mousemove", function () {
          if (sel !== i) { sel = i; highlight(); }
        });
        list.appendChild(row);
      });
    }
    function highlight() {
      list.querySelectorAll(".cmdk__item").forEach(function (n, i) {
        n.classList.toggle("active", i === sel);
      });
      var a = list.querySelector(".cmdk__item.active");
      if (a) a.scrollIntoView({ block: "nearest" });
    }
    function run(r) {
      close();
      if (r.act) r.act();
      else if (r.go) { location.hash = r.go; }
    }
    input.addEventListener("input", function () { sel = 0; paint(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); highlight(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); highlight(); }
      else if (e.key === "Enter") { e.preventDefault(); if (items[sel]) run(items[sel]); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    paint();
    input.focus();
  }

  function close() {
    if (openEl) { openEl.remove(); openEl = null; }
  }

  g.CmdK = { init: init, open: open, close: close, isOpen: function () { return !!openEl; } };
})(window);
