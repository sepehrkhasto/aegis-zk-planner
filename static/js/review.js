/* review.js — weekly review (GTD-style). Shows what actually happened this
 * week and captures 3 priorities for the next one. No motivation theater.
 */
(function (g) {
  "use strict";
  var ctx = null;

  function init(c) { ctx = c; }
  function t(k) { return ctx.T.t(k); }
  function el(a, b, c) { return ctx.el(a, b, c); }
  function iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }
  function weekSat() {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); // back to Saturday
    return d;
  }
  function weekKey() { return iso(weekSat()); }
  function inThisWeek(dISO) {
    var sat = weekSat();
    var end = new Date(sat); end.setDate(end.getDate() + 7);
    var d = new Date(dISO);
    return d >= sat && d < end;
  }

  function stat(label, value) {
    var c = el("div", "stat-card");
    c.appendChild(el("div", "stat-card__label", label));
    c.appendChild(el("div", "stat-card__value", value));
    return c;
  }

  function render(host) {
    var v = ctx.S.vault;
    var sat = weekSat();

    // tasks done this week
    var doneN = 0, doneHigh = 0;
    (v.tasks || []).forEach(function (x) {
      if (x.done && x.doneAt && inThisWeek(x.doneAt)) {
        doneN++;
        if (x.pr === "high") doneHigh++;
      }
    });

    // habits: total logged days within this week across habits
    var habitDays = 0, habitPossible = (v.habits || []).length * 7;
    (v.habits || []).forEach(function (h) {
      for (var i = 0; i < 7; i++) {
        var d = new Date(sat); d.setDate(sat.getDate() + i);
        if (d > new Date()) break;
        if (h.log && h.log[iso(d)]) habitDays++;
      }
    });

    // journal entries + words this week
    var jN = 0, jWords = 0;
    /* v3.5: a "journal entry" is a note carrying a jdate */
    (v.notes || []).forEach(function (e) {
      if (e.jdate && inThisWeek(e.jdate + "T12:00:00")) {
        jN++;
        jWords += (e.body || "").trim().split(/\s+/).filter(Boolean).length;
      }
    });

    // pomodoro sessions this week
    var pomo = 0;
    var pl = (v.settings && v.settings.pomoLog) || {};
    for (var i = 0; i < 7; i++) {
      var d = new Date(sat); d.setDate(sat.getDate() + i);
      pomo += pl[iso(d)] || 0;
    }

    // wellness averages this week
    var wl = v.wellness || { water: {}, sleep: {} };
    var wSum = 0, wDays = 0, sSum = 0, sDays = 0;
    for (var k = 0; k < 7; k++) {
      var dd = new Date(sat); dd.setDate(sat.getDate() + k);
      var key = iso(dd);
      if (wl.water && wl.water[key] != null) { wSum += wl.water[key]; wDays++; }
      if (wl.sleep && wl.sleep[key] != null) { sSum += wl.sleep[key]; sDays++; }
    }

    var grid = el("div", "stat-grid");
    grid.appendChild(stat(t("rv_doneTasks"), ctx.num(doneN) +
      (doneHigh ? " (" + ctx.num(doneHigh) + " " + t("pr_high") + ")" : "")));
    if (habitPossible) grid.appendChild(stat(t("rv_habits"),
      ctx.num(habitDays) + "/" + ctx.num(habitPossible)));
    grid.appendChild(stat(t("rv_journal"),
      ctx.num(jN) + (jWords ? " · " + ctx.num(jWords) + " " + t("j_words") : "")));
    grid.appendChild(stat(t("rv_pomo"), ctx.num(pomo)));
    if (wDays) grid.appendChild(stat(t("rv_water"),
      ctx.num(Math.round((wSum / wDays) * 10) / 10) + "/" + ctx.num(8)));
    if (sDays) grid.appendChild(stat(t("rv_sleep"),
      ctx.num(Math.round((sSum / sDays) * 10) / 10) + " " + t("wl_hours")));
    host.appendChild(grid);

    if (!doneN && !habitDays && !jN && !pomo) {
      host.appendChild(el("p", "panel__text", t("rv_none")));
    }

    // next week's 3 priorities
    if (!v.settings) v.settings = {};
    if (!v.settings.weekly) v.settings.weekly = {};
    var wk = weekKey();
    var saved = v.settings.weekly[wk] || ["", "", ""];

    var p = el("div", "panel");
    p.appendChild(ctx.elIc("h2", "panel__title", "review", t("rv_prTitle")));
    var inputs = [];
    for (var n = 0; n < 3; n++) {
      var f = el("div", "field");
      var inp = el("input", "tsearch");
      inp.type = "text";
      inp.placeholder = t("rv_prio") + " " + ctx.num(n + 1);
      inp.value = saved[n] || "";
      inputs.push(inp);
      f.appendChild(inp);
      p.appendChild(f);
    }
    var save = el("button", "btn btn--primary btn--sm", t("save"));
    save.addEventListener("click", async function () {
      v.settings.weekly[wk] = inputs.map(function (i2) { return i2.value.trim(); });
      ctx.status("msg_saved", "success"); ctx.persistBg();
    });
    p.appendChild(save);
    host.appendChild(p);
  }

  g.ReviewView = {
    init: init, render: render,
    currentPriorities: function () {
      var v = ctx && ctx.S.vault;
      if (!v || !v.settings || !v.settings.weekly) return null;
      var pr = (v.settings.weekly[weekKey()] || []).filter(Boolean);
      return pr.length ? pr : null;
    },
  };
})(window);
