/* tags.js — one place to see everything carrying a tag. */
(function (g) {
  "use strict";
  var ctx = null;
  var selected = null;

  function init(c) { ctx = c; }
  function t(k) { return ctx.T.t(k); }
  function el(a, b, c) { return ctx.el(a, b, c); }

  function collect() {
    var map = {};
    function add(tag, kind, item) {
      if (!map[tag]) map[tag] = [];
      map[tag].push({ kind: kind, item: item });
    }
    (ctx.S.vault.tasks || []).forEach(function (x) {
      (x.tags || []).forEach(function (tg) { add(tg, "task", x); });
    });
    (ctx.S.vault.archive || []).forEach(function (x) {
      (x.tags || []).forEach(function (tg) { add(tg, "task", x); });
    });
    return map;
  }

  function render(host) {
    var map = collect();
    var tags = Object.keys(map).sort(function (a, b) {
      return map[b].length - map[a].length;
    });

    if (!tags.length) {
      host.appendChild(window.FX.empty("tags", t("tg_empty"), t("tg_emptySub")));
      return;
    }
    if (selected && !map[selected]) selected = null;

    var cloud = el("div", "panel tg-cloud");
    tags.forEach(function (tg) {
      var b = el("button", "tag-chip" + (selected === tg ? " active" : ""),
        "#" + tg + " · " + ctx.num(map[tg].length));
      b.addEventListener("click", function () {
        selected = selected === tg ? null : tg;
        ctx.rerender();
      });
      cloud.appendChild(b);
    });
    host.appendChild(cloud);

    if (!selected) {
      host.appendChild(el("p", "panel__text", t("tg_hint")));
      return;
    }

    var p = el("div", "panel");
    p.appendChild(el("h2", "panel__title", "#" + selected));
    map[selected].sort(function (a, b) {
      return (a.item.done ? 1 : 0) - (b.item.done ? 1 : 0);
    }).forEach(function (r) {
      var x = r.item;
      var row = el("div", "day-task" + (x.done ? " day-task--done" : ""));
      var c = el("input");
      c.type = "checkbox"; c.className = "task-check task-check--sm";
      c.checked = !!x.done;
      c.addEventListener("change", async function () {
        x.done = c.checked;
        x.doneAt = c.checked ? new Date().toISOString() : null;
        if (await ctx.persist()) ctx.rerender();
      });
      row.appendChild(c);
      var tt = el("span", "day-task__title", x.title);
      tt.addEventListener("click", function () { window.TasksView.openById(x.id); });
      row.appendChild(tt);
      row.appendChild(el("span", "badge", t("cat_" + x.cat)));
      if (x.pr === "high") row.appendChild(el("span", "badge badge--high", t("pr_high")));
      p.appendChild(row);
    });
    host.appendChild(p);
  }

  g.TagsView = { init: init, render: render };
})(window);
