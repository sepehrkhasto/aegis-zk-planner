/* reports.js — realistic, client-side analytics. No motivation theater:
 * just what happened. Lightweight inline SVG, no chart libraries.
 */
(function (g) {
  "use strict";
  var ctx = null;
  var SVG = "http://www.w3.org/2000/svg";

  function init(c) { ctx = c; }
  function t(k) { return ctx.T.t(k); }
  function el(a, b, c) { return ctx.el(a, b, c); }
  function sv(tag, attrs) {
    var e = document.createElementNS(SVG, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function isoLocal(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }
  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  // ---- task math -----------------------------------------------------------
  function taskData() {
    var tasks = ctx.S.vault.tasks || [];
    var today = dayStart(new Date());
    var open = 0, overdue = 0, doneTotal = 0, done7 = 0;
    var perDay = {}; // done per day (last 30)
    var byCat = {};

    var d30 = new Date(today); d30.setDate(d30.getDate() - 29);
    var d7 = new Date(today); d7.setDate(d7.getDate() - 6);

    tasks.forEach(function (x) {
      if (x.done) {
        doneTotal++;
        if (x.doneAt) {
          var dd = dayStart(new Date(x.doneAt));
          if (dd >= d7) done7++;
          if (dd >= d30) {
            var k = isoLocal(dd);
            perDay[k] = (perDay[k] || 0) + 1;
          }
        }
      } else {
        open++;
        byCat[x.cat] = (byCat[x.cat] || 0) + 1;
        if (x.due) {
          var gd = ctx.J.toGregorian(x.due.jy, x.due.jm, x.due.jd);
          if (new Date(gd.gy, gd.gm - 1, gd.gd) < today) overdue++;
        }
      }
    });
    var total = tasks.length;
    return {
      open: open, overdue: overdue, doneTotal: doneTotal, done7: done7,
      rate: total ? Math.round((doneTotal / total) * 100) : null,
      perDay: perDay, byCat: byCat, d30: d30, today: today,
    };
  }

  // ---- pieces ----------------------------------------------------------------
  function statCard(label, value) {
    var c = el("div", "stat-card");
    var lb = el("div", "stat-card__label");
    if (label && label.nodeType) lb.appendChild(label); else lb.textContent = label;
    c.appendChild(lb);
    c.appendChild(el("div", "stat-card__value", value));
    return c;
  }

  function barChart30(d) {
    var W = 900, H = 150, PAD = 4;
    var bw = (W - PAD * 2) / 30;
    var days = [], max = 1;
    for (var i = 0; i < 30; i++) {
      var day = new Date(d.d30); day.setDate(day.getDate() + i);
      var v = d.perDay[isoLocal(day)] || 0;
      if (v > max) max = v;
      days.push({ day: day, v: v });
    }
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, class: "rp-chart", role: "img" });
    days.forEach(function (o, i) {
      var h = o.v ? Math.max(6, (o.v / max) * (H - 34)) : 3;
      var x = PAD + i * bw;
      var r = sv("rect", {
        x: x + 2, y: H - 22 - h, width: bw - 4, height: h, rx: 3,
        class: o.v ? "rp-bar rp-bar--on" : "rp-bar",
      });
      var pj = ctx.J.toJalaali(o.day.getFullYear(), o.day.getMonth() + 1, o.day.getDate());
      var title = sv("title", {});
      title.textContent = window.CalSys.label(pj) + " — " + o.v;
      r.appendChild(title);
      svg.appendChild(r);
      if (o.v) {
        var tx = sv("text", { x: x + bw / 2, y: H - 26 - h, "text-anchor": "middle", class: "rp-num" });
        tx.textContent = ctx.num(o.v);
        svg.appendChild(tx);
      }
      if (i % 5 === 0 || i === 29) {
        var lb = sv("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle", class: "rp-lbl" });
        lb.textContent = ctx.num(pj.jd);
        svg.appendChild(lb);
      }
    });
    return svg;
  }

  var PALETTE = ["rp-c0", "rp-c1", "rp-c2", "rp-c3", "rp-c4", "rp-c5"];
  function catBars(byCat) {
    var entries = Object.keys(byCat).map(function (k) { return [k, byCat[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; });
    if (!entries.length) return null;
    var total = entries.reduce(function (a, e) { return a + e[1]; }, 0);

    var wrap = el("div", "rp-donutwrap");
    var svg = sv("svg", { viewBox: "0 0 42 42", class: "rp-donut", role: "img" });
    var r = 15.915; // circumference = 100
    var offset = 25; // start at 12 o'clock
    entries.forEach(function (e, i) {
      var pct = (e[1] / total) * 100;
      var c = sv("circle", {
        cx: 21, cy: 21, r: r,
        class: "rp-seg " + PALETTE[i % PALETTE.length],
        "stroke-dasharray": Math.max(0, pct - 1.5) + " " + (100 - Math.max(0, pct - 1.5)),
        "stroke-dashoffset": offset,
      });
      var title = sv("title", {});
      title.textContent = t("cat_" + e[0]) + " — " + e[1];
      c.appendChild(title);
      offset -= pct;
      svg.appendChild(c);
    });
    var tx = sv("text", { x: 21, y: 23.5, "text-anchor": "middle", class: "rp-donuttxt" });
    tx.textContent = ctx.num(total);
    svg.appendChild(tx);
    wrap.appendChild(svg);

    var leg = el("div", "rp-leg");
    entries.forEach(function (e, i) {
      var row = el("div", "rp-leg__row");
      row.appendChild(el("span", "rp-leg__dot " + PALETTE[i % PALETTE.length]));
      row.appendChild(el("span", "rp-leg__name", t("cat_" + e[0])));
      row.appendChild(el("span", "rp-cat__n", ctx.num(e[1])));
      leg.appendChild(row);
    });
    wrap.appendChild(leg);
    return wrap;
  }

  function habitTable() {
    var hs = window.HabitsView.all();
    if (!hs.length) return null;
    var box = el("div", "rp-habits");
    hs.forEach(function (h) {
      var s = window.HabitsView.stats(h);
      var row = el("div", "rp-hrow");
      row.appendChild(el("span", "rp-hrow__name", h.name));
      var right = el("div", "rp-hrow__stats");
      right.appendChild(chip(t("r_week"), s.week, 7));
      right.appendChild(chip(t("r_month"), s.month, 30));
      right.appendChild(el("span", "badge badge--exam", t("r_best") + " " + ctx.num(s.best)));
      row.appendChild(right);
      box.appendChild(row);

      // month progress bar (honest: percent of last 30 days)
      var pct = Math.round((s.month / 30) * 100);
      var track = el("div", "rp-cat__track rp-hbar");
      var fill = el("div", "rp-cat__fill");
      fill.style.setProperty("--p", pct / 100);
      track.appendChild(fill);
      box.appendChild(track);
    });
    return box;
  }
  function chip(label, v, of) {
    var pct = Math.round((v / of) * 100);
    return ctx.el("span", "badge", label + " " + ctx.num(v) + "/" + ctx.num(of) + " (" + ctx.num(pct) + t("pct") + ")");
  }

  // ---- render ----------------------------------------------------------------
  function ring(pct, label, valTxt) {
    var NS = "http://www.w3.org/2000/svg";
    var box = el("div", "ring-box");
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 40 40");
    svg.setAttribute("class", "ring-svg");
    var bg = document.createElementNS(NS, "circle");
    bg.setAttribute("cx", 20); bg.setAttribute("cy", 20); bg.setAttribute("r", 16);
    bg.setAttribute("class", "ring__bg");
    svg.appendChild(bg);
    var circ = 2 * Math.PI * 16;
    var fg = document.createElementNS(NS, "circle");
    fg.setAttribute("cx", 20); fg.setAttribute("cy", 20); fg.setAttribute("r", 16);
    fg.setAttribute("class", "ring__fg");
    fg.setAttribute("stroke-dasharray", (Math.max(0, Math.min(1, pct)) * circ) + " " + circ);
    fg.setAttribute("transform", "rotate(-90 20 20)");
    svg.appendChild(fg);
    var tx = document.createElementNS(NS, "text");
    tx.setAttribute("x", 20); tx.setAttribute("y", 23);
    tx.setAttribute("text-anchor", "middle"); tx.setAttribute("class", "ring__t");
    tx.textContent = valTxt;
    svg.appendChild(tx);
    box.appendChild(svg);
    box.appendChild(el("span", "ring-lb", label));
    return box;
  }

  function isoLocal2(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }

  function todayRings(host) {
    var v = ctx.S.vault;
    var todayKey = isoLocal2(new Date());
    // tasks due today: done / total
    var due = 0, done = 0;
    (v.tasks || []).forEach(function (x) {
      if (x.due) {
        var tj = ctx.J.toJalaali(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
        if (x.due.jy === tj.jy && x.due.jm === tj.jm && x.due.jd === tj.jd) {
          due++; if (x.done) done++;
        }
      }
    });
    var hd = window.HabitsView.doneToday();
    var water = ((v.wellness || {}).water || {})[todayKey] || 0;

    var p = el("div", "panel");
    p.appendChild(el("h2", "panel__title", t("r_today")));
    var row = el("div", "ring-row");
    row.appendChild(ring(due ? done / due : 0, t("r_todayTasks"),
      ctx.num(done) + "/" + ctx.num(due)));
    if (hd.total) row.appendChild(ring(hd.total ? hd.done / hd.total : 0, t("r_todayHabits"),
      ctx.num(hd.done) + "/" + ctx.num(hd.total)));
    row.appendChild(ring(water / 8, t("wl_water"), ctx.num(water) + "/" + ctx.num(8)));
    p.appendChild(row);
    host.appendChild(p);
  }

  function pomoWellnessPanel(host) {
    var v = ctx.S.vault;
    var pl = (v.settings && v.settings.pomoLog) || {};
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var todayN = pl[isoLocal2(today)] || 0;
    var weekN = 0;
    for (var i = 0; i < 7; i++) { var d = new Date(today); d.setDate(d.getDate() - i); weekN += pl[isoLocal2(d)] || 0; }

    var wl = v.wellness || { water: {}, sleep: {} };
    var wSum = 0, wDays = 0, sSum = 0, sDays = 0;
    for (var k = 0; k < 7; k++) {
      var dd = new Date(today); dd.setDate(today.getDate() - k);
      var key = isoLocal2(dd);
      if (wl.water && wl.water[key] != null) { wSum += wl.water[key]; wDays++; }
      if (wl.sleep && wl.sleep[key] != null) { sSum += wl.sleep[key]; sDays++; }
    }
    var grid = el("div", "stat-grid");
    grid.appendChild(statCard(t("r_pomoToday"), ctx.num(todayN)));
    grid.appendChild(statCard(t("r_pomoWeek"), ctx.num(weekN)));
    if (wDays) grid.appendChild(statCard(t("rv_water"),
      ctx.num(Math.round((wSum / wDays) * 10) / 10) + "/" + ctx.num(8)));
    if (sDays) grid.appendChild(statCard(t("rv_sleep"),
      ctx.num(Math.round((sSum / sDays) * 10) / 10) + " " + t("wl_hours")));
    host.appendChild(grid);
  }

  function bestWeekday(host) {
    var counts = [0, 0, 0, 0, 0, 0, 0]; // Sat..Fri
    var cutoff = Date.now() - 60 * 86400000;
    (ctx.S.vault.tasks || []).concat(ctx.S.vault.archive || []).forEach(function (x) {
      if (x.done && x.doneAt) {
        var t2 = new Date(x.doneAt).getTime();
        if (t2 >= cutoff) {
          var wd = (new Date(x.doneAt).getDay() + 1) % 7;
          counts[wd]++;
        }
      }
    });
    var max = Math.max.apply(null, counts);
    if (max === 0) return;
    var names = t("weekdaysFull");
    var p = el("div", "panel");
    p.appendChild(el("h2", "panel__title", t("r_byWeekday")));
    var wrap = el("div", "rp-cats");
    counts.forEach(function (c, i) {
      var row = el("div", "rp-cat");
      row.appendChild(el("span", "rp-cat__name", names[i]));
      var track = el("div", "rp-cat__track");
      var fill = el("div", "rp-cat__fill");
      fill.style.width = Math.round((c / max) * 100) + "%";
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el("span", "rp-cat__n", ctx.num(c)));
      wrap.appendChild(row);
    });
    p.appendChild(wrap);
    host.appendChild(p);
  }

  // 8-week completion trend as a lightweight SVG sparkline
  function trendPanel(host) {
    var weeks = 8;
    var counts = new Array(weeks).fill(0);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var sat = new Date(today); sat.setDate(sat.getDate() - ((sat.getDay() + 1) % 7));
    (ctx.S.vault.tasks || []).concat(ctx.S.vault.archive || []).forEach(function (x) {
      if (!x.done || !x.doneAt) return;
      var t2 = new Date(x.doneAt); t2.setHours(0, 0, 0, 0);
      var diffWk = Math.floor((sat - t2) / (7 * 86400000));
      if (diffWk >= 0 && diffWk < weeks) counts[weeks - 1 - diffWk]++;
    });
    if (counts.every(function (c) { return c === 0; })) return;
    var max = Math.max.apply(null, counts) || 1;
    var W = 900, H = 120, pad = 6;
    var stepX = (W - pad * 2) / (weeks - 1);
    var pts = counts.map(function (c, i) {
      return [pad + i * stepX, H - 22 - (c / max) * (H - 40)];
    });
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    var area = "M" + pts[0][0] + " " + (H - 22) + " " + d.replace("M", "L") +
      " L" + pts[pts.length - 1][0] + " " + (H - 22) + " Z";
    var p = el("div", "panel");
    p.appendChild(el("h2", "panel__title", t("r_trend")));
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, class: "rp-chart", role: "img" });
    svg.appendChild(sv("path", { d: area, class: "rp-area" }));
    svg.appendChild(sv("path", { d: d, class: "rp-linepath" }));
    pts.forEach(function (pt, i) {
      var c = sv("circle", { cx: pt[0], cy: pt[1], r: 4, class: "rp-dot" });
      var title = sv("title", {}); title.textContent = t("r_weekAgo").replace("{n}", ctx.num(weeks - 1 - i)) + ": " + ctx.num(counts[i]);
      c.appendChild(title); svg.appendChild(c);
      var tx = sv("text", { x: pt[0], y: H - 6, "text-anchor": "middle", class: "rp-lbl" });
      tx.textContent = ctx.num(counts[i]); svg.appendChild(tx);
    });
    p.appendChild(svg);
    host.appendChild(p);
  }

  // habit consistency summary: best current streak across all habits
  function habitSummary(host) {
    var hs = window.HabitsView.all();
    if (!hs.length) return;
    var bestStreak = 0, bestName = "", totalDays = 0;
    hs.forEach(function (h) {
      var s = window.HabitsView.stats(h);
      totalDays += Object.keys(h.log || {}).length;
      if (s.streak > bestStreak) { bestStreak = s.streak; bestName = h.name; }
    });
    var grid = el("div", "stat-grid");
    grid.appendChild(statCard(t("r_habitCount"), ctx.num(hs.length)));
    grid.appendChild(statCard(t("r_habitDays"), ctx.num(totalDays)));
    if (bestStreak) grid.appendChild(statCard(ctx.elIc("span", null, "flame", t("r_bestStreak")),
      ctx.num(bestStreak) + (bestName ? " · " + bestName : "")));
    host.appendChild(grid);
  }

  // Insights: meaningful, human conclusions computed from real data —
  // not just raw numbers. Best hour, best weekday, habit consistency,
  // and one overall productivity score.
  function insightsPanel(host, d) {
    var v = ctx.S.vault || {};
    var tasks = v.tasks || [];
    var out = [];

    // productivity score 0–100: completion rate + habit consistency + focus
    var hd = window.HabitsView.doneToday();
    var rate = d.rate !== null ? d.rate : 0;
    var habitPart = hd.total ? Math.round((hd.done / hd.total) * 100) : rate;
    var score = Math.round(rate * 0.6 + habitPart * 0.4);
    out.push({ icon: "trophy", title: t("in_score"), value: ctx.num(score) + t("pct"),
      note: score >= 70 ? t("in_scoreHigh") : (score >= 40 ? t("in_scoreMid") : t("in_scoreLow")) });

    // best working hour from completion timestamps
    var hourCount = {};
    tasks.forEach(function (x) {
      if (!x.doneAt) return;
      var h = new Date(x.doneAt).getHours();
      hourCount[h] = (hourCount[h] || 0) + 1;
    });
    var bestH = null, bestHN = 0;
    Object.keys(hourCount).forEach(function (h) {
      if (hourCount[h] > bestHN) { bestHN = hourCount[h]; bestH = +h; }
    });
    if (bestH !== null && bestHN >= 3) {
      out.push({ icon: "clock", title: t("in_bestHour"),
        value: ctx.num(String(bestH).padStart(2, "0")) + ":" + ctx.num("00"),
        note: t("in_bestHourNote") });
    }

    // best weekday
    var dayCount = {};
    tasks.forEach(function (x) {
      if (!x.doneAt) return;
      var wd = new Date(x.doneAt).getDay();
      dayCount[wd] = (dayCount[wd] || 0) + 1;
    });
    var bestD = null, bestDN = 0;
    Object.keys(dayCount).forEach(function (k) {
      if (dayCount[k] > bestDN) { bestDN = dayCount[k]; bestD = +k; }
    });
    if (bestD !== null && bestDN >= 3) {
      // JS getDay: 0=Sun … 6=Sat → weekdaysFull index (Sat-first): (d+1)%7
      var names = t("weekdaysFull");
      out.push({ icon: "calendar", title: t("in_bestDay"), value: names[(bestD + 1) % 7], note: t("in_bestDayNote") });
    }

    if (!out.length) return;
    var p = el("div", "panel");
    p.appendChild(ctx.elIc("h2", "panel__title", "sparkle", t("in_title")));
    var grid = el("div", "in-grid");
    out.forEach(function (i) {
      var c = el("div", "in-card");
      var ico = el("div", "in-card__icon"); ico.appendChild(ctx.icn(i.icon)); c.appendChild(ico);
      var main = el("div", "in-card__main");
      main.appendChild(el("div", "in-card__title", i.title));
      main.appendChild(el("div", "in-card__value", i.value));
      if (i.note) main.appendChild(el("div", "in-card__note", i.note));
      c.appendChild(main);
      grid.appendChild(c);
    });
    p.appendChild(grid);
    host.appendChild(p);
  }


  // =====================================================================
  // v1.17 — فاز G: professional charts, hand-written SVG (CSP-safe: no
  // inline style attributes, no external chart library, every colour comes
  // from a CSS class so every theme applies).
  // =====================================================================

  // completed items per local ISO day, tasks + archive (one shared source so
  // every chart below tells the same story)
  function doneByDay() {
    var map = {};
    (ctx.S.vault.tasks || []).concat(ctx.S.vault.archive || []).forEach(function (x) {
      if (!x.done || !x.doneAt || x.kind === "event") return;
      var k = isoLocal(dayStart(new Date(x.doneAt)));
      map[k] = (map[k] || 0) + 1;
    });
    return map;
  }
  function countBetween(map, from, to) {
    var n = 0, d = new Date(from);
    while (d <= to) { n += map[isoLocal(d)] || 0; d.setDate(d.getDate() + 1); }
    return n;
  }
  function deltaBadge(now, prev) {
    var diff = now - prev;
    var cls = diff > 0 ? "rp-delta rp-delta--up"
      : diff < 0 ? "rp-delta rp-delta--down" : "rp-delta";
    var sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
    return el("span", cls, sign + ctx.num(Math.abs(diff)));
  }

  // ---- مورد ۳۸: weekly / monthly / yearly comparison -------------------
  function comparePanel(host) {
    var map = doneByDay();
    var today = dayStart(new Date());
    function span(daysBack, len) {
      var to = new Date(today); to.setDate(to.getDate() - daysBack);
      var from = new Date(to); from.setDate(from.getDate() - (len - 1));
      return countBetween(map, from, to);
    }
    var rows = [
      [t("r_cmpWeek"), span(0, 7), span(7, 7)],
      [t("r_cmpMonth"), span(0, 30), span(30, 30)],
      [t("r_cmpYear"), span(0, 365), span(365, 365)],
    ];
    if (!rows.some(function (r) { return r[1] || r[2]; })) return;
    var p = el("div", "panel");
    p.appendChild(ctx.elIc("h2", "panel__title", "trend", t("r_compare")));
    var wrap = el("div", "rp-cmp");
    rows.forEach(function (r) {
      var row = el("div", "rp-cmp__row");
      row.appendChild(el("span", "rp-cmp__lb", r[0]));
      row.appendChild(el("span", "rp-cmp__now", ctx.num(r[1])));
      row.appendChild(el("span", "rp-cmp__prev", t("r_cmpPrev") + " " + ctx.num(r[2])));
      row.appendChild(deltaBadge(r[1], r[2]));
      wrap.appendChild(row);
    });
    p.appendChild(wrap);
    host.appendChild(p);
  }

  // ---- مورد ۳۸: GitHub-style yearly activity heatmap -------------------
  function yearHeatmap(host) {
    var map = doneByDay();
    if (!Object.keys(map).length) return;
    var today = dayStart(new Date());
    var start = new Date(today); start.setDate(start.getDate() - 363);
    // walk back to the start of that display week so columns line up
    var startCol = window.CalSys.dowCol(start);
    start.setDate(start.getDate() - startCol);

    var cells = [], max = 1, d = new Date(start), col = 0, total = 0;
    while (d <= today) {
      var v = map[isoLocal(d)] || 0;
      if (v > max) max = v;
      total += v;
      cells.push({ x: Math.floor(col / 7), y: col % 7, v: v, d: new Date(d) });
      col++; d.setDate(d.getDate() + 1);
    }
    var weeks = Math.ceil(col / 7);
    var S = 11, G = 2, W = weeks * (S + G), H = 7 * (S + G);
    var svg = sv("svg", {
      viewBox: "0 0 " + W + " " + H, class: "rp-heat", role: "img",
      preserveAspectRatio: "xMinYMin meet",
    });
    cells.forEach(function (c) {
      var lvl = c.v === 0 ? 0 : Math.min(4, Math.ceil((c.v / max) * 4));
      var r = sv("rect", {
        x: c.x * (S + G), y: c.y * (S + G), width: S, height: S, rx: 2,
        class: "rp-heat__c rp-heat__c--" + lvl,
      });
      var j = ctx.J.toJalaali(c.d.getFullYear(), c.d.getMonth() + 1, c.d.getDate());
      var ti = sv("title", {});
      ti.textContent = window.CalSys.label(j) + " · " + ctx.num(c.v);
      r.appendChild(ti);
      svg.appendChild(r);
    });
    var p = el("div", "panel");
    p.appendChild(ctx.elIc("h2", "panel__title", "flame", t("r_yearMap")));
    p.appendChild(el("p", "panel__text", t("r_yearMapSub").replace("{n}", ctx.num(total))));
    var scroll = el("div", "rp-heatwrap");
    scroll.appendChild(svg);
    p.appendChild(scroll);
    var lg = el("div", "rp-heatlegend");
    lg.appendChild(el("span", "rp-heatlegend__lb", t("r_less")));
    [0, 1, 2, 3, 4].forEach(function (i) {
      lg.appendChild(el("span", "rp-heat__key rp-heat__c--" + i));
    });
    lg.appendChild(el("span", "rp-heatlegend__lb", t("r_more")));
    p.appendChild(lg);
    host.appendChild(p);
  }

  // ---- مورد ۳۸: best focus hours (histogram of completion times) -------
  function bestHours(host) {
    var hours = new Array(24).fill(0), any = false;
    (ctx.S.vault.tasks || []).concat(ctx.S.vault.archive || []).forEach(function (x) {
      if (!x.done || !x.doneAt) return;
      hours[new Date(x.doneAt).getHours()]++; any = true;
    });
    if (!any) return;
    var max = Math.max.apply(null, hours) || 1;
    var W = 480, H = 120, bw = W / 24;
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, class: "rp-chart", role: "img" });
    hours.forEach(function (v, h) {
      var bh = v ? Math.max(3, (v / max) * (H - 26)) : 1;
      var r = sv("rect", {
        x: h * bw + 1.5, y: H - 18 - bh, width: bw - 3, height: bh, rx: 2,
        class: v ? "rp-bar rp-bar--on" : "rp-bar",
      });
      var ti = sv("title", {});
      ti.textContent = ctx.num(h) + ":00 · " + ctx.num(v);
      r.appendChild(ti);
      svg.appendChild(r);
      if (h % 6 === 0) {
        var lb = sv("text", { x: h * bw + bw / 2, y: H - 5, "text-anchor": "middle", class: "rp-lbl" });
        lb.textContent = ctx.num(h);
        svg.appendChild(lb);
      }
    });
    var best = hours.indexOf(max);
    var p = el("div", "panel");
    p.appendChild(ctx.elIc("h2", "panel__title", "clock", t("r_hours")));
    p.appendChild(el("p", "panel__text",
      t("r_hoursBest").replace("{h}", ctx.num(best) + ":00")));
    p.appendChild(svg);
    host.appendChild(p);
  }

  // ---- مورد ۳۸: workout report ----------------------------------------
  function workoutPanel(host) {
    var today = dayStart(new Date());
    var from = new Date(today); from.setDate(from.getDate() - 29);
    var perDay = {}, done = 0, planned = 0;
    (ctx.S.vault.tasks || []).concat(ctx.S.vault.archive || []).forEach(function (x) {
      if (x.cat !== "sport" || x.kind === "event") return;
      if (x.done && x.doneAt) {
        var dd = dayStart(new Date(x.doneAt));
        if (dd >= from) { perDay[isoLocal(dd)] = (perDay[isoLocal(dd)] || 0) + 1; done++; }
      } else if (!x.done) planned++;
    });
    if (!done && !planned) return;
    var days = [], d = new Date(from);
    while (d <= today) { days.push(perDay[isoLocal(d)] || 0); d.setDate(d.getDate() + 1); }
    var active = days.filter(Boolean).length;
    var p = el("div", "panel");
    p.appendChild(ctx.elIc("h2", "panel__title", "habits", t("r_workout")));
    var grid = el("div", "stat-grid");
    grid.appendChild(statCard(t("r_woDone30"), ctx.num(done)));
    grid.appendChild(statCard(t("r_woDays30"), ctx.num(active) + "/" + ctx.num(days.length)));
    grid.appendChild(statCard(t("r_woOpen"), ctx.num(planned)));
    p.appendChild(grid);
    p.appendChild(sparkline(days));
    host.appendChild(p);
  }

  // small shared sparkline (area + line), used by workout & habit charts
  function sparkline(values) {
    var W = 480, H = 60, pad = 3;
    var max = Math.max.apply(null, values) || 1;
    var stepX = values.length > 1 ? (W - pad * 2) / (values.length - 1) : 0;
    var pts = values.map(function (v, i) {
      return [pad + i * stepX, H - 6 - (v / max) * (H - 14)];
    });
    var line = pts.map(function (p2, i) {
      return (i ? "L" : "M") + p2[0].toFixed(1) + " " + p2[1].toFixed(1);
    }).join(" ");
    var area = "M" + pts[0][0] + " " + (H - 6) + " " + line.replace("M", "L") +
      " L" + pts[pts.length - 1][0] + " " + (H - 6) + " Z";
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, class: "rp-chart rp-spark", role: "img" });
    svg.appendChild(sv("path", { d: area, class: "rp-area" }));
    svg.appendChild(sv("path", { d: line, class: "rp-linepath" }));
    return svg;
  }

  // ---- مورد ۳۹: habit analysis charts ----------------------------------
  function habitCharts(host) {
    var hs = window.HabitsView.all();
    if (!hs.length) return;
    var today = dayStart(new Date());
    var p = el("div", "panel");
    p.appendChild(ctx.elIc("h2", "panel__title", "habits", t("r_habitCharts")));
    hs.forEach(function (h) {
      var row = el("div", "rp-hrow");
      var head = el("div", "rp-hrow__head");
      head.appendChild(el("span", "rp-hrow__name", h.name));
      var s = window.HabitsView.stats(h);
      head.appendChild(ctx.elIc("span", "badge", "flame",
        ctx.num(s.streak) + " · " + t("r_best") + " " + ctx.num(s.best)));
      row.appendChild(head);
      // 30-day grid: one square per day, filled when the habit was logged
      var grid = el("div", "rp-hgrid");
      var hit = 0;
      for (var i = 29; i >= 0; i--) {
        var d = new Date(today); d.setDate(d.getDate() - i);
        var on = !!(h.log || {})[isoLocal(d)];
        if (on) hit++;
        var cell = el("span", "rp-hcell" + (on ? " rp-hcell--on" : ""));
        var j = ctx.J.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
        cell.title = window.CalSys.label(j);
        grid.appendChild(cell);
      }
      row.appendChild(grid);
      row.appendChild(el("span", "rp-hrow__pct",
        ctx.num(Math.round((hit / 30) * 100)) + t("pct") + " · " + t("r_last30")));
      p.appendChild(row);
    });
    host.appendChild(p);
  }

  // ---- مورد ۴۰: mood tracker + trend -----------------------------------
  function moodPanel(host) {
    /* v3.5: journal entries are notes now — a mood datapoint is any note
     * with a mood and a date (jdate for migrated/check-in notes, otherwise
     * the day the note was created). */
    var entries = (ctx.S.vault.notes || []).filter(function (e) { return e.mood != null; });
    if (!entries.length) return;
    var byDate = {};
    entries.forEach(function (e) {
      var d = e.jdate || (e.createdAt || "").slice(0, 10);
      if (d) byDate[d] = e.mood;
    });
    var today = dayStart(new Date());
    var vals = [], marks = [], dist = [0, 0, 0, 0, 0], n = 0, sum = 0;
    for (var i = 29; i >= 0; i--) {
      var d = new Date(today); d.setDate(d.getDate() - i);
      var m = byDate[isoLocal(d)];
      if (m == null) { vals.push(null); continue; }
      // stored 0 = happiest … 4 = lowest; plot it upright (4 = best)
      var up = 4 - m;
      vals.push(up); marks.push({ i: 29 - i, v: up, d: new Date(d) });
      dist[m]++; n++; sum += up;
    }
    if (!n) return;
    var p = el("div", "panel");
    p.appendChild(ctx.elIc("h2", "panel__title", "mood-1", t("r_mood")));
    p.appendChild(el("p", "panel__text",
      t("r_moodAvg").replace("{v}", ctx.num(Math.round((sum / n) * 10) / 10))));

    // trend line over the last 30 days, gaps left as gaps (no fake data)
    var W = 480, H = 110, pad = 6;
    var stepX = (W - pad * 2) / 29;
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, class: "rp-chart", role: "img" });
    for (var g = 0; g <= 4; g++) {
      var yy = 12 + (4 - g) * ((H - 30) / 4);
      svg.appendChild(sv("line", { x1: pad, y1: yy, x2: W - pad, y2: yy, class: "rp-grid" }));
    }
    var seg = [];
    marks.forEach(function (mk, idx) {
      var x = pad + mk.i * stepX, y = 12 + (4 - mk.v) * ((H - 30) / 4);
      var prev = marks[idx - 1];
      seg.push(((prev && mk.i - prev.i === 1) ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1));
      var c = sv("circle", { cx: x, cy: y, r: 3.5, class: "rp-dot" });
      var j = ctx.J.toJalaali(mk.d.getFullYear(), mk.d.getMonth() + 1, mk.d.getDate());
      var ti = sv("title", {});
      ti.textContent = window.CalSys.label(j) + " · " + t("mood_" + (4 - mk.v));
      c.appendChild(ti);
      svg.appendChild(c);
    });
    svg.insertBefore(sv("path", { d: seg.join(" "), class: "rp-linepath" }), svg.firstChild);
    p.appendChild(svg);

    // distribution across the five faces
    var drow = el("div", "rp-moodrow");
    dist.forEach(function (c, mi) {
      var b = el("div", "rp-moodbar");
      var ic = el("span", "rp-moodbar__ic");
      ic.appendChild(ctx.icn("mood-" + mi));
      b.appendChild(ic);
      var track = el("div", "rp-moodbar__track");
      var fill = el("div", "rp-moodbar__fill");
      fill.style.setProperty("--p", n ? c / n : 0);
      track.appendChild(fill);
      b.appendChild(track);
      b.appendChild(el("span", "rp-moodbar__n", ctx.num(c)));
      drow.appendChild(b);
    });
    p.appendChild(drow);
    host.appendChild(p);
  }

  // ---- مورد ۴۱: print the report ---------------------------------------

  // =====================================================================
  // v2.4 — فاز N5: analysis, not just charts.
  //
  // Three metrics no Persian planner shows, all of them computable from
  // data we already store:
  //   • lead time — how long a task waits between being written and done
  //   • slippage  — what actually gets postponed, and which kind slips most
  //   • the mood ↔ output link — the one combination we have that no
  //     single-purpose competitor does
  // =====================================================================

  function median(nums) {
    if (!nums.length) return 0;
    var a = nums.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
  }

  function allTasks() {
    return (ctx.S.vault.tasks || []).concat(ctx.S.vault.archive || []);
  }

  // ---- lead time: written → finished ------------------------------------
  function leadTimePanel(host) {
    var days = [];
    allTasks().forEach(function (x) {
      if (!x.done || !x.doneAt || !x.createdAt || x.kind === "event") return;
      var ms = new Date(x.doneAt) - new Date(x.createdAt);
      if (ms < 0) return;
      days.push(Math.round(ms / 86400000));
    });
    if (days.length < 3) return;      // three points is not a trend

    var med = median(days);
    var sameDay = days.filter(function (d) { return d === 0; }).length;
    var overWeek = days.filter(function (d) { return d > 7; }).length;

    var p = el("div", "panel");
    p.appendChild(ctx.elIc("h2", "panel__title", "clock", t("r_lead")));
    p.appendChild(el("p", "panel__text", t("r_leadSub")));
    var grid = el("div", "stat-grid");
    grid.appendChild(statCard(t("r_leadMed"),
      med === 0 ? t("r_sameDay") : ctx.num(med) + " " + t("unit_day")));
    grid.appendChild(statCard(t("r_leadSame"),
      ctx.num(Math.round((sameDay / days.length) * 100)) + t("pct")));
    grid.appendChild(statCard(t("r_leadSlow"), ctx.num(overWeek)));
    p.appendChild(grid);

    // distribution: same day / 1-3 / 4-7 / 8+
    var buckets = [0, 0, 0, 0];
    days.forEach(function (d) {
      if (d === 0) buckets[0]++;
      else if (d <= 3) buckets[1]++;
      else if (d <= 7) buckets[2]++;
      else buckets[3]++;
    });
    var labels = [t("r_b0"), t("r_b1"), t("r_b2"), t("r_b3")];
    var max = Math.max.apply(null, buckets) || 1;
    var rows = el("div", "rp-dist");
    buckets.forEach(function (v, i) {
      var row = el("div", "rp-dist__row");
      row.appendChild(el("span", "rp-dist__lb", labels[i]));
      var track = el("div", "rp-dist__track");
      var fill = el("div", "rp-dist__fill");
      fill.style.setProperty("--p", v / max);
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el("span", "rp-dist__n", ctx.num(v)));
      rows.appendChild(row);
    });
    p.appendChild(rows);
    host.appendChild(p);
  }

  // ---- slippage: what gets postponed ------------------------------------
  function slipPanel(host) {
    var today = dayStart(new Date());
    var late = 0, onTime = 0, byCat = {};
    allTasks().forEach(function (x) {
      if (x.kind === "event" || !x.due) return;
      var due = ctx.J.toGregorian(x.due.jy, x.due.jm, x.due.jd);
      var dueDate = new Date(due.gy, due.gm - 1, due.gd);
      if (x.done && x.doneAt) {
        if (dayStart(new Date(x.doneAt)) > dueDate) {
          late++;
          byCat[x.cat] = (byCat[x.cat] || 0) + 1;
        } else onTime++;
      } else if (!x.done && dueDate < today) {
        late++;
        byCat[x.cat] = (byCat[x.cat] || 0) + 1;
      }
    });
    if (late + onTime < 5) return;

    var pct = Math.round((onTime / (late + onTime)) * 100);
    var worst = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; })[0];

    var p = el("div", "panel");
    p.appendChild(ctx.elIc("h2", "panel__title", "trend", t("r_slip")));
    var grid = el("div", "stat-grid");
    grid.appendChild(statCard(t("r_onTime"), ctx.num(pct) + t("pct")));
    grid.appendChild(statCard(t("r_slipped"), ctx.num(late)));
    if (worst) grid.appendChild(statCard(t("r_slipCat"), t("cat_" + worst)));
    p.appendChild(grid);
    p.appendChild(el("p", "panel__text",
      pct >= 80 ? t("r_slipGood") : pct >= 55 ? t("r_slipOk") : t("r_slipBad")));
    host.appendChild(p);
  }

  // ---- mood ↔ output ------------------------------------------------------
  function linkPanel(host) {
    var moods = {};
    (ctx.S.vault.notes || []).forEach(function (e) {
      var d = e.jdate || (e.createdAt || "").slice(0, 10);
      if (e.mood != null && d) moods[d] = e.mood;   // 0 best … 4 worst
    });
    var keys = Object.keys(moods);
    if (keys.length < 6) return;       // below this it is noise, not a pattern

    var done = doneByDay();
    var good = [], low = [];
    keys.forEach(function (k) {
      var n = done[k] || 0;
      if (moods[k] <= 1) good.push(n);
      else if (moods[k] >= 3) low.push(n);
    });
    if (good.length < 3 || low.length < 3) return;

    function avg(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }
    var g = Math.round(avg(good) * 10) / 10;
    var l = Math.round(avg(low) * 10) / 10;

    var p = el("div", "panel");
    p.appendChild(ctx.elIc("h2", "panel__title", "sparkle", t("r_link")));
    var grid = el("div", "stat-grid");
    grid.appendChild(statCard(t("r_linkGood"), ctx.num(g)));
    grid.appendChild(statCard(t("r_linkLow"), ctx.num(l)));
    grid.appendChild(statCard(t("r_linkDays"), ctx.num(good.length + low.length)));
    p.appendChild(grid);

    var diff = g - l;
    var msg = Math.abs(diff) < 0.5 ? t("r_linkFlat")
      : diff > 0 ? t("r_linkPos").replace("{n}", ctx.num(Math.round(diff * 10) / 10))
                 : t("r_linkNeg").replace("{n}", ctx.num(Math.round(-diff * 10) / 10));
    p.appendChild(el("p", "panel__text", msg));
    // stated plainly, because a chart implying causation is a lie with axes
    p.appendChild(el("p", "panel__text dg-hint", t("r_linkCaveat")));
    host.appendChild(p);
  }

  function printBar(host) {
    var tb = el("div", "toolbar rp-printbar");
    var b = ctx.elIc("button", "btn btn--ghost btn--sm", "print", t("printMonth"));
    b.addEventListener("click", function () { window.print(); });
    tb.appendChild(b);
    host.appendChild(tb);
  }

  var tab = "overview";     // overview | tasks | habits | wellbeing


  /* ================================================================
   * v6.2 — گزارش‌های تصمیم‌محور
   *
   * The brief for these was explicit: a good report ends in a decision, not
   * in a number that merely looks nice. So each of these five states what it
   * found AND what to do about it, and each refuses to speak when it does not
   * have enough evidence — a confident chart drawn from four data points is
   * worse than no chart, because it gets acted on.
   * ================================================================ */

  var MIN_SAMPLE = 8;        // below this, any pattern is noise

  function tasksAll() {
    return (ctx.S.vault.tasks || []).concat(ctx.S.vault.archive || []);
  }

  /* A panel that explains why a report is empty instead of showing nothing.
   * "No data" is a fact the user can act on — start estimating, keep using
   * the app — but only if we say it. */
  function notYet(host, titleKey, iconName, whyKey) {
    var p = el("div", "panel rp-empty");
    p.appendChild(ctx.elIc("h2", "panel__title", iconName, t(titleKey)));
    p.appendChild(el("p", "panel__text rp-empty__why", t(whyKey)));
    host.appendChild(p);
  }

  function decisionLine(text) {
    var d = el("div", "rp-decide");
    d.appendChild(el("span", "rp-decide__k", t("r_decide")));
    d.appendChild(el("span", "rp-decide__v", text));
    return d;
  }

  // ---- 1. الگوی زمانی: when do you actually finish? -------------------
  function peakWindowPanel(host) {
    var hours = new Array(24).fill(0), n = 0;
    tasksAll().forEach(function (x) {
      if (!x.done || !x.doneAt) return;
      hours[new Date(x.doneAt).getHours()]++; n++;
    });
    if (n < MIN_SAMPLE) {
      return notYet(host, "r_peakTitle", "clock", "r_peakEmpty");
    }
    // the best CONTIGUOUS three hours, not the single best hour: one spike is
    // an accident, a block is a habit you can schedule around
    var best = 0, bestSum = -1;
    for (var i = 0; i < 24; i++) {
      var sum = hours[i] + hours[(i + 1) % 24] + hours[(i + 2) % 24];
      if (sum > bestSum) { bestSum = sum; best = i; }
    }
    var share = Math.round(bestSum / n * 100);
    var p = el("div", "panel");
    p.appendChild(ctx.elIc("h2", "panel__title", "clock", t("r_peakTitle")));
    p.appendChild(el("p", "panel__text",
      t("r_peakBody")
        .replace("{a}", ctx.num(best) + ":00")
        .replace("{b}", ctx.num((best + 3) % 24) + ":00")
        .replace("{p}", ctx.num(share))));
    p.appendChild(hourChart(hours, best));
    p.appendChild(decisionLine(t("r_peakDecide")
      .replace("{a}", ctx.num(best) + ":00")
      .replace("{b}", ctx.num((best + 3) % 24) + ":00")));
    host.appendChild(p);
  }

  function hourChart(hours, highlightFrom) {
    var max = Math.max.apply(null, hours) || 1;
    var W = 480, H = 110, bw = W / 24;
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, class: "rp-chart", role: "img" });
    hours.forEach(function (v, h) {
      var inBlock = (h - highlightFrom + 24) % 24 < 3;
      var bh = v ? Math.max(3, (v / max) * (H - 26)) : 1;
      var r = sv("rect", {
        x: h * bw + 1.5, y: H - 18 - bh, width: bw - 3, height: bh, rx: 2,
        class: "rp-bar" + (inBlock ? " rp-bar--peak" : (v ? " rp-bar--on" : "")),
      });
      var ti = sv("title", {});
      ti.textContent = ctx.num(h) + ":00 · " + ctx.num(v);
      r.appendChild(ti);
      svg.appendChild(r);
      if (h % 6 === 0) {
        var lb = sv("text", { x: h * bw + bw / 2, y: H - 5,
                              "text-anchor": "middle", class: "rp-lbl" });
        lb.textContent = ctx.num(h);
        svg.appendChild(lb);
      }
    });
    return svg;
  }

  // ---- 2. تخمین در برابر واقعیت: how late, really? --------------------
  function realismPanel(host) {
    // "Later than planned" is measured against the date you set, because that
    // is the promise you made to yourself. Tasks finished before their date
    // count too — otherwise the number only ever looks bad.
    var deltas = [];
    tasksAll().forEach(function (x) {
      if (!x.done || !x.doneAt || !x.due) return;
      var due = ctx.J.toGregorian(x.due.jy, x.due.jm, x.due.jd);
      var dueD = new Date(due.gy, due.gm - 1, due.gd);
      var doneD = dayStart(new Date(x.doneAt));
      deltas.push(Math.round((doneD - dueD) / 86400000));
    });
    if (deltas.length < MIN_SAMPLE) {
      return notYet(host, "r_realTitle", "trend", "r_realEmpty");
    }
    deltas.sort(function (a, b) { return a - b; });
    var median = deltas[Math.floor(deltas.length / 2)];
    var onTime = deltas.filter(function (d) { return d <= 0; }).length;
    var onTimePct = Math.round(onTime / deltas.length * 100);
    var late = deltas.filter(function (d) { return d > 0; });
    var avgLate = late.length
      ? Math.round(late.reduce(function (a, b) { return a + b; }, 0) / late.length)
      : 0;

    var p = el("div", "panel");
    p.appendChild(ctx.elIc("h2", "panel__title", "trend", t("r_realTitle")));
    var grid = el("div", "stat-grid");
    grid.appendChild(statCard(t("r_realOnTime"), ctx.num(onTimePct) + t("pct")));
    grid.appendChild(statCard(t("r_realMedian"),
      (median > 0 ? "+" : "") + ctx.num(median)));
    if (late.length) grid.appendChild(statCard(t("r_realAvgLate"), ctx.num(avgLate)));
    p.appendChild(grid);

    // The realism factor is only offered when there IS a consistent lateness.
    // Telling someone who finishes on time to pad their dates would be advice
    // that makes their planning worse.
    if (median > 0) {
      p.appendChild(decisionLine(
        t("r_realDecide").replace("{n}", ctx.num(median))));
    } else {
      p.appendChild(decisionLine(t("r_realDecideOk")));
    }
    host.appendChild(p);
  }

  // ---- 3. کارهای فراری: what keeps sliding? ---------------------------
  function runawayPanel(host) {
    var moved = tasksAll().filter(function (x) {
      return !x.done && (x.moves || 0) >= 3;
    }).sort(function (a, b) { return (b.moves || 0) - (a.moves || 0); });

    if (!moved.length) {
      // Nothing running away is genuinely good news and should read as such,
      // not as a broken empty panel.
      var okp = el("div", "panel");
      okp.appendChild(ctx.elIc("h2", "panel__title", "check", t("r_runTitle")));
      okp.appendChild(el("p", "panel__text", t("r_runNone")));
      host.appendChild(okp);
      return;
    }
    var p = el("div", "panel");
    p.appendChild(ctx.elIc("h2", "panel__title", "warn", t("r_runTitle")));
    p.appendChild(el("p", "panel__text", t("r_runBody")));
    var list = el("div", "rp-run");
    moved.slice(0, 8).forEach(function (x) {
      var row = el("div", "rp-run__row");
      var title = el("button", "rp-run__t", x.title);
      title.type = "button";
      title.addEventListener("click", function () {
        if (g.TasksView && g.TasksView.openById) g.TasksView.openById(x.id);
      });
      row.appendChild(title);
      row.appendChild(el("span", "rp-run__n",
        t("r_runTimes").replace("{n}", ctx.num(x.moves))));
      list.appendChild(row);
    });
    p.appendChild(list);
    p.appendChild(decisionLine(t("r_runDecide")));
    host.appendChild(p);
  }

  // ---- 4. خواب و حال‌وهوا در برابر خروجی ------------------------------
  function correlationPanel(host) {
    var v = ctx.S.vault;
    var wl = v.wellness || { sleep: {} };
    var done = doneByDay();
    var pairs = [];
    Object.keys(wl.sleep || {}).forEach(function (key) {
      var h = wl.sleep[key];
      if (h == null) return;
      pairs.push({ sleep: h, done: done[key] || 0 });
    });
    if (pairs.length < MIN_SAMPLE) {
      return notYet(host, "r_corrTitle", "moon", "r_corrEmpty");
    }
    // Split at the median rather than an arbitrary "8 hours": the question is
    // how THIS person's better nights compare with their worse ones.
    var sorted = pairs.slice().sort(function (a, b) { return a.sleep - b.sleep; });
    var mid = sorted[Math.floor(sorted.length / 2)].sleep;
    var lo = pairs.filter(function (x) { return x.sleep < mid; });
    var hi = pairs.filter(function (x) { return x.sleep >= mid; });
    if (!lo.length || !hi.length) {
      return notYet(host, "r_corrTitle", "moon", "r_corrEmpty");
    }
    var avg = function (a) {
      return a.reduce(function (s, x) { return s + x.done; }, 0) / a.length;
    };
    var loAvg = avg(lo), hiAvg = avg(hi);
    var diff = hiAvg - loAvg;
    var pct = loAvg ? Math.round(diff / loAvg * 100) : 0;

    var p = el("div", "panel");
    p.appendChild(ctx.elIc("h2", "panel__title", "moon", t("r_corrTitle")));
    p.appendChild(el("p", "panel__text",
      t("r_corrBody")
        .replace("{h}", ctx.num(Math.round(mid * 10) / 10))
        .replace("{lo}", ctx.num(Math.round(loAvg * 10) / 10))
        .replace("{hi}", ctx.num(Math.round(hiAvg * 10) / 10))));
    p.appendChild(twoBar(loAvg, hiAvg));

    // This is a correlation over a small personal sample. Presenting it as
    // cause would be the kind of confident nonsense a wellness app ships;
    // the copy says "on your better nights" and stops there.
    if (Math.abs(pct) >= 15) {
      p.appendChild(decisionLine(
        (diff > 0 ? t("r_corrDecideUp") : t("r_corrDecideDown"))
          .replace("{p}", ctx.num(Math.abs(pct)))));
    } else {
      p.appendChild(decisionLine(t("r_corrDecideFlat")));
    }
    p.appendChild(el("p", "rp-caveat", t("r_corrCaveat")
      .replace("{n}", ctx.num(pairs.length))));
    host.appendChild(p);
  }

  function twoBar(a, b) {
    var max = Math.max(a, b, 1);
    var W = 300, H = 90;
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, class: "rp-chart", role: "img" });
    [[a, 0, "rp-bar--on"], [b, 1, "rp-bar--peak"]].forEach(function (o) {
      var bh = Math.max(4, (o[0] / max) * (H - 28));
      svg.appendChild(sv("rect", {
        x: 40 + o[1] * 150, y: H - 20 - bh, width: 110, height: bh, rx: 4,
        class: "rp-bar " + o[2],
      }));
    });
    return svg;
  }

  // ---- 5. مرور سالانه -------------------------------------------------
  function yearReviewPanel(host) {
    var now = new Date();
    var from = new Date(now.getFullYear(), 0, 1);
    var done = 0, hours = new Array(24).fill(0), byMonth = new Array(12).fill(0);
    var firstDone = null;
    tasksAll().forEach(function (x) {
      if (!x.done || !x.doneAt) return;
      var d = new Date(x.doneAt);
      if (d < from) return;
      done++;
      hours[d.getHours()]++;
      byMonth[d.getMonth()]++;
      if (!firstDone || d < firstDone) firstDone = d;
    });
    if (done < MIN_SAMPLE) {
      return notYet(host, "r_yearTitle", "star", "r_yearEmpty");
    }
    var busiest = byMonth.indexOf(Math.max.apply(null, byMonth));
    var notes = (ctx.S.vault.notes || []).filter(function (n) {
      return n.createdAt && new Date(n.createdAt) >= from;
    }).length;
    var streakDays = Object.keys(doneByDay()).filter(function (k) {
      return new Date(k) >= from;
    }).length;

    var p = el("div", "panel rp-year");
    p.appendChild(ctx.elIc("h2", "panel__title", "star", t("r_yearTitle")));
    var grid = el("div", "stat-grid");
    grid.appendChild(statCard(t("r_yearDone"), ctx.num(done)));
    grid.appendChild(statCard(t("r_yearDays"), ctx.num(streakDays)));
    if (notes) grid.appendChild(statCard(t("r_yearNotes"), ctx.num(notes)));
    grid.appendChild(statCard(t("r_yearBusiest"),
      ctx.T.t("mon_" + (busiest + 1)) || ctx.num(busiest + 1)));
    p.appendChild(grid);
    p.appendChild(monthBars(byMonth));
    p.appendChild(el("p", "rp-caveat", t("r_yearNote")));
    host.appendChild(p);
  }

  function monthBars(byMonth) {
    var max = Math.max.apply(null, byMonth) || 1;
    var W = 480, H = 100, bw = W / 12;
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, class: "rp-chart", role: "img" });
    byMonth.forEach(function (v, m) {
      var bh = v ? Math.max(3, (v / max) * (H - 24)) : 1;
      var r = sv("rect", {
        x: m * bw + 3, y: H - 16 - bh, width: bw - 6, height: bh, rx: 3,
        class: v ? "rp-bar rp-bar--on" : "rp-bar",
      });
      var ti = sv("title", {}); ti.textContent = ctx.num(v);
      r.appendChild(ti);
      svg.appendChild(r);
    });
    return svg;
  }

  function decisionsTab(host) {
    peakWindowPanel(host);
    realismPanel(host);
    runawayPanel(host);
    correlationPanel(host);
    yearReviewPanel(host);
  }

  function render(host) {
    var d = taskData();

    printBar(host);           // فاز G مورد ۴۱

    // v2.4: four coherent stories instead of one endless scroll
    var tabs = el("div", "seg rp-tabs");
    [["overview", "r_tabOverview"], ["decisions", "r_tabDecide"],
     ["tasks", "r_tabTasks"], ["habits", "r_tabHabits"],
     ["wellbeing", "r_tabWell"]].forEach(function (o) {
      var b = el("button", "seg__btn" + (tab === o[0] ? " active" : ""), t(o[1]));
      b.type = "button";
      b.addEventListener("click", function () { tab = o[0]; ctx.rerender(); });
      tabs.appendChild(b);
    });
    host.appendChild(tabs);

    if (tab === "decisions") return decisionsTab(host);
    if (tab === "tasks") return tasksTab(host, d);
    if (tab === "habits") return habitsTab(host);
    if (tab === "wellbeing") return wellbeingTab(host);
    return overviewTab(host, d);
  }

  function overviewTab(host, d) {
    todayRings(host);
    insightsPanel(host, d);

    var grid = el("div", "stat-grid");
    grid.appendChild(statCard(t("r_doneWeek"), ctx.num(d.done7)));
    grid.appendChild(statCard(t("f_open"), ctx.num(d.open)));
    grid.appendChild(statCard(t("r_overdue"), ctx.num(d.overdue)));
    if (d.rate !== null) grid.appendChild(statCard(t("r_rate"), ctx.num(d.rate) + t("pct")));
    host.appendChild(grid);

    trendPanel(host);
    comparePanel(host);
    yearHeatmap(host);
  }

  function tasksTab(host, d) {
    var hasTaskData = d.doneTotal || d.open;
    var p1 = el("div", "panel");
    p1.appendChild(el("h2", "panel__title", t("r_done30")));
    if (hasTaskData) p1.appendChild(barChart30(d));
    else p1.appendChild(el("p", "panel__text", t("r_noData")));
    host.appendChild(p1);

    var cats = catBars(d.byCat);
    if (cats) {
      var p2 = el("div", "panel");
      p2.appendChild(el("h2", "panel__title", t("r_byCat")));
      p2.appendChild(cats);
      host.appendChild(p2);
    }

    leadTimePanel(host);      // v2.4
    slipPanel(host);          // v2.4
    bestWeekday(host);
    bestHours(host);
  }

  function habitsTab(host) {
    habitCharts(host);
    habitSummary(host);
    workoutPanel(host);
    var p3 = el("div", "panel");
    p3.appendChild(el("h2", "panel__title", t("r_habits")));
    var ht = habitTable();
    if (ht) p3.appendChild(ht);
    else p3.appendChild(el("p", "panel__text", t("r_noData")));
    host.appendChild(p3);
  }

  function wellbeingTab(host) {
    moodPanel(host);
    linkPanel(host);          // v2.4
    pomoWellnessPanel(host);
  }

  g.ReportsView = { init: init, render: render };
})(window);
