/* tasks.js — full task manager on the encrypted vault. All client-side.
 * Task shape: { id, title, notes, cat, tags[], pr, hz, due:{jy,jm,jd}|null,
 *               done, createdAt, doneAt }
 * cat: study|work|sport|personal|exam|other  pr: high|normal|low  hz: short|long
 */
(function (g) {
  "use strict";

  var ctx = null; // { S, T, J, el, num, status, persist, rerender }
  var filters = { status: "open", cat: "all", pr: "all", hz: "all", q: "", scope: "all", kind: "all" };
  // v3.8: filters start collapsed — the toggle reveals them on demand
  var filtersOpen = false;

  // how many filters are actually narrowing the list right now (so the
  // toggle can show a count and the user never forgets a hidden filter)
  function activeFilterCount() {
    var n = 0;
    if (filters.scope !== "all") n++;
    if (filters.status !== "open") n++;   // "open" is the natural default
    if (filters.kind !== "all") n++;
    if (filters.cat !== "all") n++;
    if (filters.pr !== "all") n++;
    if (filters.hz !== "all") n++;
    if (filters.q) n++;
    return n;
  }
  var editingId = null;

  var CATS = ["study", "work", "sport", "personal", "exam", "other"];
  var PRS = ["high", "normal", "low"];
  var HZS = ["short", "long"];
  var PR_ORDER = { high: 0, normal: 1, low: 2 };

  function init(c) { ctx = c; }
  function t(k) { return ctx.T.t(k); }
  function el(a, b, c) { return ctx.el(a, b, c); }
  function tasks() {
    if (!ctx.S.vault.tasks) ctx.S.vault.tasks = [];
    return ctx.S.vault.tasks;
  }

  // ---- dates ---------------------------------------------------------------
  function todayJ() {
    var n = new Date();
    return ctx.J.toJalaali(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }
  function dueToDate(due) {
    var gd = ctx.J.toGregorian(due.jy, due.jm, due.jd);
    return new Date(gd.gy, gd.gm - 1, gd.gd);
  }
  function daysUntil(due) {
    var now = new Date();
    var a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((dueToDate(due) - a) / 86400000);
  }
  // ---- swipe to act (v1.8.2) ------------------------------------------------
  // Right→ complete, left→ delete (mirrored in RTL by using the physical axis
  // and mapping intent from direction). A flick counts even if it is short:
  // velocity > 0.11 dismisses, exactly as Sonner does. Movement past the edge
  // is damped rather than hard-stopped, because nothing in life stops dead.
  var SW_THRESH = 96;
  function attachSwipe(row, x, chk) {
    if (!window.matchMedia("(pointer: coarse)").matches) return; // touch only
    var startX = 0, startY = 0, dx = 0, t0 = 0;
    var active = false, decided = false, pid = null;
    var hint = null;

    function ensureHint() {
      if (hint) return hint;
      hint = el("div", "task-row__swipe");
      row.insertBefore(hint, row.firstChild);
      return hint;
    }
    function paint() {
      var h = ensureHint();
      var completing = dx > 0;
      h.className = "task-row__swipe " + (completing ? "task-row__swipe--done" : "task-row__swipe--del");
      h.textContent = completing ? t(x.done ? "ctx_undone" : "ctx_done") : t("delete");
      h.style.opacity = Math.min(1, Math.abs(dx) / SW_THRESH);
      row.style.transform = "translateX(" + dx + "px)";
    }
    // The row springs back from wherever the finger left it, carrying the
    // user's own velocity into the return — the motion is a continuation of
    // their gesture, not a fresh animation that ignores it.
    function reset(snap, velocity) {
      row.classList.remove("task-row--swiping");
      if (snap) {
        // project the throw a little further before it settles (Apple's
        // "momentum projection"): fast flicks overshoot, slow drags don't
        var overshoot = Math.min(18, Math.abs(velocity || 0) * 60) * Math.sign(dx || 1);
        row.style.transform = "translateX(" + overshoot.toFixed(1) + "px)";
        row.classList.add("task-row--snapback");
        requestAnimationFrame(function () { row.style.transform = ""; });
      } else {
        row.style.transform = "";
      }
      if (hint) hint.style.opacity = "0";
      setTimeout(function () { row.classList.remove("task-row--snapback"); }, 280);
      active = false; decided = false; dx = 0;
    }

    row.addEventListener("pointerdown", function (e) {
      if (active) return;                       // multi-touch protection
      if (e.target.closest("button, input, a, select")) return;
      pid = e.pointerId;
      startX = e.clientX; startY = e.clientY; t0 = Date.now();
      active = true; decided = false; dx = 0;
    });
    row.addEventListener("pointermove", function (e) {
      if (!active || e.pointerId !== pid) return;
      var mx = e.clientX - startX, my = e.clientY - startY;
      if (!decided) {
        if (Math.abs(my) > Math.abs(mx) + 4) { active = false; return; } // vertical scroll wins
        if (Math.abs(mx) < 8) return;
        decided = true;
        row.classList.add("task-row--swiping");
        try { row.setPointerCapture(pid); } catch (err) {}
      }
      // damping the further you go — a rubber band, not a wall
      var raw = mx;
      dx = Math.abs(raw) > SW_THRESH
        ? Math.sign(raw) * (SW_THRESH + (Math.abs(raw) - SW_THRESH) * 0.35)
        : raw;
      paint();
      e.preventDefault();
    }, { passive: false });
    function finish(e) {
      if (!active || (pid != null && e.pointerId !== pid)) return;
      if (!decided) { active = false; return; }
      var dt = Math.max(1, Date.now() - t0);
      var velocity = Math.abs(dx) / dt;                  // px per ms
      var commit = Math.abs(dx) >= SW_THRESH || velocity > 0.11;  // a flick is enough
      if (!commit) { reset(true, velocity); return; }
      var completing = dx > 0;
      reset(false);
      if (completing) {
        chk.checked = !x.done;
        chk.dispatchEvent(new Event("change"));
      } else {
        window.FX.haptic("warn");
        removeTask(x.id);
      }
    }
    row.addEventListener("pointerup", finish);
    row.addEventListener("pointercancel", function () { if (active) reset(true, 0); });
  }

  function dueLabel(due) {
    var CS = window.CalSys;
    var d = CS.jToDisp(due);
    return ctx.num(d.d) + " " + CS.monthName(d.m) + " " + ctx.num(d.y);
  }

  // v1.16 (فاز F مورد ۳۴): an Event is a task record with kind:"event".
  // Sharing the record keeps drag, reminders/push slots, [[links]], colours
  // and the calendar renderers working for events at zero cost; the only
  // differences are behavioural — an event is never "done" and never counts
  // in progress or overdue stats. Records without `kind` are tasks (so every
  // existing vault keeps working untouched).
  function isEvent(x) { return x && x.kind === "event"; }

  // ---- filtering / sorting ---------------------------------------------------
  function visible() {
    var q = filters.q.trim().toLowerCase();
    var tj = todayJ();
    return tasks().filter(function (x) {
      if (filters.scope === "today") {
        if (!x.due || x.due.jy !== tj.jy || x.due.jm !== tj.jm || x.due.jd !== tj.jd) return false;
      }
      if (filters.kind === "task" && isEvent(x)) return false;
      if (filters.kind === "event" && !isEvent(x)) return false;
      if (!isEvent(x)) {                       // events are never done/undone
        if (filters.status === "open" && x.done) return false;
        if (filters.status === "done" && !x.done) return false;
      } else if (filters.status === "done") return false;
      if (filters.cat !== "all" && x.cat !== filters.cat) return false;
      if (filters.pr !== "all" && x.pr !== filters.pr) return false;
      if (filters.hz !== "all" && x.hz !== filters.hz) return false;
      if (q) {
        var hay = (x.title + " " + (x.notes || "") + " " + (x.tags || []).join(" ")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      var ad = a.due ? dueToDate(a.due).getTime() : Infinity;
      var bd = b.due ? dueToDate(b.due).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return (PR_ORDER[a.pr] || 1) - (PR_ORDER[b.pr] || 1);
    });
  }

  // ---- filter bar -----------------------------------------------------------
  function sel(options, current, onChange) {
    var s = el("select", "tsel");
    options.forEach(function (o) {
      var op = el("option", null, o.label);
      op.value = o.val;
      if (o.val === current) op.selected = true;
      s.appendChild(op);
    });
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }
  function filterBar() {
    var bar = el("div", "filters");
    bar.appendChild(sel(
      [{ val: "all", label: t("sc_all") }, { val: "today", label: t("sc_today") }],
      filters.scope, function (v) { filters.scope = v; ctx.rerender(); }));
    bar.appendChild(sel(
      [{ val: "open", label: t("f_open") }, { val: "done", label: t("f_done") }, { val: "all", label: t("f_all") }],
      filters.status, function (v) { filters.status = v; ctx.rerender(); }));
    bar.appendChild(sel(
      [{ val: "all", label: t("k_all") }, { val: "task", label: t("k_tasks") },
       { val: "event", label: t("k_events") }],
      filters.kind, function (v) { filters.kind = v; ctx.rerender(); }));
    bar.appendChild(sel(
      [{ val: "all", label: t("task_category") + ": " + t("f_all") }].concat(CATS.map(function (c) {
        return { val: c, label: t("cat_" + c) };
      })), filters.cat, function (v) { filters.cat = v; ctx.rerender(); }));
    bar.appendChild(sel(
      [{ val: "all", label: t("task_priority") + ": " + t("f_all") }].concat(PRS.map(function (p) {
        return { val: p, label: t("pr_" + p) };
      })), filters.pr, function (v) { filters.pr = v; ctx.rerender(); }));
    bar.appendChild(sel(
      [{ val: "all", label: t("task_horizon") + ": " + t("f_all") }].concat(HZS.map(function (h) {
        return { val: h, label: t("hz_" + h) };
      })), filters.hz, function (v) { filters.hz = v; ctx.rerender(); }));
    var q = el("input", "tsearch");
    q.type = "search"; q.placeholder = t("f_search"); q.value = filters.q;
    q.addEventListener("input", function () { filters.q = q.value; renderList(); });
    bar.appendChild(q);
    return bar;
  }

  // ---- list -----------------------------------------------------------------
  // v1.16 (فاز F مورد ۳۳): selection mode. Nothing is destroyed silently —
  // bulk delete goes through the same trash as single delete, and bulk
  // archive uses the existing archive array, so both stay undoable/restorable.
  var listHost = null;
  var selMode = false;
  var selIds = {};
  function selCount() { return Object.keys(selIds).length; }
  function clearSel() { selIds = {}; }
  function selBar() {
    var bar = el("div", "selbar");
    // v3.8: the enter/exit toggle moved into the toolbar "more" menu, so this
    // bar shows nothing until selection mode is actually on.
    if (!selMode) return bar;

    var exit = el("button", "btn btn--ghost btn--sm", t("sel_exit"));
    exit.addEventListener("click", function () {
      selMode = false; clearSel(); ctx.rerender();
    });
    bar.appendChild(exit);

    var n = selCount();
    bar.appendChild(el("span", "selbar__count", ctx.num(n) + " " + t("sel_selected")));
    var all = el("button", "btn btn--ghost btn--sm", t("sel_all"));
    all.addEventListener("click", function () {
      var items = visible();
      if (selCount() >= items.length) clearSel();
      else items.forEach(function (x) { selIds[x.id] = true; });
      ctx.rerender();
    });
    bar.appendChild(all);

    var arch = el("button", "btn btn--ghost btn--sm", t("sel_archive"));
    arch.disabled = !n;
    arch.addEventListener("click", async function () {
      if (!(await ctx.UI.confirm({ body: t("sel_confirmArchive") }))) return;
      if (!ctx.S.vault.archive) ctx.S.vault.archive = [];
      var picked = tasks().filter(function (x) { return selIds[x.id]; });
      picked.forEach(function (x) { x.archived = true; ctx.S.vault.archive.push(x); });
      ctx.S.vault.tasks = tasks().filter(function (x) { return !selIds[x.id]; });
      clearSel();
      ctx.status("sel_archived", "success"); ctx.rerender(); ctx.persistBg();
    });
    bar.appendChild(arch);

    var del = el("button", "btn btn--ghost btn--sm btn--danger", t("sel_delete"));
    del.disabled = !n;
    del.addEventListener("click", async function () {
      if (!(await ctx.UI.confirm({ body: t("sel_confirmDelete"), danger: true }))) return;
      tasks().forEach(function (x) { if (selIds[x.id]) ctx.S.trashPut("task", x); });
      ctx.S.vault.tasks = tasks().filter(function (x) { return !selIds[x.id]; });
      clearSel();
      ctx.status("msg_trashed", "success"); ctx.rerender(); ctx.persistBg();
    });
    bar.appendChild(del);
    return bar;
  }
  /* v5.6 — keyed reconciliation.
   *
   * This used to wipe the list (`textContent = ""`) and rebuild every row on
   * every change, so ticking one checkbox reconstructed the whole page.
   * Measured on a desktop CPU: 51 ms at 100 rows, 160 ms at 300, 261 ms at
   * 1000 — and a mid-range phone is 4–6x slower, so a 300-task list cost
   * roughly a second of stutter for one tap.
   *
   * Now the DOM is diffed against the wanted list by task id: rows that are
   * gone get removed, rows whose signature is unchanged are left completely
   * alone, and only genuinely-changed rows are rebuilt. The common case — tick
   * a box, edit one task — touches exactly one row.
   *
   * Order is fixed by walking the wanted list and inserting only when a node
   * is not already in the right place, so a reorder moves the few nodes that
   * actually moved rather than all of them. */
  function renderList() {
    if (!listHost) return;
    var items = visible();

    if (!items.length) {
      listHost.textContent = "";
      listHost.appendChild(el("p", "panel__text", t("task_empty")));
      return;
    }

    // index what is currently on screen
    var existing = Object.create(null);
    var kids = listHost.children, i;
    for (i = 0; i < kids.length; i++) {
      var id = kids[i].getAttribute && kids[i].getAttribute("data-task-id");
      if (id) existing[id] = kids[i];
      else kids[i].setAttribute && kids[i].setAttribute("data-stale", "1");
    }
    // drop anything not in the wanted set (including the empty-state <p>)
    var wanted = Object.create(null);
    items.forEach(function (x) { wanted[x.id] = true; });
    for (i = listHost.children.length - 1; i >= 0; i--) {
      var n = listHost.children[i];
      var nid = n.getAttribute && n.getAttribute("data-task-id");
      if (!nid || !wanted[nid]) listHost.removeChild(n);
    }

    var prev = null;
    items.forEach(function (x) {
      var node = existing[x.id];
      if (node && node.parentNode === listHost &&
          node.getAttribute("data-sig") === rowSig(x)) {
        // identical to what is already painted — leave it untouched
      } else {
        var fresh = row(x);
        if (node && node.parentNode === listHost) listHost.replaceChild(fresh, node);
        node = fresh;
      }
      var slot = prev ? prev.nextSibling : listHost.firstChild;
      if (node !== slot) listHost.insertBefore(node, slot);
      prev = node;
    });
  }
  function badge(cls, text) { return el("span", "badge " + (cls || ""), text); }

  function row(x) {
    // priority is expressed by the row's own edge colour, so a list can be
    // read at a glance without parsing badges (semantic colour, v1.8.1)
    var r = el("div", "task-row " + window.TaskColor.cls(x.color) +
      " task-row--pr-" + (x.pr || "normal") +
      (x.done ? " task-row--done" : ""));
    if (window.TaskColor.isCustom(x.color)) r.style.setProperty("--tc", x.color);

    if (selMode) {
      var sc = el("input"); sc.type = "checkbox";
      sc.className = "task-check task-check--sel"; sc.checked = !!selIds[x.id];
      sc.addEventListener("change", function () {
        if (sc.checked) selIds[x.id] = true; else delete selIds[x.id];
        var b = document.querySelector(".selbar");
        if (b) b.replaceWith(selBar());
      });
      r.appendChild(sc);
      r.classList.add("task-row--selectable");
    }
    if (isEvent(x)) {
      r.classList.add("task-row--event");
      var evIc = el("span", "task-evic");
      evIc.appendChild(ctx.icn("calendar"));
      evIc.title = t("k_event");
      r.appendChild(evIc);
    }
    var chk = el("input");
    chk.type = "checkbox"; chk.className = "task-check"; chk.checked = !!x.done;
    chk.addEventListener("change", function () {
      if (chk.checked) {
        chk.classList.remove("task-check--pop");
        void chk.offsetWidth;              // restart the spring
        chk.classList.add("task-check--pop");
        r.classList.add("task-row--justdone");   // strike-through sweeps in
        window.FX.haptic("tick");
      } else {
        r.classList.remove("task-row--justdone");
        window.FX.haptic("soft");
      }
      toggleDone(x.id, chk.checked, chk);
    });
    if (!isEvent(x)) { r.appendChild(chk); attachSwipe(r, x, chk); }

    var mid = el("div", "task-mid");
    mid.appendChild(el("div", "task-title", x.title));

    var meta = el("div", "task-meta");
    if (x.timeFrom) {
      meta.appendChild(badge("badge--time",
        ctx.num(x.timeFrom) + (x.timeTo ? "–" + ctx.num(x.timeTo) : "")));
    }
    if (isEvent(x)) meta.appendChild(badge("badge--event", t("k_event")));
    meta.appendChild(badge("badge--cat", t("cat_" + x.cat)));
    if (x.pr === "high") meta.appendChild(badge("badge--high", t("pr_high")));
    else if (x.pr === "low") meta.appendChild(badge("badge--low", t("pr_low")));
    meta.appendChild(badge("badge--hz", t("hz_" + x.hz)));
    if (x.rep && x.rep !== "none") meta.appendChild(badge("badge--rep", "↻ " + t("rep_" + x.rep)));
    if (x.link) {
      var la = ctx.elIc("a", "badge badge--link", "link", t("task_linkShort"));
      la.href = x.link; la.target = "_blank"; la.rel = "noopener noreferrer";
      meta.appendChild(la);
    }
    (x.tags || []).forEach(function (tag) { meta.appendChild(badge("badge--tag", "#" + tag)); });
    if (x.goalId) {
      var gg = (ctx.S.vault.goals || []).find(function (G) { return G.id === x.goalId; });
      if (gg) meta.appendChild(badge("badge--goal", gg.title));
    }

    if (x.due) {
      var d = daysUntil(x.due);
      if (!x.done && d < 0) meta.appendChild(badge("badge--over", t("overdue") + " · " + dueLabel(x.due)));
      else if (!x.done && d === 0) meta.appendChild(badge("badge--today", t("dueToday")));
      else meta.appendChild(badge("badge--due", dueLabel(x.due)));
      if (x.cat === "exam" && !x.done && d > 0) {
        meta.appendChild(badge("badge--exam", ctx.num(d) + " " + t("daysLeft")));
      }
    }
    mid.appendChild(meta);
    if (x.subs && x.subs.length) {
      var doneN = x.subs.filter(function (s) { return s.done; }).length;
      meta.appendChild(badge("badge--subs", ctx.num(doneN) + "/" + ctx.num(x.subs.length)));
      var subBox = el("div", "task-subs");
      x.subs.forEach(function (sub) {
        var line = el("label", "task-sub" + (sub.done ? " task-sub--done" : ""));
        var c = el("input"); c.type = "checkbox"; c.className = "task-check task-check--sm";
        c.checked = !!sub.done;
        c.addEventListener("change", async function () {
          sub.done = c.checked;
          refresh(); ctx.persistBg();
        });
        line.appendChild(c);
        line.appendChild(el("span", null, sub.text));
        subBox.appendChild(line);
      });
      mid.appendChild(subBox);
    }
    if (x.notes) mid.appendChild(window.Links.decorate(el("div", "task-notes", x.notes)));
    r.appendChild(mid);

    var act = el("div", "task-actions");
    var ed = el("button", "btn btn--ghost btn--sm", t("edit"));
    ed.addEventListener("click", function () { openEditor(x.id); });
    var del = el("button", "btn btn--ghost btn--sm btn--danger", t("delete"));
    del.addEventListener("click", function () { removeTask(x.id); });
    act.appendChild(ed); act.appendChild(del);
    r.appendChild(act);
    r.setAttribute("data-task-id", x.id);
    r.setAttribute("data-sig", rowSig(x));
    return r;
  }

  /* v5.6 — a fingerprint of everything this row DISPLAYS.
   *
   * Reconciliation needs to know when a row's visible content actually
   * changed. Comparing whole task objects would rebuild on edits nobody can
   * see (a touched timestamp, an internal id), and comparing nothing would
   * leave stale rows on screen. So the signature lists exactly the fields the
   * row renders — add a field to row(), add it here. */
  function rowSig(x) {
    return [
      x.title, x.done ? 1 : 0, x.pr || "", x.color || "", x.cat || "",
      x.hz || "", x.kind || "", x.rep || "",
      x.due ? x.due.jy + "-" + x.due.jm + "-" + x.due.jd : "",
      x.timeFrom || "", x.timeTo || "",
      (x.tags || []).join(","),
      (x.subs || []).map(function (sb) { return (sb.done ? 1 : 0) + sb.text; }).join("|"),
      x.notes ? "1" : "0",
      selMode ? (selIds[x.id] ? "s1" : "s0") : "",
    ].join("\u0001");
  }

  // ---- mutations --------------------------------------------------------------
  // Partial render: if the task list is on screen, only rebuild it instead of
  // the whole route. Big win once there are hundreds of tasks.
  function refresh() {
    if (listHost && document.contains(listHost)) renderList();
    else ctx.rerender();
  }
  function nextDue(due, rep) {
    var g = ctx.J.toGregorian(due.jy, due.jm, due.jd);
    var d = new Date(g.gy, g.gm - 1, g.gd);
    d.setDate(d.getDate() + (rep === "weekly" ? 7 : 1));
    var j = ctx.J.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return { jy: j.jy, jm: j.jm, jd: j.jd };
  }

  // Materialize upcoming occurrences of a recurring task as independent tasks
  // sharing a seriesId, so a daily/weekly task actually fills the calendar.
  // Horizon: daily → 30 days, weekly → 8 weeks. Deduplicates by seriesId+date.
  function materializeSeries(base) {
    if (!base.seriesId) base.seriesId = "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var sid = base.seriesId;
    var step = base.rep === "weekly" ? 7 : 1;
    var horizon = base.rep === "weekly" ? 56 : 30;
    var existing = {};
    tasks().forEach(function (x) {
      if (x.seriesId === sid && x.due) existing[x.due.jy + "-" + x.due.jm + "-" + x.due.jd] = true;
    });
    var g = ctx.J.toGregorian(base.due.jy, base.due.jm, base.due.jd);
    var cursor = new Date(g.gy, g.gm - 1, g.gd);
    var end = new Date(g.gy, g.gm - 1, g.gd); end.setDate(end.getDate() + horizon);
    var guard = 0;
    while (cursor <= end && guard < 400) {
      guard++;
      var j = ctx.J.toJalaali(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
      var key = j.jy + "-" + j.jm + "-" + j.jd;
      if (!existing[key]) {
        existing[key] = true;
        tasks().push({
          id: "t_" + Date.now().toString(36) + guard + Math.random().toString(36).slice(2, 6),
          title: base.title, notes: base.notes, cat: base.cat, pr: base.pr, hz: base.hz,
          tags: (base.tags || []).slice(), rep: base.rep, seriesId: sid,
          link: base.link || "", timeFrom: base.timeFrom || "", timeTo: base.timeTo || "",
          color: base.color || "c0", goalId: base.goalId || "",
          subs: (base.subs || []).map(function (s) { return { text: s.text, done: false }; }),
          due: { jy: j.jy, jm: j.jm, jd: j.jd },
          done: false, createdAt: new Date().toISOString(), doneAt: null,
        });
      }
      cursor.setDate(cursor.getDate() + step);
    }
  }

  // Was this the last open task due today? (checked BEFORE the refresh wipes
  // the DOM, so the confetti can burst from the checkbox the user just hit.)
  function lastOpenOfToday(justDone) {
    var tj = todayJ();
    if (!justDone.due || justDone.due.jy !== tj.jy || justDone.due.jm !== tj.jm ||
        justDone.due.jd !== tj.jd) return false;
    return !tasks().some(function (i) {
      return !i.done && i.id !== justDone.id && i.due &&
        i.due.jy === tj.jy && i.due.jm === tj.jm && i.due.jd === tj.jd;
    });
  }

  async function toggleDone(id, done, srcEl) {
    var x = tasks().find(function (i) { return i.id === id; });
    if (!x) return;
    var celebrate = done && lastOpenOfToday(x);
    x.done = done;
    x.doneAt = done ? new Date().toISOString() : null;
    // extend a materialized series so it never runs out ahead of you
    if (done && x.rep && x.rep !== "none" && x.due && x.seriesId) {
      materializeSeries(x);
    } else if (done && x.rep && x.rep !== "none" && x.due) {
      var copy = Object.assign({}, x, {
        id: "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        done: false, doneAt: null,
        createdAt: new Date().toISOString(),
        due: nextDue(x.due, x.rep),
        subs: (x.subs || []).map(function (s) { return { text: s.text, done: false }; }),
      });
      tasks().push(copy);
    }
    // v3.1: the reward lands with the tap, not with the network. Ticking a
    // task is the most-repeated action in the app; making it wait for the
    // save debounce plus a round trip made the whole product feel sluggish.
    ctx.persistBg();
    ctx.status("msg_saved", "success");
    if (celebrate) {
      window.FX.confetti(srcEl);
      window.FX.haptic("heavy");
      ctx.UI.toast(t("fx_dayCleared"), { kind: "success" });
    }
    // let the strike-through play out before the list re-renders
    setTimeout(refresh, window.FX.reduced() ? 0 : 320);
  }
  async function removeTask(id) {
    var x = tasks().find(function (i) { return i.id === id; });
    if (!x) return;
    var idx = tasks().indexOf(x);
    window.FX.haptic("warn");
    ctx.S.trashPut("task", x);
    ctx.S.vault.tasks = tasks().filter(function (i) { return i.id !== id; });
    // v5.5 — remove it from the list now; the write follows. The undo toast
    // still works because undo operates on the vault, not on the response.
    ctx.persistBg();
    {
      refresh();
      ctx.UI.toast(t("msg_trashed"), {
        undo: async function () {
          // pull it back out of trash and restore its position
          var tr = ctx.S.vault.trash || [];
          for (var k = tr.length - 1; k >= 0; k--) {
            if (tr[k].kind === "task" && tr[k].item && tr[k].item.id === x.id) {
              tr.splice(k, 1); break;
            }
          }
          tasks().splice(Math.min(idx, tasks().length), 0, x);
          ctx.status("tr_restored", "success"); refresh(); ctx.persistBg();
        },
      });
    }
  }

  // ---- editor overlay -----------------------------------------------------------
  function field(labelKey, control) {
    var f = el("div", "field");
    f.appendChild(el("label", null, t(labelKey)));
    f.appendChild(control);
    return f;
  }
  function dueSelects(due) {
    // The picker works in the DISPLAY calendar (Jalali or Gregorian per the
    // Settings choice) while getDue()/setDue() keep the vault's Jalali shape.
    var CS = window.CalSys;
    var wrap = el("div", "due-row");
    var td = CS.fromDate(new Date());
    var cur = due ? CS.jToDisp(due) : null;
    var ySel = el("select", "tsel"), mSel = el("select", "tsel"), dSel = el("select", "tsel");

    function opt(s, val, label, selected) {
      var o = el("option", null, label); o.value = String(val);
      if (selected) o.selected = true; s.appendChild(o);
    }
    opt(ySel, "", t("noDue"), !cur);
    /* v6.5 — the year list used to run six years ahead, so the picker offered
     * dates nobody plans a task for and a tester called it out by name. A
     * planner's horizon is this year and the next; last year stays because a
     * task can be dated into the past when you are catching up. Anything
     * further out is not planning, and making it easy to pick was noise. */
    for (var y = td.y - 1; y <= td.y + 1; y++) opt(ySel, y, ctx.num(y), cur && cur.y === y);
    // an existing task dated outside that window keeps its own year in the list
    if (cur && (cur.y < td.y - 1 || cur.y > td.y + 1)) {
      opt(ySel, cur.y, ctx.num(cur.y), true);
    }
    CS.monthNames().forEach(function (m, i) { opt(mSel, i + 1, m, cur && cur.m === i + 1); });

    function fillDays() {
      dSel.textContent = "";
      var yy = parseInt(ySel.value, 10), mm = parseInt(mSel.value, 10);
      var len = ySel.value ? CS.monthLength(yy, mm) : 31;
      for (var d = 1; d <= len; d++) opt(dSel, d, ctx.num(d), cur && cur.d === d);
    }
    fillDays();
    ySel.addEventListener("change", fillDays);
    mSel.addEventListener("change", fillDays);

    wrap.appendChild(ySel); wrap.appendChild(mSel); wrap.appendChild(dSel);
    wrap.getDue = function () {
      if (!ySel.value) return null;
      return CS.dispToJ({
        y: parseInt(ySel.value, 10), m: parseInt(mSel.value, 10), d: parseInt(dSel.value, 10),
      });
    };
    wrap.setDue = function (j) {
      if (!j) { cur = null; ySel.value = ""; fillDays(); return; }
      cur = CS.jToDisp(j);
      var has = false;
      for (var i = 0; i < ySel.options.length; i++) if (+ySel.options[i].value === cur.y) has = true;
      if (!has) opt(ySel, cur.y, ctx.num(cur.y), false);
      ySel.value = String(cur.y);
      mSel.value = String(cur.m);
      fillDays();
      dSel.value = String(cur.d);
    };
    return wrap;
  }

  // snooze helper: today / tomorrow / +1 week as jalali date
  function offsetJ(days) {
    var n = new Date(); n.setHours(0, 0, 0, 0);
    n.setDate(n.getDate() + days);
    var j = ctx.J.toJalaali(n.getFullYear(), n.getMonth() + 1, n.getDate());
    return { jy: j.jy, jm: j.jm, jd: j.jd };
  }

  function openEditor(id, presetDue, preset) {
    editingId = id || null;
    var x = id ? tasks().find(function (i) { return i.id === id; }) : null;
    if (!x && preset) {
      // seed a brand-new task from a saved template (not yet persisted)
      x = {
        title: preset.title || "", notes: preset.notes || "",
        cat: preset.cat || "personal", pr: preset.pr || "normal",
        hz: preset.hz || "short", color: preset.color || "c0",
        tags: preset.tags || [], rep: "none",
        timeFrom: preset.timeFrom || "", timeTo: preset.timeTo || "",
        subs: (preset.subs || []).map(function (txt) { return { text: txt, done: false }; }),
        due: presetDue || null,
      };
    }

    var ov = el("div", "overlay"); ov.id = "task-editor";
    var card = el("div", "overlay__card");
    card.appendChild(el("h2", "panel__title", id ? t("editTask") : t("task_new")));

    var title = el("input"); title.type = "text"; title.value = x ? x.title : "";
    var notes = el("textarea"); notes.rows = 3; notes.value = x ? (x.notes || "") : "";
    window.Links.attachTextarea(notes);   // "[[" autocompletes to items (v1.13)
    var cat = sel(CATS.map(function (c) { return { val: c, label: t("cat_" + c) }; }),
      x ? x.cat : "personal", function () {});
    var pr = sel(PRS.map(function (p) { return { val: p, label: t("pr_" + p) }; }),
      x ? x.pr : "normal", function () {});
    var hz = sel(HZS.map(function (h) { return { val: h, label: t("hz_" + h) }; }),
      x ? x.hz : "short", function () {});

    /* v5.3 (فاز N2) — how long you THINK this will take, in minutes.
     *
     * Optional on purpose: forcing an estimate on every task would make the
     * form heavier for the majority of tasks that don't need one, and a
     * number typed to get past a required field is worse than no number.
     * It exists so the «تخمین در برابر واقعیت» report has something honest to
     * compare against later — which also means it can only ever describe tasks
     * created from today onward. */
    var est = el("input");
    est.type = "number"; est.min = "0"; est.max = "10000"; est.step = "5";
    est.setAttribute("inputmode", "numeric");
    est.placeholder = t("tk_estPh");
    est.value = (x && x.est) ? String(x.est) : "";
    var rep = sel([
      { val: "none", label: t("rep_none") },
      { val: "daily", label: t("rep_daily") },
      { val: "weekly", label: t("rep_weekly") },
    ], x ? (x.rep || "none") : "none", function () {});
    var tags = el("input"); tags.type = "text"; tags.value = x ? (x.tags || []).join(", ") : "";
    tags.setAttribute("dir", "auto");
    var due = dueSelects(x ? x.due : (presetDue || null));

    // v1.16 (فاز F مورد ۳۴): task ⇄ event switch. Switching an existing
    // record keeps everything else (time, colour, notes, links) intact.
    var kindWrap = el("div", "seg");
    var kindVal = x ? (x.kind === "event" ? "event" : "task") : (preset && preset.kind) || "task";
    [["task", "k_task"], ["event", "k_event"]].forEach(function (o) {
      var b = el("button", "seg__btn" + (kindVal === o[0] ? " active" : ""), t(o[1]));
      b.type = "button";
      b.addEventListener("click", function () {
        kindVal = o[0];
        kindWrap.querySelectorAll(".seg__btn").forEach(function (n, i) {
          n.classList.toggle("active", (i === 0) === (kindVal === "task"));
        });
      });
      kindWrap.appendChild(b);
    });
    card.appendChild(field("k_label", kindWrap));
    card.appendChild(field("task_title", title));

    /* v3.8.1 — progressive disclosure, the same principle the tasks page got
     * in v3.8.0. Fourteen fields were always open and full height, so a task
     * that only needs a title and a date still looked like a form to fill in.
     * The essentials (kind, title, date, time, priority) stay visible;
     * everything else waits inside a collapsed "more details" section.
     * Nothing is removed and no field changes shape — only where it sits
     * until you ask for it. */
    var moreBody = el("div", "editor-more__body");

    var dueField = field("task_due", due);
    card.appendChild(dueField);

    // Optional end date — Google-Calendar semantics: one "Date" that expands
    // into "Start → To" when the user adds an end, and collapses back when
    // they remove it (the old form could show the end but never hide it).
    var dueEnd = dueSelects(x && x.dueEnd ? x.dueEnd : null);
    var endWrap = el("div", "field-collapsible");
    var endToggle = el("button", "btn btn--ghost btn--sm", "＋ " + t("task_multiday"));
    endToggle.type = "button";
    var endShown = !!(x && x.dueEnd);
    var endField = field("task_dueEnd", dueEnd);
    var dueLabel = dueField.querySelector("label");
    var endRemove = el("button", "btn btn--ghost btn--sm field-collapsible__x", "×");
    endRemove.type = "button";
    endRemove.title = t("task_endRemove");
    endRemove.setAttribute("aria-label", t("task_endRemove"));
    endField.appendChild(endRemove);
    function syncEndUI() {
      endField.style.display = endShown ? "" : "none";
      endToggle.style.display = endShown ? "none" : "";
      if (dueLabel) dueLabel.textContent = t(endShown ? "task_dueStart" : "task_due");
    }
    endToggle.addEventListener("click", function () { endShown = true; syncEndUI(); });
    endRemove.addEventListener("click", function () { endShown = false; syncEndUI(); });
    syncEndUI();
    endWrap.appendChild(endToggle);
    endWrap.appendChild(endField);
    card.appendChild(endWrap);

    var snooze = el("div", "snooze-row");
    [["sn_today", 0], ["sn_tmrw", 1], ["sn_nextWeek", 7]].forEach(function (o) {
      var b = el("button", "btn btn--ghost btn--sm", t(o[0]));
      b.type = "button";
      b.addEventListener("click", function () { due.setDue(offsetJ(o[1])); });
      snooze.appendChild(b);
    });
    card.appendChild(snooze);

    // link this task to a goal (progress then counts real work)
    var goalsList = (ctx.S.vault.goals || []);
    var goalSel = el("select", "tsel");
    var g0 = el("option", null, t("g_link_none")); g0.value = ""; goalSel.appendChild(g0);
    goalsList.forEach(function (G) {
      var o = el("option", null, G.title); o.value = G.id;
      if (x && x.goalId === G.id) o.selected = true;
      goalSel.appendChild(o);
    });
    if (goalsList.length) moreBody.appendChild(field("g_link", goalSel));

    var tf = el("input"); tf.type = "time"; tf.value = x ? (x.timeFrom || "") : "";
    var tt2 = el("input"); tt2.type = "time"; tt2.value = x ? (x.timeTo || "") : "";
    var trow = el("div", "time-row");
    trow.appendChild(tf);
    trow.appendChild(el("span", "time-sep", t("time_to")));
    trow.appendChild(tt2);
    card.appendChild(field("task_time", trow));
    card.appendChild(field("task_priority", pr));

    var COLORS = ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"];
    var curColor = x ? (x.color || "c0") : "c0";
    var crow = el("div", "color-row");
    function markActive() {
      crow.querySelectorAll(".color-dot").forEach(function (d, i) {
        d.classList.toggle("active", i < COLORS.length
          ? COLORS[i] === curColor
          : window.TaskColor.isCustom(curColor));
      });
    }
    COLORS.forEach(function (cc) {
      var b = el("button", "color-dot task-" + cc + (curColor === cc ? " active" : ""));
      b.type = "button";
      b.addEventListener("click", function () { curColor = cc; markActive(); });
      crow.appendChild(b);
    });
    // 9th dot: any color the user wants (تلگرام-style custom color).
    // The dot itself is the label for a native color input, so the OS picker
    // opens with zero extra UI. A picked custom color paints the dot.
    var custom = el("button", "color-dot color-dot--custom" +
      (window.TaskColor.isCustom(curColor) ? " active" : ""));
    custom.type = "button";
    custom.title = t("task_colorCustom");
    if (window.TaskColor.isCustom(curColor)) custom.style.setProperty("--tc", curColor);
    var cInput = el("input", "color-input-hidden");
    cInput.type = "color";
    cInput.value = window.TaskColor.isCustom(curColor) ? curColor : "#4f8cff";
    cInput.addEventListener("input", function () {
      curColor = cInput.value;
      custom.style.setProperty("--tc", curColor);
      markActive();
    });
    custom.addEventListener("click", function () { cInput.click(); });
    crow.appendChild(custom);
    crow.appendChild(cInput);
    moreBody.appendChild(field("task_color", crow));

    var link = el("input");
    link.type = "url"; link.setAttribute("dir", "ltr");
    link.placeholder = "https://"; link.autocomplete = "off";
    link.value = x ? (x.link || "") : "";
    moreBody.appendChild(field("task_link", link));
    moreBody.appendChild(field("task_tags", tags));
    moreBody.appendChild(field("task_notes", notes));
    if (x && x.id) {
      var blp = window.Links.backlinksPanel("task", x.id, function () { ov.remove(); editingId = null; });
      if (blp) moreBody.appendChild(blp);
    }
    var subs = el("textarea"); subs.rows = 3;
    subs.placeholder = t("task_subsHint");
    subs.value = x ? (x.subs || []).map(function (s) { return s.text; }).join("\n") : "";
    moreBody.appendChild(field("task_subs", subs));

    // the disclosure control: closed by default for a new task, open when
    // editing a task that already uses one of the advanced fields — so an
    // existing note or tag is never hidden behind a click the user has to
    // discover.
    var moreWrap = el("div", "editor-more");
    var moreOpen = !!(x && (x.notes || (x.tags || []).length || x.link ||
                            (x.subs || []).length || x.goalId ||
                            (x.color && x.color !== "c0") ||
                            (x.cat && x.cat !== "personal") ||
                            (x.hz && x.hz !== "short") ||
                            (x.rep && x.rep !== "none")));
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
    // category / horizon / repeat live here too — useful, but not every time
    moreBody.insertBefore(field("task_repeat", rep), moreBody.firstChild);
    moreBody.insertBefore(field("tk_est", est), moreBody.firstChild);
    moreBody.insertBefore(field("task_horizon", hz), moreBody.firstChild);
    moreBody.insertBefore(field("task_category", cat), moreBody.firstChild);
    syncMore();
    moreWrap.appendChild(moreBtn);
    moreWrap.appendChild(moreBody);
    card.appendChild(moreWrap);

    var actions = el("div", "overlay__actions");
    var tpl = el("button", "btn btn--ghost btn--sm", t("tpl_save"));
    tpl.addEventListener("click", async function () {
      var ti = title.value.trim();
      if (!ti) { title.focus(); return; }
      if (!ctx.S.vault.templates) ctx.S.vault.templates = [];
      ctx.S.vault.templates.push({
        id: "tpl_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: ti, cat: cat.value, pr: pr.value, hz: hz.value, color: curColor,
        notes: notes.value.trim(),
        tags: tags.value.split(/[,،]/).map(function (s) { return s.trim(); }).filter(Boolean),
        subs: subs.value.split("\n").map(function (l) { return l.trim(); }).filter(Boolean),
        timeFrom: tf.value || "", timeTo: tt2.value || "",
      });
      ctx.status("tpl_saved", "success"); ctx.persistBg();
    });
    var cancel = el("button", "btn btn--ghost btn--sm", t("cancel"));
    cancel.addEventListener("click", close);
    var save = el("button", "btn btn--primary btn--sm", t("save"));
    save.addEventListener("click", async function () {
      var ti = title.value.trim();
      if (!ti) { title.focus(); return; }
      var data = {
        title: ti,
        notes: notes.value.trim(),
        cat: cat.value,
        pr: pr.value,
        hz: hz.value,
        tags: tags.value.split(/[,،]/).map(function (s) { return s.trim(); }).filter(Boolean),
        due: due.getDue(),
        dueEnd: (function () {
          if (!endShown) return null;
          var s = due.getDue(), e = dueEnd.getDue();
          if (!s || !e) return null;
          var sg = ctx.J.toGregorian(s.jy, s.jm, s.jd), eg = ctx.J.toGregorian(e.jy, e.jm, e.jd);
          var sd = new Date(sg.gy, sg.gm - 1, sg.gd), ed = new Date(eg.gy, eg.gm - 1, eg.gd);
          return ed > sd ? e : null;   // GCal-style: inverted/equal span collapses to one day
        })(),
        rep: rep.value,
        link: /^https?:\/\//i.test(link.value.trim()) ? link.value.trim() : "",
        timeFrom: tf.value || "",
        timeTo: tt2.value || "",
        color: curColor,
        goalId: (goalsList.length && goalSel.value) ? goalSel.value : "",
        kind: kindVal === "event" ? "event" : "task",
        est: (function () {
          var v = parseInt(est.value, 10);
          return (isFinite(v) && v > 0) ? v : null;
        })(),
      };
      if (data.kind === "event") data.done = false;   // events are never "done"
      // A recurring task needs an anchor date to appear on the calendar. If the
      // user picked "repeat" but no date, default to today so daily/weekly
      // tasks actually show up instead of silently going nowhere (B3).
      if (data.rep && data.rep !== "none" && !data.due) data.due = todayJ();
      var oldSubs = (editingId && x && x.subs) ? x.subs : [];
      data.subs = subs.value.split("\n").map(function (l) { return l.trim(); })
        .filter(Boolean).map(function (text) {
          var prev = oldSubs.find(function (o) { return o.text === text; });
          return { text: text, done: prev ? !!prev.done : false };
        });
      if (editingId) {
        var cur = tasks().find(function (i) { return i.id === editingId; });
        /* v5.3 (فاز N2) — count how often a task gets pushed to another day.
         *
         * A task that keeps sliding forward is the signal the «کارهای فراری»
         * report is looking for: it usually means the task is too big, or it
         * was never really going to happen. Only a genuine change of DAY
         * counts — editing the title, or re-saving with the same date, is not
         * a reschedule and must not inflate the number. Setting a date for the
         * first time isn't one either; that is planning, not slipping. */
        if (cur) {
          var a = cur.due, b = data.due;
          if (a && b && (a.jy !== b.jy || a.jm !== b.jm || a.jd !== b.jd)) {
            cur.moves = (cur.moves || 0) + 1;
            cur.movedAt = new Date().toISOString();
          }
          Object.assign(cur, data);
        }
        if (cur && cur.rep && cur.rep !== "none" && cur.due) materializeSeries(cur);
      } else {
        var created = Object.assign({
          id: "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          done: false, createdAt: new Date().toISOString(), doneAt: null,
        }, data);
        tasks().push(created);
        if (created.rep && created.rep !== "none" && created.due) materializeSeries(created);
      }
      close();
      ctx.status("msg_saved", "success"); ctx.rerender(); ctx.persistBg();
    });
    /* v3.8.1: the bottom bar had three same-weight buttons, so "save as
     * template" — an occasional action — competed with "save", the one thing
     * every visit ends with. Save and cancel are the bar now; the template
     * action lives in the "…" menu, one tap away. */
    var actMore = el("button", "btn btn--ghost btn--sm icon-only", "⋯");
    actMore.type = "button";
    actMore.setAttribute("aria-label", t("tb_more"));
    actMore.setAttribute("aria-haspopup", "true");
    actMore.addEventListener("click", function (e) {
      e.stopPropagation();
      toolbarMenu(actMore, [{ label: t("tpl_save"), onClick: function () { tpl.click(); } }]);
    });
    actions.appendChild(actMore); actions.appendChild(cancel); actions.appendChild(save);
    card.appendChild(actions);

    ov.appendChild(card);
    document.body.appendChild(ov);
    title.focus();

    function close() { ov.remove(); editingId = null; }
  }

  // ---- main render ------------------------------------------------------------
  function normFa(str) {
    var out = "";
    for (var i = 0; i < str.length; i++) {
      var c = str[i], k = "۰۱۲۳۴۵۶۷۸۹".indexOf(c), a = "٠١٢٣٤٥٦٧٨٩".indexOf(c);
      if (k >= 0) out += String(k);
      else if (a >= 0) out += String(a);
      else if (c === "\u200c") out += " ";
      else out += c;
    }
    return out.replace(/\s+/g, " ").trim();
  }

  function parseQuick(raw) {
    var text = normFa(raw);
    if (!text) return null;
    var pr = "normal";
    if (/کم اهمیت/.test(text)) { pr = "low"; text = text.replace(/کم اهمیت/, " "); }
    else if (/(^| )مهم( |$)/.test(text)) { pr = "high"; text = text.replace(/(^| )مهم( |$)/, " "); }

    var today = new Date(); today.setHours(0, 0, 0, 0);
    function off(n) {
      var d = new Date(today); d.setDate(d.getDate() + n);
      var j = ctx.J.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
      return { jy: j.jy, jm: j.jm, jd: j.jd };
    }
    var due = null;
    if (/پس فردا/.test(text)) { due = off(2); text = text.replace(/پس فردا/, " "); }
    else if (/(^| )فردا( |$)/.test(text)) { due = off(1); text = text.replace(/(^| )فردا( |$)/, " "); }
    else if (/(^| )امروز( |$)/.test(text)) { due = off(0); text = text.replace(/(^| )امروز( |$)/, " "); }
    if (!due) {
      var wds = ["شنبه", "یکشنبه", "دوشنبه", "سه شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
      for (var i = 0; i < 7; i++) {
        if (text.indexOf(wds[i]) >= 0) {
          var ti = (today.getDay() + 1) % 7;
          var ahead = (i - ti + 7) % 7;
          if (!ahead) ahead = 7;
          due = off(ahead);
          text = text.replace(wds[i], " ");
          break;
        }
      }
    }
    if (!due) {
      var months = t("months");
      var mre = new RegExp("(\\d{1,2}) (" + months.join("|") + ")( (\\d{4}))?");
      var mm = text.match(mre);
      if (mm) {
        due = {
          jy: mm[4] ? parseInt(mm[4], 10) : todayJ().jy,
          jm: months.indexOf(mm[2]) + 1,
          jd: parseInt(mm[1], 10),
        };
        text = text.replace(mre, " ");
      }
    }
    if (!due) {
      var nre = /(\d{1,3}) روز (دیگر|دیگه)/;
      var nn = text.match(nre);
      if (nn) { due = off(parseInt(nn[1], 10)); text = text.replace(nre, " "); }
    }

    var cat = "personal";
    if (/امتحان/.test(text)) cat = "exam";
    else if (/ورزش|باشگاه|تمرین/.test(text)) cat = "sport";
    else if (/درس|مطالعه|کتاب/.test(text)) cat = "study";
    else if (/(^| )کار( |$)|جلسه/.test(text)) cat = "work";

    var title = text.replace(/\s+/g, " ").trim();
    if (!title) return null;
    return {
      id: "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title: title, notes: "", cat: cat, pr: pr, hz: "short",
      tags: [], rep: "none", link: "", subs: [],
      due: due, done: false, createdAt: new Date().toISOString(), doneAt: null,
    };
  }

  async function examPlan() {
    var name = await ctx.UI.prompt({ label: t("exam_askName") });
    if (!name) return;
    // date via selects (no typing) — a small dialog with the same picker
    var picked = await new Promise(function (resolve) {
      var ov = el("div", "overlay");
      var card = el("div", "overlay__card");
      card.appendChild(el("h2", "panel__title", t("exam_askDate")));
      var due = dueSelects(null);
      var f = el("div", "field"); f.appendChild(due); card.appendChild(f);
      var actions = el("div", "overlay__actions");
      var cancel = el("button", "btn btn--ghost btn--sm", t("cancel"));
      cancel.addEventListener("click", function () { ov.remove(); resolve(null); });
      var ok = el("button", "btn btn--primary btn--sm", t("save"));
      ok.addEventListener("click", function () {
        var d = due.getDue(); ov.remove(); resolve(d);
      });
      actions.appendChild(cancel); actions.appendChild(ok);
      card.appendChild(actions); ov.appendChild(card);
      document.body.appendChild(ov);
    });
    if (!picked) return;
    var jy = picked.jy, jm = picked.jm, jd = picked.jd;
    var g = ctx.J.toGregorian(jy, jm, jd);
    var exam = new Date(g.gy, g.gm - 1, g.gd);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var days = Math.round((exam - today) / 86400000);
    if (days < 1) { ctx.status("exam_past", "error"); return; }
    // spaced reviews: 1,3,7,14,21,... days before + final review the day before
    var offsets = [1, 3, 7, 14, 21, 30].filter(function (o) { return o < days; });
    if (offsets.indexOf(1) < 0 && days > 1) offsets.unshift(1);
    var made = 0;
    offsets.forEach(function (o, i) {
      var d = new Date(exam); d.setDate(d.getDate() - o);
      var j = ctx.J.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
      tasks().push({
        id: "t_" + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 6),
        title: t("exam_review") + " " + (offsets.length - i) + " — " + name,
        notes: "", cat: "exam", pr: o <= 3 ? "high" : "normal", hz: "short",
        tags: [name], rep: "none",
        due: { jy: j.jy, jm: j.jm, jd: j.jd },
        done: false, createdAt: new Date().toISOString(), doneAt: null,
      });
      made++;
    });
    var je = ctx.J.toJalaali(exam.getFullYear(), exam.getMonth() + 1, exam.getDate());
    tasks().push({
      id: "t_" + Date.now().toString(36) + "x" + Math.random().toString(36).slice(2, 6),
      title: "📝 " + name,
      notes: "", cat: "exam", pr: "high", hz: "short", tags: [name], rep: "none",
      due: { jy: je.jy, jm: je.jm, jd: je.jd },
      done: false, createdAt: new Date().toISOString(), doneAt: null,
    });
    ctx.persist().then(function () {
      ctx.status("msg_saved", "success");
      ctx.rerender();
    });
  }

  function workoutPlan() {
    var ov = el("div", "overlay");
    var card = el("div", "overlay__card");
    card.appendChild(el("h2", "panel__title", t("wo_plan")));

    function fld(labelKey, control) {
      var f = el("div", "field");
      f.appendChild(el("label", null, t(labelKey)));
      f.appendChild(control);
      return f;
    }
    var name = el("input"); name.type = "text"; name.value = t("cat_sport");
    card.appendChild(fld("wo_name", name));

    var dayset = {};
    var drow = el("div", "l-icons");
    t("weekdaysFull").forEach(function (wd, i) {
      var b = el("button", "tag-chip");
      b.type = "button"; b.textContent = wd;
      b.addEventListener("click", function () {
        dayset[i] = !dayset[i];
        b.classList.toggle("active", !!dayset[i]);
      });
      drow.appendChild(b);
    });
    card.appendChild(fld("wo_days", drow));

    var weeks = el("input"); weeks.type = "number";
    weeks.min = "1"; weeks.max = "12"; weeks.value = "4";
    card.appendChild(fld("wo_weeks", weeks));

    var trow = el("div", "time-row");
    var tf = el("input"); tf.type = "time";
    var tt2 = el("input"); tt2.type = "time";
    trow.appendChild(tf);
    trow.appendChild(el("span", "time-sep", t("time_to")));
    trow.appendChild(tt2);
    card.appendChild(fld("task_time", trow));

    var ex = el("textarea"); ex.rows = 4; ex.placeholder = t("wo_exHint");
    card.appendChild(fld("wo_ex", ex));

    var actions = el("div", "overlay__actions");
    var cancel = el("button", "btn btn--ghost btn--sm", t("cancel"));
    cancel.addEventListener("click", function () { ov.remove(); });
    var save = el("button", "btn btn--primary btn--sm", t("save"));
    save.addEventListener("click", async function () {
      var days = Object.keys(dayset).filter(function (k) { return dayset[k]; }).map(Number);
      if (!days.length) { ctx.status("wo_pickDay", "error"); return; }
      var nm = name.value.trim() || t("cat_sport");
      var subs = ex.value.split("\n").map(function (l) { return l.trim(); })
        .filter(Boolean).map(function (txt) { return { text: txt, done: false }; });
      var nWeeks = Math.max(1, Math.min(12, parseInt(weeks.value, 10) || 4));
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var ti = (today.getDay() + 1) % 7;
      var made = 0;
      for (var w = 0; w < nWeeks; w++) {
        days.forEach(function (di) {
          var ahead = (di - ti + 7) % 7 + w * 7;
          var d = new Date(today); d.setDate(d.getDate() + ahead);
          var j = ctx.J.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
          tasks().push({
            id: "t_" + Date.now().toString(36) + made + Math.random().toString(36).slice(2, 6),
            title: "🏋️ " + nm,
            notes: "", cat: "sport", pr: "normal", hz: "short",
            tags: [nm], rep: "none", link: "",
            timeFrom: tf.value || "", timeTo: tt2.value || "", color: "c4",
            subs: subs.map(function (sx) { return { text: sx.text, done: false }; }),
            due: { jy: j.jy, jm: j.jm, jd: j.jd },
            done: false, createdAt: new Date().toISOString(), doneAt: null,
          });
          made++;
        });
      }
      ov.remove();
      ctx.status("wo_made", "success"); ctx.rerender(); ctx.persistBg();
    });
    actions.appendChild(cancel); actions.appendChild(save);
    card.appendChild(actions);
    ov.appendChild(card);
    document.body.appendChild(ov);
    name.focus();
  }

  function openTemplates() {
    var list = ctx.S.vault.templates || [];
    var ov = el("div", "overlay");
    var card = el("div", "overlay__card");
    card.appendChild(el("h2", "panel__title", t("tpl_open")));
    if (!list.length) {
      card.appendChild(el("p", "panel__text", t("tpl_empty")));
    } else {
      list.forEach(function (T2) {
        var row = el("div", "mt-row");
        row.appendChild(el("span", "mt-row__title", T2.title));
        row.appendChild(el("span", "badge", t("cat_" + T2.cat)));
        var use = el("button", "btn btn--primary btn--sm", t("tpl_use"));
        use.addEventListener("click", function () { ov.remove(); openEditor(null, null, T2); });
        var del = el("button", "btn btn--ghost btn--sm btn--danger", t("delete"));
        del.addEventListener("click", async function () {
          ctx.S.vault.templates = (ctx.S.vault.templates || []).filter(function (i) { return i.id !== T2.id; });
          ov.remove(); openTemplates(); ctx.persistBg();
        });
        row.appendChild(use); row.appendChild(del);
        card.appendChild(row);
      });
    }
    var actions = el("div", "overlay__actions");
    var close = el("button", "btn btn--ghost btn--sm", t("cancel"));
    close.addEventListener("click", function () { ov.remove(); });
    actions.appendChild(close);
    card.appendChild(actions);
    ov.appendChild(card);
    document.body.appendChild(ov);
  }

  // ---- v3.8 toolbar menus ---------------------------------------------------
  // A small anchored popover shared by the "ready-made plan" and "more" menus.
  // Closes on outside-click or Escape, and detaches its listener if the node
  // is removed by a re-render (so the listener can't outlive its popover).
  function toolbarMenu(anchorEl, items) {
    var existing = document.querySelector(".tb-pop");
    if (existing) { existing.remove(); return; }
    var pop = el("div", "tb-pop");
    items.forEach(function (it) {
      if (it.sep) { pop.appendChild(el("div", "tb-pop__sep")); return; }
      var b = el("button", "tb-pop__item", it.label);
      if (it.icon) b.insertBefore(icnSafe(it.icon), b.firstChild);
      b.addEventListener("click", function () {
        pop.remove();
        it.onClick();
      });
      pop.appendChild(b);
    });
    document.body.appendChild(pop);
    var r = anchorEl.getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + "px";
    // anchor to the button's inline-start edge, clamped into the viewport
    var w = pop.offsetWidth || 220;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    pop.style.insetInlineStart = "auto";
    pop.style.left = left + "px";
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
    // focus the first item for keyboard users
    var first = pop.querySelector(".tb-pop__item");
    if (first) first.focus();
  }

  // icn() may not exist in this module's scope; fall back to no icon
  function icnSafe(name) {
    try { return icn(name); } catch (e) { return el("span", "tb-pop__dot"); }
  }

  function openPlansMenu(anchorEl) {
    toolbarMenu(anchorEl, [
      { label: t("exam_plan"), onClick: examPlan },
      { label: t("wo_plan"), onClick: workoutPlan },
      { label: t("tpl_open"), onClick: openTemplates },
    ]);
  }

  function openMoreMenu(anchorEl) {
    toolbarMenu(anchorEl, [
      { label: t(selMode ? "sel_exit" : "sel_enter"), onClick: function () {
        selMode = !selMode; clearSel(); ctx.rerender();
      } },
      { label: t("rp_title"), onClick: openSeriesPanel },
      { label: t("tb_filter_clear"), onClick: function () {
        filters = { status: "open", cat: "all", pr: "all", hz: "all", q: "", scope: "all", kind: "all" };
        ctx.rerender();
      } },
    ]);
  }

  /* v4.4 — cancelling a recurrence used to mean deleting every instance by
   * hand. A daily task materializes THIRTY independent rows sharing a
   * seriesId, so "I changed my mind" cost thirty confirmations — and missing
   * one left it alive on the calendar and the kanban board, which is exactly
   * the "I deleted it but it's still there" report. This groups a series back
   * into the one thing the user thinks of it as, and cancels it everywhere at
   * once. Kanban and the calendar read the same array, so removing the rows
   * removes them from every surface by construction. */
  function seriesList() {
    var by = {};
    tasks().forEach(function (x) {
      if (!x.seriesId) return;
      var g = by[x.seriesId];
      if (!g) {
        g = by[x.seriesId] = { id: x.seriesId, title: x.title, rep: x.rep,
                               total: 0, done: 0, first: x.due, last: x.due };
      }
      g.total++;
      if (x.done) g.done++;
      function key(d) { return d ? d.jy * 10000 + d.jm * 100 + d.jd : 0; }
      if (key(x.due) && (!key(g.first) || key(x.due) < key(g.first))) g.first = x.due;
      if (key(x.due) > key(g.last)) g.last = x.due;
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  async function cancelSeries(sid) {
    var hit = tasks().filter(function (x) { return x.seriesId === sid; });
    if (!hit.length) return;
    var msg = t("rp_confirmCancel").replace("{n}", ctx.num(hit.length));
    if (!(await ctx.UI.confirm({ body: msg, danger: true }))) return;
    // trashed rather than vaporised: cancelling thirty rows by accident should
    // be recoverable like any other delete
    hit.forEach(function (x) { ctx.S.trashPut("task", x); });
    ctx.S.vault.tasks = tasks().filter(function (x) { return x.seriesId !== sid; });
    ctx.status("msg_trashed", "success"); ctx.rerender(); ctx.persistBg();
  }

  function openSeriesPanel() {
    var list = seriesList();
    var ov = el("div", "overlay");
    var card = el("div", "overlay__card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.appendChild(el("h2", "panel__title", t("rp_title")));

    if (!list.length) {
      card.appendChild(el("p", "panel__text", t("rp_empty")));
    } else {
      var wrap = el("div", "rp-list");
      list.forEach(function (g) {
        var row = el("div", "rp-row");
        var main = el("div", "rp-row__main");
        main.appendChild(el("div", "rp-row__title", g.title || t("untitled")));
        var meta = t("rep_" + (g.rep || "daily")) + " · " +
          t("rp_count").replace("{n}", ctx.num(g.total)) +
          (g.done ? " · " + t("rp_done").replace("{n}", ctx.num(g.done)) : "");
        main.appendChild(el("div", "rp-row__meta", meta));
        row.appendChild(main);
        var cancel = el("button", "btn btn--ghost btn--sm btn--danger", t("rp_cancel"));
        cancel.addEventListener("click", function () { ov.remove(); cancelSeries(g.id); });
        row.appendChild(cancel);
        wrap.appendChild(row);
      });
      card.appendChild(wrap);
    }

    var actions = el("div", "overlay__actions");
    var close = el("button", "btn btn--primary btn--sm", t("close"));
    close.addEventListener("click", function () { ov.remove(); });
    actions.appendChild(close);
    card.appendChild(actions);
    ov.appendChild(card);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    document.addEventListener("keydown", function esc(e) {
      document.removeEventListener("keydown", esc);
      if (e.key === "Escape" && ov.parentNode) ov.remove();
    });
    document.body.appendChild(ov);
    close.focus();
  }

  function render(host) {
    // today's progress — % of today's due tasks completed
    (function () {
      var tj = ctx.J.toJalaali(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
      var due = 0, done = 0;
      (ctx.S.vault.tasks || []).forEach(function (x) {
        if (x.archived || !x.due || isEvent(x)) return;
        if (x.due.jy === tj.jy && x.due.jm === tj.jm && x.due.jd === tj.jd) { due++; if (x.done) done++; }
      });
      if (!due) return;
      var pct = Math.round((done / due) * 100);
      var p = el("div", "panel tp-panel");
      var head = el("div", "tp-head");
      head.appendChild(el("span", "tp-label", t("tp_today")));
      head.appendChild(el("span", "tp-pct", ctx.num(done) + "/" + ctx.num(due) + " · " + ctx.num(pct) + t("pct")));
      p.appendChild(head);
      var track = el("div", "tp-track");
      var fill = el("div", "tp-fill" + (pct === 100 ? " tp-fill--done" : ""));
      fill.style.setProperty("--p", pct / 100);
      track.appendChild(fill);
      p.appendChild(track);
      host.appendChild(p);
    })();

    // v3.8 (بازطراحی صفحه‌ی تسک‌ها): the old toolbar put four equal buttons
    // and six always-open filters above an often-empty list — a wall of
    // controls before the user's actual work. Progressive disclosure now:
    // ONE primary action (new task), the three "ready-made plans" behind a
    // menu, quick-add on its own line, and the six filters collapsed behind a
    // toggle that shows how many are active. Nothing was removed — everything
    // is one tap away, in a place that matches how often it's used.
    var tb = el("div", "toolbar toolbar--tasks");

    var add = el("button", "btn btn--primary btn--sm", t("task_new"));
    add.addEventListener("click", function () { openEditor(null); });
    tb.appendChild(add);

    // the three plan generators collapse into one menu
    var plansBtn = el("button", "btn btn--ghost btn--sm tb-menu-btn", t("tb_ready"));
    plansBtn.setAttribute("aria-haspopup", "true");
    plansBtn.setAttribute("aria-expanded", "false");
    plansBtn.appendChild(el("span", "tb-caret", "▾"));
    plansBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      openPlansMenu(plansBtn);
    });
    tb.appendChild(plansBtn);

    // filter toggle carries a live count of what's narrowing the list
    var filterBtn = el("button", "btn btn--ghost btn--sm tb-filter-btn", t("tb_filter"));
    var nActive = activeFilterCount();
    if (nActive) filterBtn.appendChild(el("span", "tb-badge", ctx.num(nActive)));
    filterBtn.setAttribute("aria-expanded", filtersOpen ? "true" : "false");
    filterBtn.addEventListener("click", function () {
      filtersOpen = !filtersOpen;
      ctx.rerender();
    });
    tb.appendChild(filterBtn);

    // "select multiple" is an occasional action → tucked into a "more" menu
    var moreBtn = el("button", "btn btn--ghost btn--sm icon-only tb-more-btn", "⋯");
    moreBtn.setAttribute("aria-label", t("tb_more"));
    moreBtn.setAttribute("aria-haspopup", "true");
    moreBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      openMoreMenu(moreBtn);
    });
    tb.appendChild(moreBtn);

    host.appendChild(tb);

    // quick-add gets its own full-width line — it's the fastest path in and
    // deserves to breathe, not fight four buttons for space
    var qaWrap = el("div", "qa-wrap");
    var qa = el("input", "tsearch qa-input");
    qa.type = "text"; qa.placeholder = t("qa_ph");
    qa.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var parsed = parseQuick(qa.value);
      if (!parsed) { ctx.status("qa_bad", "error"); return; }
      tasks().push(parsed);
      qa.value = "";
      ctx.persist().then(function () { ctx.status("msg_saved", "success"); ctx.rerender(); });
    });
    qaWrap.appendChild(qa);
    host.appendChild(qaWrap);

    // filters only take up space when the user asks for them
    if (filtersOpen) host.appendChild(filterBar());
    host.appendChild(selBar());

    listHost = el("div", "task-list");
    host.appendChild(listHost);
    renderList();
  }

  function openCount() {
    return ((ctx && ctx.S.vault && ctx.S.vault.tasks) || []).filter(function (x) { return !x.done; }).length;
  }

  g.TasksView = {
    init: init, render: render, openCount: openCount,
    openNew: function (due, timeFrom, timeTo) {
      var preset = null;
      if (timeFrom) preset = { timeFrom: timeFrom, timeTo: timeTo || "" };
      openEditor(null, due, preset);
    },
    openById: function (id) { openEditor(id); },
  };
})(window);
