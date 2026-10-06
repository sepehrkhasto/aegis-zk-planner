/* habits.js — habit tracker with a GitHub-style heatmap.
 * Habit: { id, name, log: { "YYYY-MM-DD": 1 }, createdAt }
 */
(function (g) {
  "use strict";
  var ctx = null;
  var WEEKS = 20;

  function init(c) { ctx = c; }
  function t(k) { return ctx.T.t(k); }
  function el(a, b, c) { return ctx.el(a, b, c); }
  function habits() {
    if (!ctx.S.vault.habits) ctx.S.vault.habits = [];
    return ctx.S.vault.habits;
  }
  function isoLocal(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }
  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  // v2.5 (فاز N6): most real habits are not daily. "Three runs a week" is a
  // perfectly kept habit that the old daily streak punished as a failure on
  // four days out of seven — which is exactly how a tracker teaches people to
  // give up. A habit now carries a target, and the streak respects it.
  function goalOf(h) {
    var n = parseInt(h.perWeek, 10);
    if (!n || n < 1) n = 7;
    return Math.min(7, n);
  }
  function isDaily(h) { return goalOf(h) >= 7; }

  // days counted in the 7-day window ending at `end`
  function weekCount(h, end) {
    var c = 0, d = new Date(end);
    for (var i = 0; i < 7; i++) {
      if (h.log[isoLocal(d)]) c++;
      d.setDate(d.getDate() - 1);
    }
    return c;
  }

  function streak(h) {
    var d = dayStart(new Date());
    if (isDaily(h)) {
      if (!h.log[isoLocal(d)]) d.setDate(d.getDate() - 1); // "not yet today" is fine
      var n = 0;
      while (h.log[isoLocal(d)]) { n++; d.setDate(d.getDate() - 1); }
      return n;
    }
    // weekly target: count consecutive 7-day windows that met the goal,
    // stepping back a week at a time
    var goal = goalOf(h), weeks = 0, cur = new Date(d);
    // the current week still counts as intact until it is actually over
    if (weekCount(h, cur) >= goal) { weeks++; }
    cur.setDate(cur.getDate() - 7);
    while (weekCount(h, cur) >= goal) { weeks++; cur.setDate(cur.getDate() - 7); }
    return weeks;
  }

  function stats(h) {
    var today = dayStart(new Date());
    function countBack(n) {
      var c = 0, d = new Date(today);
      for (var i = 0; i < n; i++) {
        if (h.log[isoLocal(d)]) c++;
        d.setDate(d.getDate() - 1);
      }
      return c;
    }
    var keys = Object.keys(h.log).sort();
    var best = 0, run = 0, prev = null;
    keys.forEach(function (k) {
      if (prev) {
        var pd = new Date(prev), kd = new Date(k);
        run = (kd - pd === 86400000) ? run + 1 : 1;
      } else run = 1;
      if (run > best) best = run;
      prev = k;
    });
    var goal = goalOf(h);
    return {
      week: countBack(7), month: countBack(30), best: best, streak: streak(h),
      goal: goal, daily: isDaily(h),
      // "done for this week" is the honest progress signal for a weekly habit
      metWeek: countBack(7) >= goal,
    };
  }

  async function toggle(h, key, popped) {
    if (h.log[key]) delete h.log[key];
    else h.log[key] = { d: 1 };
    // the tick lands immediately; the save follows on its own
    ctx.persistBg();
    setTimeout(function () { ctx.rerender(); },
      (popped && !window.FX.reduced()) ? 260 : 0);
  }
  function entry(h, key) {
    var e = h.log[key];
    if (!e) return null;
    if (typeof e !== "object") return { d: 1 };
    return e;
  }
  async function setDetail(h, key, patch) {
    var e = entry(h, key) || { d: 1 };
    Object.assign(e, patch);
    h.log[key] = e;
    // v5.5 — a habit tick is the single most-repeated action in the app; it
    // must never wait on the network.
    ctx.persistBg();
  }

  function heatmap(h) {
    var today = dayStart(new Date());
    // Saturday of the current week (fa week starts Saturday)
    var sat = new Date(today);
    sat.setDate(sat.getDate() - ((sat.getDay() + 1) % 7));
    var first = new Date(sat);
    first.setDate(first.getDate() - (WEEKS - 1) * 7);

    var map = el("div", "hm");
    for (var w = 0; w < WEEKS; w++) {
      var col = el("div", "hm__col");
      for (var d = 0; d < 7; d++) {
        var date = new Date(first);
        date.setDate(first.getDate() + w * 7 + d);
        var cell = el("div", "hm__cell");
        if (date > today) {
          cell.classList.add("hm__cell--void");
        } else {
          var key = isoLocal(date);
          var en = entry(h, key);
          if (en) {
            cell.classList.add("hm__cell--on");
            if (en.r) cell.classList.add("hm__cell--r" + en.r);
          }
          if (key === isoLocal(today)) cell.classList.add("hm__cell--today");
          var pj = ctx.J.toJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate());
          cell.title = window.CalSys.label(pj) +
            (en && en.n ? " — " + en.n : "") + (en && en.r ? " ★" + ctx.num(en.r) : "");
          (function (kk, cc) {
            cell.addEventListener("click", function () {
              var turningOn = !entry(h, kk);
              if (turningOn) {
                cc.classList.add("hm__cell--pop");
                window.FX.haptic("tick");
              } else {
                window.FX.haptic("soft");
              }
              toggle(h, kk, turningOn);
            });
          })(key, cell);
        }
        col.appendChild(cell);
      }
      map.appendChild(col);
    }
    return map;
  }

  /* v3.9.0 — the habit card's overflow menu (shares the .tb-pop styling the
   * tasks toolbar introduced, so both read as the same control). */
  function habitMenu(anchorEl, h) {
    var existing = document.querySelector(".tb-pop");
    if (existing) { existing.remove(); return; }
    var pop = el("div", "tb-pop");
    var item = el("button", "tb-pop__item", t("delete"));
    item.addEventListener("click", async function () {
      pop.remove();
      if (!(await ctx.UI.confirm({ body: t("h_confirmDelete"), danger: true }))) return;
      ctx.S.vault.habits = habits().filter(function (i) { return i.id !== h.id; });
      ctx.status("msg_deleted", "success"); ctx.rerender(); ctx.persistBg();
    });
    pop.appendChild(item);
    document.body.appendChild(pop);
    var r = anchorEl.getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + "px";
    var w = pop.offsetWidth || 200;
    pop.style.insetInlineStart = "auto";
    pop.style.left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8) + "px";
    anchorEl.setAttribute("aria-expanded", "true");
    function close() {
      if (pop.parentNode) pop.remove();
      anchorEl.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onDoc, true);
      document.removeEventListener("keydown", onKey, true);
    }
    function onDoc(e) {
      if (!document.body.contains(pop)) { close(); return; }
      if (!pop.contains(e.target) && e.target !== anchorEl) close();
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    setTimeout(function () {
      document.addEventListener("click", onDoc, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);
    item.focus();
  }

  function render(host) {
    var tb = el("div", "toolbar");
    var name = el("input", "tsearch");
    name.type = "text"; name.placeholder = t("h_name");
    var freq = el("select", "sel h-freq");
    [["7", "h_fDaily"], ["5", "h_f5"], ["4", "h_f4"], ["3", "h_f3"], ["2", "h_f2"], ["1", "h_f1"]]
      .forEach(function (o) {
        var op = el("option", null, t(o[1])); op.value = o[0]; freq.appendChild(op);
      });
    var add = el("button", "btn btn--primary btn--sm", t("h_new"));
    async function addHabit() {
      var n = name.value.trim();
      if (!n) { name.focus(); return; }
      habits().push({
        id: "h_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name: n, log: {}, perWeek: parseInt(freq.value, 10) || 7,
        createdAt: new Date().toISOString(),
      });
      name.value = "";
      ctx.status("msg_saved", "success"); ctx.rerender(); ctx.persistBg();
    }
    add.addEventListener("click", addHabit);
    name.addEventListener("keydown", function (e) { if (e.key === "Enter") addHabit(); });
    tb.appendChild(name); tb.appendChild(freq); tb.appendChild(add);
    host.appendChild(tb);

    var list = habits().slice().sort(function (a, b) {
      return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    });
    if (!list.length) {
      // the "new habit" input lives in the toolbar above — send focus there
      host.appendChild(window.FX.empty("habits", t("h_empty"), t("h_emptySub"),
        { label: t("h_new"), onClick: function () { name.focus(); } }));
      return;
    }

    list.forEach(function (h) {
      var card = el("div", "panel h-card" + (h.pinned ? " note-card--pinned" : ""));
      var head = el("div", "h-card__head");
      head.appendChild(el("h3", "h-card__name", h.name));

      var right = el("div", "h-card__right");
      var pin = el("button", "note-pin" + (h.pinned ? " on" : "")); pin.appendChild(ctx.icn("pin"));
      pin.type = "button"; pin.title = t(h.pinned ? "n_unpin" : "n_pin");
      pin.addEventListener("click", async function () {
        h.pinned = !h.pinned;
        ctx.rerender(); ctx.persistBg();
      });
      right.appendChild(pin);

      // v2.5: the target is editable in place — habits change as life does
      var fq = el("select", "sel h-freq h-freq--inline");
      [["7", "h_fDaily"], ["5", "h_f5"], ["4", "h_f4"], ["3", "h_f3"], ["2", "h_f2"], ["1", "h_f1"]]
        .forEach(function (o) {
          var op = el("option", null, t(o[1])); op.value = o[0];
          if (String(goalOf(h)) === o[0]) op.selected = true;
          fq.appendChild(op);
        });
      fq.title = t("h_target");
      fq.addEventListener("change", async function () {
        h.perWeek = parseInt(fq.value, 10) || 7;
        ctx.rerender(); ctx.persistBg();
      });
      right.appendChild(fq);
      var sx = stats(h);
      right.appendChild(el("span", "badge" + (sx.metWeek ? " badge--ok" : ""),
        t("r_week") + " " + ctx.num(sx.week) + "/" + ctx.num(sx.goal)));
      right.appendChild(el("span", "badge", t("r_month") + " " + ctx.num(sx.month) + "/" + ctx.num(30)));
      if (sx.streak > 0) {
        var sb2 = el("span", "badge badge--exam h-streak");
        sb2.title = sx.daily ? t("h_streakDays") : t("h_streakWeeks");
        var fl2 = el("span", "h-streak__flame"); fl2.appendChild(ctx.icn("flame")); sb2.appendChild(fl2);
        sb2.appendChild(el("span", null, " " + ctx.num(sx.streak)));
        right.appendChild(sb2);
      }
      var todayKey = isoLocal(new Date());
      var todayBtn = el("button",
        "btn btn--sm " + (h.log[todayKey] ? "btn--primary" : "btn--ghost"), t("h_today"));
      todayBtn.addEventListener("click", function () { toggle(h, todayKey); });
      right.appendChild(todayBtn);

      /* v3.9.0 — "Delete" sat next to "Today" at the same weight on every
       * habit card. One is the thing you press daily; the other destroys a
       * streak you may have spent months building. Equal weight on a
       * destructive action next to the most-used one is how accidents happen.
       * Delete moves into a "⋯" menu (still one tap, still confirmed). */
      var hMore = el("button", "btn btn--ghost btn--sm icon-only", "⋯");
      hMore.type = "button";
      hMore.setAttribute("aria-label", t("tb_more"));
      hMore.setAttribute("aria-haspopup", "true");
      hMore.addEventListener("click", function (e) {
        e.stopPropagation();
        habitMenu(hMore, h);
      });
      right.appendChild(hMore);
      head.appendChild(right);
      card.appendChild(head);

      // v2.5: the last seven days, tappable. Everything a daily decision needs
      // is here — the year heatmap below is for reflection, not for acting.
      var strip = el("div", "h-week");
      for (var wi = 6; wi >= 0; wi--) {
        (function (offset) {
          var d = dayStart(new Date());
          d.setDate(d.getDate() - offset);
          var key = isoLocal(d);
          var on = !!h.log[key];
          var cell = el("button", "h-wcell" + (on ? " h-wcell--on" : "") +
            (offset === 0 ? " h-wcell--today" : ""));
          cell.type = "button";
          // v3.4 (فاز ۱): «س / د» مخفف‌ها خوانا نبودند — نام کامل روز نوشته
          // می‌شود و نوار هفته روی صفحه‌های باریک افقی اسکرول می‌شود.
          cell.appendChild(el("span", "h-wcell__wd", window.CalSys.weekdayFull(window.CalSys.dowCol(d))));
          var dot = el("span", "h-wcell__dot");
          cell.appendChild(dot);
          cell.title = window.CalSys.label(
            ctx.J.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate()));
          cell.addEventListener("click", function () {
            if (!on && window.FX && !window.FX.reduced()) {
              dot.classList.add("h-wcell__dot--pop");
            }
            if (window.FX && window.FX.haptic) window.FX.haptic("soft");
            toggle(h, key, !on);
          });
          strip.appendChild(cell);
        })(wi);
      }
      card.appendChild(strip);

      var tk = isoLocal(new Date());
      var te = entry(h, tk);
      if (te) {
        var det = el("div", "h-detail");
        var stars = el("div", "h-stars");
        for (var si = 1; si <= 5; si++) {
          (function (v) {
            var sb = el("button", "h-star" + (te.r >= v ? " on" : ""));
        sb.appendChild(ctx.icn("star-fill"));
            sb.type = "button"; sb.title = t("h_rate");
            sb.addEventListener("click", async function () {
              await setDetail(h, tk, { r: te.r === v ? 0 : v });
              ctx.rerender();
            });
            stars.appendChild(sb);
          })(si);
        }
        det.appendChild(stars);
        var note = el("input", "tsearch h-note");
        note.type = "text"; note.placeholder = t("h_note");
        note.value = te.n || "";
        var saveTimer = null;
        note.addEventListener("input", function () {
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(function () { setDetail(h, tk, { n: note.value.trim() }); }, 600);
        });
        det.appendChild(note);
        card.appendChild(det);
      }
      card.appendChild(heatmap(h));
      var mtrack = el("div", "rp-cat__track h-mbar");
      var mfill = el("div", "rp-cat__fill");
      mfill.style.setProperty("--p", Math.min(1, sx.month / 30));
      mtrack.appendChild(mfill);
      card.appendChild(mtrack);
      card.appendChild(el("p", "cal-hint", t("h_hint")));
      host.appendChild(card);
    });
  }

  g.HabitsView = {
    init: init, render: render, stats: stats,
    all: function () { return (ctx && ctx.S.vault && ctx.S.vault.habits) || []; },
    doneToday: function () {
      var key = isoLocal(new Date());
      var hs = (ctx && ctx.S.vault && ctx.S.vault.habits) || [];
      return {
        done: hs.filter(function (h) { return h.log && h.log[key]; }).length,
        total: hs.length,
      };
    },
  };
})(window);
