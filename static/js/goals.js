/* goals.js — goals & roadmap on the encrypted vault.
 * Goal: { id, title, desc, horizon: month|year|long, deadline:{jy,jm,jd}|null,
 *         ms:[{id,text,done}], createdAt }
 * Progress is honest: % of milestones actually done. No motivation theater.
 */
(function (g) {
  "use strict";
  var ctx = null;
  var filter = "all";

  function init(c) { ctx = c; }
  function t(k) { return ctx.T.t(k); }
  function el(a, b, c) { return ctx.el(a, b, c); }
  function goals() {
    if (!ctx.S.vault.goals) ctx.S.vault.goals = [];
    return ctx.S.vault.goals;
  }
  function uid() { return "g_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function dl2date(d) {
    var gg = ctx.J.toGregorian(d.jy, d.jm, d.jd);
    return new Date(gg.gy, gg.gm - 1, gg.gd);
  }
  function daysLeft(d) {
    var n = new Date(); n.setHours(0, 0, 0, 0);
    return Math.round((dl2date(d) - n) / 86400000);
  }
  function dlLabel(d) {
    return window.CalSys.labelFull(d);
  }
  function linkedTasks(G) {
    return (ctx.S.vault.tasks || []).filter(function (x) { return x.goalId === G.id; });
  }
  function progress(G) {
    var msTotal = (G.ms || []).length;
    var msDone = (G.ms || []).filter(function (m) { return m.done; }).length;
    var lt = linkedTasks(G);
    var total = msTotal + lt.length;
    if (!total) return null;
    var done = msDone + lt.filter(function (x) { return x.done; }).length;
    return Math.round((done / total) * 100);
  }

  function render(host) {
    var tb = el("div", "toolbar");
    var add = el("button", "btn btn--primary btn--sm", t("g_new"));
    add.addEventListener("click", function () { openEditor(null); });
    tb.appendChild(add);

    var seg = el("div", "seg");
    [["all", "f_all"], ["month", "gh_month"], ["year", "gh_year"], ["long", "gh_long"]]
      .forEach(function (o) {
        var b = el("button", "seg__btn" + (filter === o[0] ? " active" : ""), t(o[1]));
        b.addEventListener("click", function () { filter = o[0]; ctx.rerender(); });
        seg.appendChild(b);
      });
    tb.appendChild(seg);
    host.appendChild(tb);

    var list = goals().filter(function (G) {
      return filter === "all" || G.horizon === filter;
    }).sort(function (a, b) {
      var ad = a.deadline ? dl2date(a.deadline).getTime() : Infinity;
      var bd = b.deadline ? dl2date(b.deadline).getTime() : Infinity;
      return ad - bd;
    });

    if (!list.length) {
      host.appendChild(window.FX.empty("goals", t("g_empty"), t("g_emptySub")));
      return;
    }

    var road = el("div", "g-road");
    list.forEach(function (G) { road.appendChild(card(G)); });
    host.appendChild(road);
  }

  function card(G) {
    var c = el("div", "panel g-card");

    var head = el("div", "g-card__head");
    head.appendChild(el("h3", "h-card__name", G.title));
    var badges = el("div", "task-meta");
    badges.appendChild(el("span", "badge", t("gh_" + G.horizon)));
    var lt = linkedTasks(G);
    if (lt.length) {
      var ltDone = lt.filter(function (x) { return x.done; }).length;
      badges.appendChild(el("span", "badge badge--goal",
        ctx.num(ltDone) + "/" + ctx.num(lt.length) + " " + t("g_tasks")));
    }
    if (G.deadline) {
      var d = daysLeft(G.deadline);
      if (d < 0) badges.appendChild(el("span", "badge badge--over", t("overdue") + " · " + dlLabel(G.deadline)));
      else if (d === 0) badges.appendChild(el("span", "badge badge--today", t("dueToday")));
      else badges.appendChild(el("span", "badge badge--exam", ctx.num(d) + " " + t("daysLeft") + " · " + dlLabel(G.deadline)));
    }
    head.appendChild(badges);
    c.appendChild(head);

    if (G.desc) c.appendChild(window.Links.decorate(el("p", "task-notes", G.desc)));

    var pct = progress(G);
    if (pct !== null) {
      var row = el("div", "g-prog");
      var track = el("div", "rp-cat__track");
      var fill = el("div", "rp-cat__fill");
      fill.style.setProperty("--p", pct / 100);
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el("span", "rp-cat__n", ctx.num(pct) + t("pct")));
      c.appendChild(row);
    }

    if (G.ms && G.ms.length) {
      var box = el("div", "task-subs");
      G.ms.forEach(function (m) {
        var line = el("label", "task-sub" + (m.done ? " task-sub--done" : ""));
        var chk = el("input");
        chk.type = "checkbox"; chk.className = "task-check task-check--sm";
        chk.checked = !!m.done;
        chk.addEventListener("change", async function () {
          m.done = chk.checked;
          ctx.rerender(); ctx.persistBg();
        });
        line.appendChild(chk);
        line.appendChild(el("span", null, m.text));
        box.appendChild(line);
      });
      c.appendChild(box);
    }

    var act = el("div", "note-card__actions");
    if (G.reached) {
      c.classList.add("g-card--reached");
      var badge = ctx.elIc("span", "badge badge--reached", "trophy", t("g_reachedBadge"));
      act.appendChild(badge);
      var undo = el("button", "btn btn--ghost btn--sm", t("g_reopen"));
      undo.addEventListener("click", async function () {
        G.reached = false; G.reachedAt = null;
        ctx.rerender(); ctx.persistBg();
      });
      act.appendChild(undo);
    } else {
      var reach = ctx.elIc("button", "btn btn--primary btn--sm", "trophy", t("g_reach"));
      reach.addEventListener("click", async function () {
        if (!(await g.UI.confirm({
          title: t("g_reach"),
          body: t("g_reachAsk"),
        }))) return;
        G.reached = true; G.reachedAt = new Date().toISOString();
        g.UI.toast(t("g_reachedToast"), { kind: "success" });
        ctx.rerender();
        ctx.persistBg();
      });
      act.appendChild(reach);
    }
    var ed = el("button", "btn btn--ghost btn--sm", t("edit"));
    ed.addEventListener("click", function () { openEditor(G.id); });
    var del = el("button", "btn btn--ghost btn--sm btn--danger", t("delete"));
    del.addEventListener("click", async function () {
      if (!(await g.UI.confirm({ body: t("g_confirmDelete"), danger: true }))) return;
      ctx.S.trashPut("goal", G);
      ctx.S.vault.goals = goals().filter(function (x) { return x.id !== G.id; });
      ctx.status("msg_trashed", "success"); ctx.rerender(); ctx.persistBg();
    });
    act.appendChild(ed); act.appendChild(del);
    c.appendChild(act);
    return c;
  }

  function openEditor(id) {
    var G = id ? goals().find(function (x) { return x.id === id; }) : null;
    var ov = el("div", "overlay");
    var card = el("div", "overlay__card");
    card.appendChild(el("h2", "panel__title", id ? t("g_edit") : t("g_new")));

    function fld(labelKey, input) {
      var f = el("div", "field");
      f.appendChild(el("label", null, t(labelKey)));
      f.appendChild(input);
      return f;
    }
    var title = el("input"); title.type = "text"; title.value = G ? G.title : "";
    card.appendChild(fld("g_title", title));

    var hz = el("select", "tsel");
    [["month", "gh_month"], ["year", "gh_year"], ["long", "gh_long"]].forEach(function (o) {
      var op = el("option", null, t(o[1])); op.value = o[0];
      if (G && G.horizon === o[0]) op.selected = true;
      hz.appendChild(op);
    });
    card.appendChild(fld("g_horizon", hz));

    // deadline: three selects, "—" = none
    var tj = (function () {
      var n = new Date();
      return ctx.J.toJalaali(n.getFullYear(), n.getMonth() + 1, n.getDate());
    })();
    var dwrap = el("div", "due-row");
    var ySel = el("select", "tsel"), mSel = el("select", "tsel"), dSel = el("select", "tsel");
    function opt(sl, val, label, seld) {
      var o = el("option", null, label); o.value = String(val);
      if (seld) o.selected = true; sl.appendChild(o);
    }
    var dl = G ? G.deadline : null;
    opt(ySel, "", t("noDue"), !dl);
    /* v6.6 — three years, not eleven.
     *
     * This offered a decade of years, so the dropdown ran to 1415 and a tester
     * asked why the app was proposing dates in 2036. A goal that far out is
     * not a goal you set from a dropdown. Any existing goal dated beyond the
     * window still shows its own year, so nothing already saved becomes
     * unreachable — the list narrows, it does not lose data. */
    var yFrom = tj.jy, yTo = tj.jy + 2;
    if (dl && dl.jy < yFrom) yFrom = dl.jy;
    if (dl && dl.jy > yTo) yTo = dl.jy;
    for (var y = yFrom; y <= yTo; y++) opt(ySel, y, ctx.num(y), dl && dl.jy === y);
    window.CalSys.monthNames().forEach(function (m, i) { opt(mSel, i + 1, m, dl && dl.jm === i + 1); });
    function fillDays() {
      dSel.textContent = "";
      var jy = parseInt(ySel.value, 10), jm = parseInt(mSel.value, 10);
      var len = ySel.value ? ctx.J.jalaaliMonthLength(jy, jm) : 31;
      for (var d = 1; d <= len; d++) opt(dSel, d, ctx.num(d), dl && dl.jd === d);
    }
    fillDays();
    ySel.addEventListener("change", fillDays);
    mSel.addEventListener("change", fillDays);
    dwrap.appendChild(ySel); dwrap.appendChild(mSel); dwrap.appendChild(dSel);
    card.appendChild(fld("g_deadline", dwrap));

    /* v3.8.2 — same progressive disclosure the task form got in v3.8.1, for
     * the same reason: a new goal needs a title and a horizon; milestones and
     * a description are elaboration. Both were textareas open at full height,
     * which made "add a goal" look like paperwork. They collapse now — and
     * open automatically when editing a goal that already has them, so
     * existing content is never hidden behind a click you have to discover. */
    var moreBody = el("div", "editor-more__body");

    var ms = el("textarea"); ms.rows = 4;
    ms.placeholder = t("g_msHint");
    ms.value = G ? (G.ms || []).map(function (m) { return m.text; }).join("\n") : "";
    moreBody.appendChild(fld("g_ms", ms));

    var desc = el("textarea"); desc.rows = 2; desc.value = G ? (G.desc || "") : "";
    window.Links.attachTextarea(desc);   // "[[" autocompletes to items (v1.13)
    moreBody.appendChild(fld("g_desc", desc));

    var moreWrap = el("div", "editor-more");
    var moreOpen = !!(G && ((G.ms || []).length || G.desc));
    var moreBtn = el("button", "btn btn--ghost btn--sm editor-more__btn");
    moreBtn.type = "button";
    var moreCaret = el("span", "editor-more__caret", "▾");
    function syncMore() {
      moreBtn.textContent = t("task_moreDetails");
      moreBtn.appendChild(moreCaret);
      moreCaret.textContent = moreOpen ? "▴" : "▾";
      moreBtn.setAttribute("aria-expanded", moreOpen ? "true" : "false");
      moreBody.style.display = moreOpen ? "" : "none";
    }
    moreBtn.addEventListener("click", function () { moreOpen = !moreOpen; syncMore(); });
    syncMore();
    moreWrap.appendChild(moreBtn);
    moreWrap.appendChild(moreBody);
    card.appendChild(moreWrap);

    var actions = el("div", "overlay__actions");
    var cancel = el("button", "btn btn--ghost btn--sm", t("cancel"));
    cancel.addEventListener("click", function () { ov.remove(); });
    var save = el("button", "btn btn--primary btn--sm", t("save"));
    save.addEventListener("click", async function () {
      var ti = title.value.trim();
      if (!ti) { title.focus(); return; }
      var oldMs = (G && G.ms) ? G.ms : [];
      var newMs = ms.value.split("\n").map(function (l) { return l.trim(); })
        .filter(Boolean).map(function (text) {
          var prev = oldMs.find(function (o) { return o.text === text; });
          return { id: uid(), text: text, done: prev ? !!prev.done : false };
        });
      var deadline = ySel.value ? {
        jy: parseInt(ySel.value, 10),
        jm: parseInt(mSel.value, 10),
        jd: parseInt(dSel.value, 10),
      } : null;
      var data = { title: ti, desc: desc.value.trim(), horizon: hz.value, deadline: deadline, ms: newMs };
      if (G) Object.assign(G, data);
      else goals().push(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, data));
      ov.remove();
      ctx.status("msg_saved", "success"); ctx.rerender(); ctx.persistBg();
    });
    actions.appendChild(cancel); actions.appendChild(save);
    card.appendChild(actions);
    ov.appendChild(card);
    document.body.appendChild(ov);
    title.focus();
  }

  g.GoalsView = { init: init, render: render, openById: function (id) { openEditor(id); } };
})(window);
