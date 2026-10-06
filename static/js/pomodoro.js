/* pomodoro.js — focus page: live clock + pomodoro (25 work / 5 break).
 * Completed work sessions are stored per-day in vault.settings.pomoLog.
 */
(function (g) {
  "use strict";
  var ctx = null;
  var st = { mode: "work", left: 25 * 60, running: false, started: false };
  var tick = null, clockTick = null;

  function cfg() {
    var s = ctx.S.vault.settings || {};
    return {
      work: (s.pomoWork || 25) * 60,
      brk: (s.pomoBreak || 5) * 60,
    };
  }
  function WORK() { return cfg().work; }
  function BREAK() { return cfg().brk; }

  function init(c) { ctx = c; }
  function t(k) { return ctx.T.t(k); }
  function el(a, b, c) { return ctx.el(a, b, c); }
  function isoLocal(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }
  function pomoLog() {
    var s = ctx.S.vault.settings || (ctx.S.vault.settings = {});
    return s.pomoLog || (s.pomoLog = {});
  }
  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return ctx.num(String(m).padStart(2, "0")) + ":" + ctx.num(String(s).padStart(2, "0"));
  }
  function stopAll() {
    document.body.classList.remove("zen-on");
    if (tick) clearInterval(tick);
    if (clockTick) clearInterval(clockTick);
    tick = clockTick = null;
  }

  function render(host) {
    stopAll();
    if (!st.started) st.left = st.mode === "work" ? WORK() : BREAK();

    // live clock
    var clockCard = el("div", "panel po-clockcard");
    var clock = el("div", "po-clock");
    var dateLine = el("div", "po-date");
    clockCard.appendChild(clock);
    clockCard.appendChild(dateLine);
    host.appendChild(clockCard);

    function updClock() {
      if (!document.contains(clock)) { stopAll(); return; }
      var n = new Date();
      clock.textContent = ctx.num(
        String(n.getHours()).padStart(2, "0") + ":" +
        String(n.getMinutes()).padStart(2, "0") + ":" +
        String(n.getSeconds()).padStart(2, "0"));
      var j = ctx.J.toJalaali(n.getFullYear(), n.getMonth() + 1, n.getDate());
      dateLine.textContent = window.CalSys.labelFull(j);
    }
    updClock();
    clockTick = setInterval(updClock, 1000);

    // pomodoro
    var card = el("div", "panel po-card");
    var mode = el("div", "po-mode", t(st.mode === "work" ? "po_work" : "po_break"));
    var big = el("div", "po-timer" + (st.mode === "break" ? " po-timer--break" : ""), fmt(st.left));
    card.appendChild(mode);
    card.appendChild(big);

    var row = el("div", "po-actions");
    var startBtn = el("button", "btn btn--primary", t(st.running ? "po_pause" : "po_start"));
    var resetBtn = el("button", "btn btn--ghost", t("po_reset"));
    var skipBtn = el("button", "btn btn--ghost", t("po_skip"));
    var zenBtn = ctx.elIc("button", "btn btn--ghost", "moon", t("po_zen"));
    row.appendChild(startBtn); row.appendChild(resetBtn); row.appendChild(skipBtn);
    row.appendChild(zenBtn);
    card.appendChild(row);

    // ---- Zen: a calm, full-screen room. Breathing ring, progress arc, and a
    // dimmed world. Everything stays wired to the same timer state.
    var zen = el("div", "zen hidden");
    var zenRing = el("div", "zen__ring");
    var RC = 132, RR = 2 * Math.PI * RC; // circumference of the progress circle
    var arcSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    arcSvg.setAttribute("class", "zen__arc");
    arcSvg.setAttribute("viewBox", "0 0 300 300");
    var trackC = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    trackC.setAttribute("class", "zen__track");
    trackC.setAttribute("cx", "150"); trackC.setAttribute("cy", "150"); trackC.setAttribute("r", String(RC));
    var progC = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    progC.setAttribute("class", "zen__prog");
    progC.setAttribute("cx", "150"); progC.setAttribute("cy", "150"); progC.setAttribute("r", String(RC));
    progC.style.strokeDasharray = RR.toFixed(1);
    arcSvg.appendChild(trackC); arcSvg.appendChild(progC);
    var zenBreath = el("div", "zen__breath");
    var zenTime = el("div", "zen__time", fmt(st.left));
    var zenMode = el("div", "zen__mode", t(st.mode === "work" ? "po_work" : "po_break"));
    var zenHint = el("div", "zen__hint", t("po_zenHint"));
    zenRing.appendChild(arcSvg);
    zenRing.appendChild(zenBreath);
    var zenCenter = el("div", "zen__center");
    zenCenter.appendChild(zenMode);
    zenCenter.appendChild(zenTime);
    zenRing.appendChild(zenCenter);
    zen.appendChild(zenRing);
    var zenRow = el("div", "zen__actions");
    var zStart = el("button", "btn btn--primary btn--lg", t(st.running ? "po_pause" : "po_start"));
    var zExit = el("button", "btn btn--ghost", t("po_exitZen"));
    zenRow.appendChild(zStart); zenRow.appendChild(zExit);
    zen.appendChild(zenRow);
    zen.appendChild(zenHint);
    host.appendChild(zen);

    function total() { return st.mode === "work" ? WORK() : BREAK(); }
    function paintZen() {
      zenTime.textContent = fmt(st.left);
      zenMode.textContent = t(st.mode === "work" ? "po_work" : "po_break");
      zStart.textContent = t(st.running ? "po_pause" : "po_start");
      zen.classList.toggle("zen--break", st.mode === "break");
      zen.classList.toggle("zen--running", st.running);
      var done = 1 - (st.left / Math.max(1, total()));
      progC.style.strokeDashoffset = (RR * (1 - done)).toFixed(1);
    }
    function openZen() {
      zen.classList.remove("hidden");
      document.body.classList.add("zen-on");
      paintZen();
      window.FX.haptic("soft");
    }
    function closeZen() {
      zen.classList.add("hidden");
      document.body.classList.remove("zen-on");
    }
    zenBtn.addEventListener("click", openZen);
    zExit.addEventListener("click", closeZen);
    zStart.addEventListener("click", function () { startBtn.click(); });
    document.addEventListener("keydown", function onEsc(e) {
      if (!document.contains(zen)) { document.removeEventListener("keydown", onEsc); return; }
      if (e.key === "Escape" && !zen.classList.contains("hidden")) closeZen();
    });

    var todayKey = isoLocal(new Date());
    var sessions = el("p", "po-sessions",
      t("po_sessions") + ": " + ctx.num(pomoLog()[todayKey] || 0));
    card.appendChild(sessions);
    host.appendChild(card);

    // configurable durations (someone may want a 2-hour deep-focus block)
    var s0 = ctx.S.vault.settings || (ctx.S.vault.settings = {});
    var cfgCard = el("div", "panel");
    cfgCard.appendChild(el("h2", "panel__title", t("po_settings")));

    function mkSel(labelKey, opts, cur, onchange) {
      var wrap = el("div", "wl-row");
      wrap.appendChild(el("span", "wl-lb", t(labelKey)));
      var selEl = el("select", "tsel");
      opts.forEach(function (v) {
        var o = el("option", null, ctx.num(v) + " " + t("po_min")); o.value = String(v);
        if (v === cur) o.selected = true;
        selEl.appendChild(o);
      });
      selEl.addEventListener("change", async function () {
        onchange(parseInt(selEl.value, 10));
        if (!st.started) { st.left = st.mode === "work" ? WORK() : BREAK(); paint(); }
        await ctx.persist();
      });
      wrap.appendChild(selEl);
      return wrap;
    }
    cfgCard.appendChild(mkSel("po_workLen", [15, 25, 45, 60, 90, 120], s0.pomoWork || 25,
      function (v) { s0.pomoWork = v; }));
    cfgCard.appendChild(mkSel("po_breakLen", [5, 10, 15, 20], s0.pomoBreak || 5,
      function (v) { s0.pomoBreak = v; }));
    host.appendChild(cfgCard);

    function paint() {
      big.textContent = fmt(st.left);
      big.classList.toggle("po-timer--break", st.mode === "break");
      mode.textContent = t(st.mode === "work" ? "po_work" : "po_break");
      startBtn.textContent = t(st.running ? "po_pause" : "po_start");
      document.title = (st.running ? fmt(st.left) + " · " : "") + t("appName");
      paintZen();
    }
    async function completeWork() {
      window.FX.haptic("heavy");
      window.FX.confetti(document.contains(zenTime) && !zen.classList.contains("hidden")
        ? zenTime : big);
      pomoLog()[todayKey] = (pomoLog()[todayKey] || 0) + 1;
      sessions.textContent = t("po_sessions") + ": " + ctx.num(pomoLog()[todayKey]);
      ctx.status("po_done", "success");
      await ctx.persist();
    }
    function switchMode() {
      st.mode = st.mode === "work" ? "break" : "work";
      st.left = st.mode === "work" ? WORK() : BREAK();
    }
    function run() {
      tick = setInterval(function () {
        if (!document.contains(big)) { stopAll(); return; }
        if (!st.running) return;
        st.left--;
        if (st.left <= 0) {
          if (st.mode === "work") completeWork();
          switchMode();
        }
        paint();
      }, 1000);
    }
    startBtn.addEventListener("click", function () {
      st.running = !st.running;
      if (st.running) st.started = true;
      if (st.running && !tick) run();
      paint();
    });
    resetBtn.addEventListener("click", function () {
      st.running = false; st.started = false;
      st.left = st.mode === "work" ? WORK() : BREAK();
      paint();
    });
    skipBtn.addEventListener("click", function () {
      st.running = false;
      switchMode();
      paint();
    });
    if (st.running) run();
    paint();
  }

  g.FocusView = { init: init, render: render };
})(window);
