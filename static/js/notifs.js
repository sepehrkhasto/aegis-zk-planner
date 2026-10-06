/* notifs.js — notification center. Merges two sources:
 *   1) local task reminders (due today / overdue) computed from the vault
 *   2) admin broadcasts fetched from the server
 * Shows them in a bell dropdown (not cluttering the screen). Read-state is
 * tracked in localStorage. Optionally fires a browser notification for new
 * items when the user has granted permission. All lightweight & client-side.
 */
(function (g) {
  "use strict";
  var ctx = null;
  var broadcasts = [];
  var SEEN_KEY = "sp_notif_seen_v1";
  var pollTimer = null;

  function init(c) { ctx = c; }
  function t(k) { return ctx.T.t(k); }
  function el(a, b, c) { return ctx.el(a, b, c); }

  function seenSetHas(id) { return seenSet().has(id); }
  function seenSet() {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); }
    catch (e) { return new Set(); }
  }
  function markSeen(ids) {
    var s = seenSet();
    ids.forEach(function (id) { s.add(id); });
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-500))); } catch (e) {}
  }

  // Dismissed notifications stay gone (v1.9 cleanup). Task ids carry the day,
  // so dismissing an overdue reminder silences it for today only — tomorrow it
  // returns if the task is still overdue. Broadcasts stay dismissed for good.
  var DISMISS_KEY = "sp_notif_dismissed_v1";
  function dismissedSet() {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]")); }
    catch (e) { return new Set(); }
  }
  function dismiss(ids) {
    var s = dismissedSet();
    ids.forEach(function (id) { s.add(id); });
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...s].slice(-500))); } catch (e) {}
    refreshBadge();
  }
  function clearAll() {
    dismiss(build().map(function (n) { return n.id; }));
  }

  function isoDay(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }

  // Build the current notification list (newest/most-urgent first).
  function build() {
    var out = [];
    var v = ctx.S.vault || {};
    var now = new Date(); now.setHours(0, 0, 0, 0);

    // v1.10 — subscription expiry heads-up at 7 and 1 day(s) out. Day-scoped
    // id: dismissing silences it for today; it returns tomorrow while still
    // relevant (same policy as overdue tasks).
    var pd = (document.querySelector('meta[name="premium-days"]') || {}).content;
    if (pd !== "" && pd != null) {
      var pdN = parseInt(pd, 10);
      if (pdN >= 0 && pdN <= 7) {
        out.push({
          id: "prem-exp-" + pdN + "-" + isoDay(new Date()),
          icon: "star",
          level: pdN <= 1 ? "warning" : "info",
          title: t(pdN <= 1 ? "nt_premLast" : "nt_premSoon").replace("{n}", ctx.num(pdN)),
          body: t("nt_premBody"),
          sort: -5,
          go: "#/settings",
        });
      }
    }
    var tj = ctx.J.toJalaali(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());

    (v.tasks || []).forEach(function (x) {
      if (x.done || !x.due || x.archived) return;
      var gd = ctx.J.toGregorian(x.due.jy, x.due.jm, x.due.jd);
      var dd = new Date(gd.gy, gd.gm - 1, gd.gd);
      var diff = Math.round((dd - now) / 86400000);
      if (diff < 0) {
        out.push({ id: "task-over-" + x.id + "-" + isoDay(new Date()), icon: "focus", level: "warning",
          title: t("nt_overdue"), body: x.title, go: "#/tasks", sort: 0 });
      } else if (diff === 0) {
        out.push({ id: "task-today-" + x.id + "-" + isoDay(new Date()), icon: "tasks", level: "info",
          title: t("nt_dueToday"), body: x.title +
            (x.timeFrom ? " · " + ctx.num(x.timeFrom) : ""), go: "#/tasks", sort: 1 });
      }
    });

    // welcome stays in the list; opening the bell only clears its "new" state
    out.push({ id: "welcome-1", icon: "logo", level: "success",
      title: t("nt_welcome"), body: t("nt_welcomeBody"), sort: -2 });

    broadcasts.forEach(function (b) {
      out.push({ id: "bc-" + b.id, icon: b.level === "warning" ? "help" : (b.level === "success" ? "goals" : "bell"),
        level: b.level, title: b.title, body: b.body, at: b.at, sort: -1, broadcast: true });
    });

    var gone = dismissedSet();
    out = out.filter(function (n) { return !gone.has(n.id); });
    out.sort(function (a, b) { return a.sort - b.sort; });
    return out;
  }

  function unreadCount() {
    var seen = seenSet();
    return build().filter(function (n) { return !seen.has(n.id); }).length;
  }

  function refreshBadge() {
    var badge = document.getElementById("nt-badge");
    if (!badge) return;
    var n = unreadCount();
    badge.textContent = n > 9 ? ctx.num(9) + "+" : ctx.num(n);
    badge.setAttribute("aria-label", n + " " + t("nt_title"));
    badge.classList.toggle("hidden", n === 0);
  }

  function maybeBrowserNotify(list) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    var seen = seenSet();
    list.filter(function (n) { return n.broadcast && !seen.has(n.id); })
      .slice(0, 3)
      .forEach(function (n) {
        try { new Notification(n.title, { body: n.body || "", tag: n.id }); } catch (e) {}
      });
  }

  function openPanel() {
    closePanel();
    var list = build();
    var pop = el("div", "nt-pop");
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", t("nt_title"));
    var head = el("div", "nt-pop__head");
    head.appendChild(el("span", "nt-pop__title", t("nt_title")));
    if ("Notification" in window && Notification.permission === "default") {
      var allow = el("button", "btn btn--ghost btn--sm", t("nt_enable"));
      allow.addEventListener("click", function () {
        Notification.requestPermission()
          .then(function () { openPanel(); })
          .catch(function () { openPanel(); });   // older Safari rejects instead of resolving
      });
      head.appendChild(allow);
    }
    if (list.length) {
      var clr = el("button", "btn btn--ghost btn--sm", t("nt_clearAll"));
      clr.addEventListener("click", function () { clearAll(); closePanel(); });
      head.appendChild(clr);
    }
    pop.appendChild(head);

    var body = el("div", "nt-pop__list");
    if (!list.length) {
      body.appendChild(el("div", "nt-empty", t("nt_empty")));
    } else {
      var seen = seenSet();
      list.forEach(function (n) {
        var row = el("div", "nt-item nt-item--" + n.level + (seen.has(n.id) ? "" : " nt-item--new"));
        var icw = el("span", "nt-item__ic nt-item__ic--" + (n.level || "info"));
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "ic");
        svg.setAttribute("viewBox", "0 0 24 24");
        var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#ic-" + n.icon);
        svg.appendChild(use);
        icw.appendChild(svg);
        row.appendChild(icw);
        var main = el("div", "nt-item__main");
        main.appendChild(el("div", "nt-item__title", n.title));
        if (n.body) main.appendChild(el("div", "nt-item__body", n.body));
        row.appendChild(main);
        if (n.go) {
          row.classList.add("nt-item--link");
          row.addEventListener("click", function () { closePanel(); location.hash = n.go; });
        }
        var x = el("button", "nt-item__x");
        x.setAttribute("aria-label", t("nt_dismiss"));
        x.textContent = "\u00d7";
        x.addEventListener("click", function (e) {
          e.stopPropagation();
          dismiss([n.id]);
          row.remove();
          if (!body.querySelector(".nt-item")) body.appendChild(el("div", "nt-empty", t("nt_empty")));
        });
        row.appendChild(x);
        body.appendChild(row);
      });
    }
    pop.appendChild(body);
    document.body.appendChild(pop);

    // position under the bell — physical coords, clamped to the viewport,
    // correct in both RTL and LTR (inset-inline-end was wrong in RTL)
    var bell = document.getElementById("nt-bell");
    if (bell) {
      var r = bell.getBoundingClientRect();
      pop.style.top = (r.bottom + 8) + "px";
      // one physical-coords path for both directions: pin the pop's near edge
      // to the bell, then clamp BOTH sides into the viewport so it can never
      // hang off-screen on narrow displays (the old LTR branch missed the
      // left-edge clamp and used a width that disagreed with the CSS)
      // Narrow screens: stop trying to anchor to the bell at all — a phone has
      // no room for it. Span the viewport with an 8px gutter, which is what the
      // real-device reports kept catching (the popup ran off the left edge in
      // LTR). Wider screens keep the anchored behaviour, clamped on both sides.
      var vw = window.innerWidth;
      var w, left;
      if (vw <= 560) {
        w = vw - 16;
        left = 8;
      } else {
        w = Math.min(360, vw - 16);
        var isRtl = document.documentElement.getAttribute("dir") === "rtl";
        left = isRtl ? r.left : (r.right - w);
        left = Math.max(8, Math.min(left, vw - w - 8));
      }
      pop.style.width = w + "px";
      pop.style.left = left + "px";
      pop.style.right = "auto";
      pop.style.maxHeight = (window.innerHeight - r.bottom - 24) + "px";
    }

    // mark everything seen after opening
    markSeen(list.map(function (n) { return n.id; }));
    setTimeout(refreshBadge, 10);
    setTimeout(function () {
      document.addEventListener("click", outside);
    }, 0);
    function outside(e) {
      if (!pop.contains(e.target) && e.target.id !== "nt-bell") {
        closePanel(); document.removeEventListener("click", outside);
      }
    }
    pop.__outside = outside;
  }
  function closePanel() {
    var p = document.getElementById("nt-pop-host") || document.querySelector(".nt-pop");
    if (p) { if (p.__outside) document.removeEventListener("click", p.__outside); p.remove(); }
  }

  function toggle() {
    if (document.querySelector(".nt-pop")) closePanel();
    else openPanel();
  }

  async function fetchBroadcasts() {
    try {
      var r = await fetch("/accounts/broadcasts/", { headers: { Accept: "application/json" } });
      if (!r.ok) return;
      var data = await r.json();
      broadcasts = data.items || [];
      var list = build();
      maybeBrowserNotify(list);
      refreshBadge();
    } catch (e) { /* offline — ignore */ }
  }

  function start() {
    refreshBadge();
    fetchBroadcasts();
    if (pollTimer) clearInterval(pollTimer);
    // light polling every 5 min; free-tier friendly
    pollTimer = setInterval(fetchBroadcasts, 5 * 60 * 1000);

    /* v4.1 — polling alone made the bell look broken. Send a broadcast from
     * the admin panel, switch back to the app, and nothing happens for up to
     * five minutes: the notification is real but the badge stays grey, which
     * reads as "notifications don't work". Checking again the moment the tab
     * becomes visible costs one request and makes it feel instant, which is
     * how every messaging app behaves. Guarded so a quick tab-flick doesn't
     * fire a burst of requests. */
    var lastCheck = 0;
    function checkIfStale() {
      if (document.hidden) return;
      var now = Date.now();
      if (now - lastCheck < 10000) return;   // at most once every 10s
      lastCheck = now;
      fetchBroadcasts();
    }
    document.addEventListener("visibilitychange", checkIfStale);
    window.addEventListener("focus", checkIfStale);
  }

  g.Notifs = { init: init, toggle: toggle, start: start, refresh: refreshBadge, clearAll: clearAll };
})(window);
