/* search.js — global search across the whole vault, entirely client-side. */
(function (g) {
  "use strict";
  var ctx = null;
  var lastQ = "";

  function init(c) { ctx = c; }
  function t(k) { return ctx.T.t(k); }
  function el(a, b, c) { return ctx.el(a, b, c); }

  function hay(parts) {
    return parts.filter(Boolean).join(" ").toLowerCase();
  }

  function collect(q) {
    var v = ctx.S.vault, out = [];
    (v.tasks || []).forEach(function (x) {
      if (hay([x.title, x.notes, (x.tags || []).join(" ")]).indexOf(q) >= 0)
        out.push({ kind: "task", title: x.title, route: "#/tasks" });
    });
    (v.notes || []).forEach(function (x) {
      if (hay([x.title, x.body]).indexOf(q) >= 0)
        out.push({ kind: "note", title: x.title || x.body.slice(0, 40), route: "#/notes" });
    });
    (v.habits || []).forEach(function (x) {
      if (x.name.toLowerCase().indexOf(q) >= 0)
        out.push({ kind: "habit", title: x.name, route: "#/habits" });
    });
    return out;
  }

  function render(host) {
    var box = el("div", "panel");
    var inp = el("input", "tsearch gs-input");
    inp.type = "search";
    inp.placeholder = t("gs_placeholder");
    inp.value = lastQ;
    box.appendChild(inp);
    host.appendChild(box);

    var results = el("div", "gs-results");
    host.appendChild(results);

    function run() {
      lastQ = inp.value;
      var q = inp.value.trim().toLowerCase();
      results.textContent = "";
      if (q.length < 2) return;
      var found = collect(q);
      if (!found.length) {
        results.appendChild(el("p", "panel__text", t("gs_none")));
        return;
      }
      found.slice(0, 50).forEach(function (r) {
        var row = el("a", "tr-row gs-row");
        row.href = r.route;
        row.appendChild(el("span", "badge", t("tr_" + r.kind)));
        row.appendChild(el("span", "tr-row__title", r.title));
        results.appendChild(row);
      });
    }
    inp.addEventListener("input", run);
    run();
    inp.focus();
  }

  g.SearchView = { init: init, render: render };
})(window);
