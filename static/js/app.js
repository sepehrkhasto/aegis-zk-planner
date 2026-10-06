/* app.js — the planner SPA UI. All logic runs client-side; the DEK never
 * leaves memory. Builds views into #route-view via a hash router.
 */
(function () {
  "use strict";
  var S = window.ZKStore, T = window.I18N, J = window.Jalali, C = window.ZKCrypto, CS = window.CalSys;

  var IDLE_MS = 15 * 60 * 1000;
  var MIN_LEN = 12;
  var idleTimer = null;
  var editingNoteId = null;
  var noteAuto = null;        // v2.2: autosave timer for the note editor
  var noteQuery = "";         // v2.2: in-page note search
  var noteQTimer = null;
  var noteSort = "updated";
  var noteDense = "grid";
  var noteTagFilter = null;
  var cal = { y: 0, m: 0 }; // current month in the DISPLAY calendar system
  var dashTimer = null;
  var nowLineTimer = null;   // v3.0.3: only one now-line interval may exist
  var lastRenderedRoute = null;  // v3.1: fade on navigation, not on every repaint
  var selDay = null;

  var ROUTES = ["dashboard", "calendar", "tasks", "kanban", "goals", "habits",
    "reports", "focus", "review", "notes", "search", "tags", "trash", "settings", "help",
    "more"];   // v6.6 — the phone's fourth tab is a screen, not a drawer
  var IMPLEMENTED = { dashboard: 1, calendar: 1, tasks: 1, notes: 1, settings: 1, help: 1 };

  // ---- tiny helpers -------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // icn(name) — a sprite <svg><use> icon for UI chrome. v1.9 (B6) replaces
  // emoji "stickers" in buttons/titles with real icons; emoji stays welcome
  // as *content* (task titles etc.), just not as interface iconography.
  function icn(name, cls) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ic ic-inline" + (cls ? " " + cls : ""));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#ic-" + name);
    svg.appendChild(use);
    return svg;
  }
  // el(...) but with a leading sprite icon
  function elIc(tag, cls, icon, text) {
    var n = el(tag, cls);
    n.appendChild(icn(icon));
    n.appendChild(document.createTextNode(" " + text));
    return n;
  }
  function pref(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function setPref(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var FA = "۰۱۲۳۴۵۶۷۸۹";
  function faDigits(s) { return s.replace(/[0-9]/g, function (d) { return FA[+d]; }); }
  function num(n) { var s = String(n); return T.lang === "fa" ? faDigits(s) : s; }

  // ---- component states (v1.8.2) -------------------------------------------
  // A button that is doing work must SAY so: it locks, keeps its width (no
  // layout jump) and shows a spinner. Fast spinner = the app feels faster.
  function setBusy(btn, busy) {
    if (!btn) return;
    if (busy) {
      btn.style.minWidth = btn.getBoundingClientRect().width + "px";
      btn.dataset.label = btn.textContent;
      btn.textContent = "";
      btn.appendChild(el("span", "spinner"));
      btn.disabled = true;
      btn.classList.add("is-busy");
    } else {
      btn.textContent = btn.dataset.label || btn.textContent;
      btn.disabled = false;
      btn.classList.remove("is-busy");
      btn.style.minWidth = "";
    }
  }

  // A rejected input shakes once — the fastest way to say "not this".
  function shake(node) {
    if (!node || window.FX.reduced()) return;
    node.classList.remove("is-shake");
    void node.offsetWidth;
    node.classList.add("is-shake");
    window.FX.haptic("warn");
    node.addEventListener("animationend", function () {
      node.classList.remove("is-shake");
    }, { once: true });
  }

  async function sendFeedback(message, category, rating) {
    try {
      var r = await fetch("/accounts/feedback/", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": S.csrf() },
        body: JSON.stringify({
          category: category || "other", message: message, rating: rating || null,
        }),
      });
      return r.ok;
    } catch (e) { return false; }
  }

  var statusTimer = null;
  function status(key, kind) {
    var e = $("status");
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    e.textContent = key ? T.t(key) : "";
    e.className = key ? "status status--" + (kind || "info") : "status";
    if (key) {
      statusTimer = setTimeout(function () {
        e.textContent = "";
        e.className = "status";
      }, 3200);
    }
  }
  function statusRaw(txt, kind) {
    var e = $("status");
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    e.textContent = txt || "";
    e.className = txt ? "status status--" + (kind || "info") : "status";
    if (txt) {
      statusTimer = setTimeout(function () {
        e.textContent = "";
        e.className = "status";
      }, 3200);
    }
  }

  function translatePage() {
    document.querySelectorAll("[data-i18n]").forEach(function (n) {
      n.textContent = T.t(n.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (n) {
      n.placeholder = T.t(n.getAttribute("data-i18n-ph"));
    });
  }
  function show(view) {
    ["view-loading", "view-setup", "view-unlock", "view-app"].forEach(function (v) {
      $(v).classList.toggle("hidden", v !== view);
    });
    if (view === "view-unlock") refreshQuickUI();
  }

  // ---- calendars ----------------------------------------------------------
  function gregFull(date) {
    // built from our own month names so fa output is always Persian,
    // regardless of the browser's installed ICU locale data
    return num(date.getDate()) + " " + T.t("gmonths")[date.getMonth()] +
      " " + num(date.getFullYear());
  }

  // ---- idle auto-lock -----------------------------------------------------
  function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    if (S.isUnlocked()) idleTimer = setTimeout(doLock, IDLE_MS);
  }

  // ---- boot / auth --------------------------------------------------------
  var bootWatchdog = null;
  async function boot() {
    show("view-loading");
    mountAuthLang();
    // If boot has not resolved in 12s the app is, from the user's side, broken.
    // Saying so beats an eternal spinner.
    if (bootWatchdog) clearTimeout(bootWatchdog);
    bootWatchdog = setTimeout(function () {
      if (!$("view-loading").classList.contains("hidden")) {
        bootFailed(new Error("timeout"));
      }
    }, 12000);
    var lc = $("view-loading");
    if (lc && !lc.querySelector(".sk-wrap")) { /* the auth card handles its own copy */ }
    // WebCrypto only exists in secure contexts (HTTPS or localhost). On a LAN
    // IP over plain http the vault cannot work — say so clearly instead of
    // failing silently at unlock.
    if (!window.crypto || !window.crypto.subtle) {
      var card = document.querySelector("#view-loading .auth-card");
      if (card) {
        card.textContent = "";
        card.appendChild(el("p", "callout callout--warn", T.t("msg_noCrypto")));
      }
      statusRaw(T.t("msg_noCrypto"), "error");
      return;
    }
    try {
      var r = await S.boot();
      if (bootWatchdog) { clearTimeout(bootWatchdog); bootWatchdog = null; }
      if (r === "unlock") { show("view-unlock"); $("unlock-pw").focus(); }
      else { show("view-setup"); $("setup-pw").focus(); }
    } catch (e) {
      // v6.3 — the bug real users hit: this used to set a status message and
      // leave the view on the spinner, so any failure (slow network, a failed
      // request, an error here) parked the user on a silent loading screen
      // with no text and no way out. Reported as "I log in and nothing
      // happens". A dead end must always say what happened and offer a way
      // forward.
      bootFailed(e);
    }
  }

  function bootFailed(err) {
    var card = document.querySelector("#view-loading .auth-card");
    show("view-loading");
    if (!card) { statusRaw(T.t("boot_failBody"), "error"); return; }
    card.textContent = "";
    card.appendChild(el("h1", "auth-title", T.t("boot_failTitle")));
    card.appendChild(el("p", "auth-sub", T.t("boot_failBody")));
    var again = el("button", "btn btn--primary", T.t("boot_retry"));
    again.type = "button";
    again.addEventListener("click", function () { boot(); });
    card.appendChild(again);
    var out = el("a", "btn btn--ghost boot-fail__out", T.t("boot_signOut"));
    out.href = "/accounts/logout/";
    card.appendChild(out);
    if (err && err.message) {
      var d = el("p", "boot-fail__d", String(err.message).slice(0, 120));
      card.appendChild(d);
    }
  }

  async function doSetup() {
    var pw = $("setup-pw").value, pw2 = $("setup-pw2").value;
    if (pw.length < MIN_LEN) return status("msg_shortMaster", "error");
    if (pw !== pw2) return status("msg_mismatch", "error");
    status("msg_building", "info");
    var sbtn = $("setup-btn");
    setBusy(sbtn, true);
    try {
      await S.setup(pw);
      $("setup-pw").value = $("setup-pw2").value = "";
      setBusy(sbtn, false);
      enterApp();
    } catch (e) { setBusy(sbtn, false); status("msg_saveFail", "error"); }
  }

  async function doUnlock() {
    var input = $("unlock-pw");
    var pw = input.value;
    var btn = $("unlock-btn");
    if (!pw) { shake(input); return; }
    status("msg_unlocking", "info");
    setBusy(btn, true);
    // KDF takes real time — show the app's skeleton so the wait has shape
    var host = $("route-view");
    if (host) { host.textContent = ""; skeleton(host); }
    try {
      await S.unlock(pw);
      input.value = "";
      setBusy(btn, false);
      enterApp();
    } catch (e) {
      setBusy(btn, false);
      shake(input);
      status("msg_wrongMaster", "error");
    }
  }

  // ---- quick unlock (device PIN) ------------------------------------------
  var QK_KEY = "sp_quick_v1", QK_FAILS = "sp_quick_fails";

  // ---- passkey unlock (WebAuthn PRF, v1.12) --------------------------------
  // Same shape as the PIN quick-unlock, but the wrapping secret comes from
  // the platform authenticator (Touch ID / Face / Windows Hello) via the PRF
  // extension instead of a typed PIN. Entirely local: no server ceremony, no
  // credential ever leaves the device, zero-knowledge intact. Browsers
  // without PRF just don't see the feature (feature-detected, PIN remains).
  var PK_KEY = "sp_passkey_v1";
  function pkBlob() {
    try { return JSON.parse(localStorage.getItem(PK_KEY) || "null"); }
    catch (e) { return null; }
  }
  function pkEnabled() { return !!pkBlob(); }
  function pkWipe() { localStorage.removeItem(PK_KEY); }
  async function pkSupported() {
    if (!window.PublicKeyCredential ||
        !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return false;
    try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
    catch (e) { return false; }
  }
  function pkRnd(n) {
    var b = new Uint8Array(n); crypto.getRandomValues(b); return b;
  }
  function pkB64u(bytes) {
    var s = ""; bytes = new Uint8Array(bytes);
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function pkB64uDec(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  async function pkPrfSecret(credIdB64u, salt) {
    // One get() ceremony: the authenticator verifies the user (biometric)
    // and evaluates PRF(salt) → our 32-byte wrapping secret.
    var cred = await navigator.credentials.get({
      publicKey: {
        challenge: pkRnd(32),          // local-only; nothing is sent anywhere
        allowCredentials: [{ type: "public-key", id: pkB64uDec(credIdB64u) }],
        userVerification: "required",
        timeout: 60000,
        extensions: { prf: { eval: { first: salt } } },
      },
    });
    var res = cred.getClientExtensionResults();
    var first = res && res.prf && res.prf.results && res.prf.results.first;
    if (!first) throw new Error("no_prf");
    return new Uint8Array(first);
  }
  async function pkEnable() {
    var uname = (document.querySelector('meta[name="username"]') || {}).content || "aegis";
    var cred = await navigator.credentials.create({
      publicKey: {
        challenge: pkRnd(32),
        rp: { id: location.hostname, name: "Aegis Planner" },
        user: { id: pkRnd(16), name: uname, displayName: uname },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },    // ES256
          { type: "public-key", alg: -257 },  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required",
        },
        timeout: 60000,
        extensions: { prf: {} },
      },
    });
    var ext = cred.getClientExtensionResults();
    if (!(ext && ext.prf && ext.prf.enabled)) throw new Error("no_prf");
    var credId = pkB64u(cred.rawId);
    var salt = pkRnd(32);
    var secret = await pkPrfSecret(credId, salt);
    var blob = await C.rawWrap(secret, S.getDekRaw());
    localStorage.setItem(PK_KEY, JSON.stringify({
      credId: credId, salt: pkB64u(salt), iv: blob.iv, ct: blob.ct,
    }));
  }
  async function pkUnlock() {
    var b = pkBlob();
    if (!b) return;
    statusRaw(T.t("msg_unlocking"), "info");
    try {
      var secret = await pkPrfSecret(b.credId, pkB64uDec(b.salt));
      var dekRaw = await C.rawUnwrap(secret, { iv: b.iv, ct: b.ct });
      await S.unlockWithRaw(dekRaw);
      enterApp();
    } catch (e) {
      // A cancelled biometric prompt is not an error state worth shouting
      // about; a genuinely broken blob is.
      if (e && (e.name === "NotAllowedError" || e.name === "AbortError")) return statusRaw("", "info");
      statusRaw(T.t("pk_failed"), "error");
    }
  }
  function quickBlob() {
    try { return JSON.parse(localStorage.getItem(QK_KEY) || "null"); }
    catch (e) { return null; }
  }
  function quickEnabled() { return !!quickBlob(); }
  function quickWipe() {
    localStorage.removeItem(QK_KEY);
    localStorage.removeItem(QK_FAILS);
  }
  function refreshQuickUI() {
    var box = $("quick-unlock");
    if (!box) return;
    box.classList.toggle("hidden", !quickEnabled());
  }
  async function doQuickUnlock() {
    var blob = quickBlob();
    if (!blob) return;
    var pin = $("qk-pin").value.trim();
    if (!/^\d{4,8}$/.test(pin)) { status("qk_short", "error"); return; }
    status("msg_unlocking", "info");
    try {
      var dekRaw = await C.pinUnwrap(pin, blob);
      $("qk-pin").value = "";
      localStorage.removeItem(QK_FAILS);
      await S.unlockWithRaw(dekRaw);
      enterApp();
    } catch (e) {
      var n = (parseInt(localStorage.getItem(QK_FAILS) || "0", 10) || 0) + 1;
      localStorage.setItem(QK_FAILS, String(n));
      if (n >= 5) { quickWipe(); refreshQuickUI(); statusRaw(T.t("qk_wiped"), "error"); }
      else status("qk_wrong", "error");
    }
  }

  function archiveOldTasks() {
    var cutoff = Date.now() - 90 * 86400000;
    var ts = S.vault.tasks || [];
    if (!S.vault.archive) S.vault.archive = [];
    var keep = [], moved = 0;
    ts.forEach(function (x) {
      if (x.done && x.doneAt && new Date(x.doneAt).getTime() < cutoff) {
        S.vault.archive.push(x);
        moved++;
      } else keep.push(x);
    });
    if (moved) {
      S.vault.tasks = keep;
      persist();
    }
  }

  // FA/EN switch on the setup + unlock cards, so the very first screen a new
  // user sees can be read in their language (Settings is behind the vault).
  function mountAuthLang() {
    document.querySelectorAll("#view-setup .auth-card, #view-unlock .auth-card")
      .forEach(function (card) {
        if (card.querySelector(".auth-lang")) return;
        var b = el("button", "btn btn--ghost btn--sm auth-lang",
          T.lang === "en" ? "فارسی" : "English");
        b.type = "button";
        b.addEventListener("click", function () {
          var next = T.lang === "en" ? "fa" : "en";
          switchLang(next, function () {
            translatePage();
            document.querySelectorAll(".auth-lang").forEach(function (n) {
              n.textContent = next === "en" ? "فارسی" : "English";
            });
          });
        });
        card.insertBefore(b, card.firstChild);
      });
  }

  // A skeleton of the layout beats a blank stare: it turns "slow" into
  // "loading", and the user's eye already knows where things will land.
  function skeleton(host) {
    // single source of truth for loading states (v1.13.3)
    window.UI.skeleton(host);
  }

  // v4.8 (فاز F): a persistent banner shown when the subscription has lapsed and
  // the vault is open in read-only mode. Mounted once, at the top of the shell.
  function mountReadOnlyBanner() {
    if (!(window.ZKStore && window.ZKStore.isReadOnly && window.ZKStore.isReadOnly())) return;
    document.body.classList.add("is-readonly");
    var app = $("view-app");
    if (!app || app.querySelector(".ro-banner")) return;
    var bn = el("div", "ro-banner");
    bn.setAttribute("role", "status");
    bn.appendChild(icn("warn", "ro-banner__ic"));
    var txt = el("div", "ro-banner__txt");
    txt.appendChild(el("strong", "ro-banner__t", T.t("ro_banner")));
    txt.appendChild(el("span", "ro-banner__s", T.t("ro_renew")));
    bn.appendChild(txt);
    // v4.9: the banner now leads somewhere. Telling someone their access is
    // frozen without a way to fix it is half a message.
    var go = el("a", "btn btn--primary btn--sm ro-banner__go", T.t("ro_renewBtn"));
    go.href = "/accounts/subscribe/";
    bn.appendChild(go);
    app.insertBefore(bn, app.firstChild);
  }

  function enterApp() {
    status("");
    archiveOldTasks();
    show("view-app");
    mountReadOnlyBanner();
    maybeWelcome();
    if (!location.hash) location.hash = "#/dashboard";
    renderRoute();
    resetIdle();
    if (window.Notifs) window.Notifs.start();
    // the moment the vault opens: a brief unlock flourish over the whole app
    if (!window.FX.reduced()) {
      var app = $("view-app");
      app.classList.remove("fx-unlock");
      void app.offsetWidth;
      app.classList.add("fx-unlock");
      app.addEventListener("animationend", function () {
        app.classList.remove("fx-unlock");
      }, { once: true });
      window.FX.haptic("soft");
    }
  }

  // Global dialog accessibility: any overlay added to the DOM (feedback,
  // delete-account, export, notification pop, etc.) gets proper dialog
  // semantics, initial focus, and Escape-to-close — without editing each
  // call site. Overlays that manage their own keys (ui-dialog, cmdk) opt out.
  (function initOverlayA11y() {
    function enhance(node) {
      if (node.nodeType !== 1) return;
      if (!node.classList || !node.classList.contains("overlay")) return;
      if (node.classList.contains("ui-dialog")) return; // handles its own a11y
      var card = node.querySelector(".overlay__card") || node;
      if (!card.getAttribute("role")) {
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-modal", "true");
        var title = card.querySelector(".panel__title, h1, h2");
        if (title) {
          if (!title.id) title.id = "ov-t-" + Math.random().toString(36).slice(2, 8);
          card.setAttribute("aria-labelledby", title.id);
        }
      }
      // initial focus → first input, else first button
      var focusTarget = card.querySelector("input, textarea, select") ||
        card.querySelector("button");
      if (focusTarget) { try { focusTarget.focus(); } catch (e) {} }

      // v1.8.3 — on a phone every overlay is a sheet, and every sheet can be
      // dragged away with the thumb. Wired centrally, so any dialog the app
      // ever adds inherits the gesture for free.
      window.FX.draggableSheet(card, function () {
        // Two kinds of overlay exist: persistent ones that live in the DOM and
        // are toggled with .hidden, and transient ones that are created and
        // removed. Dismissing must do the right thing for both.
        if (node.id) node.classList.add("hidden");
        else if (node.parentElement) node.remove();
        card.style.transform = "";
        node.style.opacity = "";
        document.body.classList.remove("no-scroll");
      });
    }
    var mo = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, enhance);
      });
    });
    mo.observe(document.body, { childList: true });
    // Escape closes the top-most simple overlay
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var overlays = document.querySelectorAll(".overlay:not(.ui-dialog)");
      if (!overlays.length) return;
      var top = overlays[overlays.length - 1];
      // let inputs with their own handlers (cmdk) manage themselves
      if (top.classList.contains("cmdk-ov")) return;
      var cancel = top.querySelector(".overlay__actions .btn--ghost");
      if (cancel) cancel.click(); else top.remove();
    });
  })();

  function doLock() {
    S.lock();
    if (idleTimer) clearTimeout(idleTimer);
    closeOverlay("editor"); closeOverlay("rekey"); closeSidebar();
    if (S.initialized) { show("view-unlock"); $("unlock-pw").focus(); }
  }

  // ---- routing ------------------------------------------------------------
  function currentRoute() {
    var h = (location.hash || "").replace("#/", "");
    return ROUTES.indexOf(h) >= 0 ? h : "dashboard";
  }
  /* v5.3 — records a task slipping to another day. Rescheduling happens via
   * the editor, "→ tomorrow", and calendar drag; all three call this or the
   * report would miss most slipping. Callers confirm the day changed. */
  function noteReschedule(task) {
    if (!task) return;
    task.moves = (task.moves || 0) + 1;
    task.movedAt = new Date().toISOString();
  }

  /* v5.4 — only the active dictionary is on the page, so a switch must FETCH
   * the other before rendering, or t() returns raw keys. All three switch
   * points route through here so none can forget. */
  function switchLang(next, after) {
    var docEl = document.documentElement;
    T.load(next, function () {
      setPref("sp_lang", next);
      T.set(next);
      docEl.setAttribute("lang", next);
      docEl.setAttribute("dir", next === "en" ? "ltr" : "rtl");
      cal.y = 0; cal.m = 0;   // "auto" calendar system follows the language
      try {
        document.cookie = "ui_lang=" + next +
          ";path=/;max-age=31536000;samesite=Lax" +
          (location.protocol === "https:" ? ";secure" : "");
      } catch (e) {}
      if (after) after();
    });
  }

  function renderRoute() {
    if (!S.isUnlocked()) return;
    var r = currentRoute();
    $("page-title").textContent = T.t("nav_" + r);
    document.querySelectorAll("#nav a, #bottom-nav a").forEach(function (a) {
      var on = a.getAttribute("data-route") === r;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    var host = $("route-view");
    host.className = "route-view route--" + r;
    // v4.0.1: the calendar is the only route that needs the shell pinned to
    // the viewport (see .shell rule); every other route scrolls normally.
    document.documentElement.classList.toggle("cal-route", r === "calendar");
    host.setAttribute("role", "main");
    host.setAttribute("aria-live", "polite");
    host.textContent = "";
    try {
      dispatchRoute(r, host);
    } catch (err) {
      renderRouteError(host, err);
    }
    // page transition: the view fades/slides in, then its top-level panels
    // rise in sequence. Both are no-ops under prefers-reduced-motion.
    // v1.8.3 audit: a route change is a dozens-of-times-a-day action. The
    // staggered rise made the app FEEL slower than it is. A 160ms opacity
    // fade is all that survives — enough to avoid a jarring swap, cheap
    // enough to never be in the user's way.
    // v3.1: play the entrance ONLY when the route actually changed. It used to
    // replay on every re-render, so ticking a checkbox faded the entire page —
    // 160ms of the screen going pale on an action that should feel instant.
    // The forced reflow (offsetWidth) is now paid once per navigation instead
    // of once per interaction.
    if (!window.FX.reduced() && r !== lastRenderedRoute) {
      host.classList.remove("route-view--in");
      void host.offsetWidth;
      host.classList.add("route-view--in");
    }
    lastRenderedRoute = r;
    closeSidebar();
  }

  // Route dispatch table — clearer than a long if/else chain and shared by the
  // error boundary above.
  function dispatchRoute(r, host) {
    var views = {
      dashboard: renderDashboard, calendar: renderCalendar, notes: renderNotes,
      settings: renderSettings, help: renderHelp,
      tasks: window.TasksView.render,
      habits: window.HabitsView.render,
      review: window.ReviewView.render, tags: window.TagsView.render,
      search: window.SearchView.render,
      more: renderMore,
    };
    // v3.5: the journal merged into notes; the old address forwards there
    // v3.5/v3.6: journal and lists merged into notes; old addresses forward
    if (r === "journal" || r === "lists") { location.hash = "#/notes"; return; }
    var fn = views[r];
    if (fn) { fn(host); return; }
    if (LAZY_VIEWS[r]) { renderLazy(r, host); return; }
    renderStub(host);
  }

  // Production error boundary: a view crash shows a recoverable panel instead
  // of a blank screen. The vault stays safe (nothing is mutated on read).
  /* v6.0 — routes that arrive when you ask for them.
   *
   * Measured with real <script> tags: the app parses, compiles and executes
   * 540 KB across 28 files before it can show anything — 176 ms on a desktop,
   * so roughly 700 ms to 1 s on a mid-range phone. Five of those modules are
   * reachable ONLY from their own route (verified: they appear nowhere in the
   * app except the route table and their init call), and most sessions never
   * open them. Dropping them from the first load takes the parse cost to
   * 101 ms — about 75 ms saved on a desktop and an estimated 300–450 ms on a
   * phone, on every single app open.
   *
   * Modules the dashboard reads from — habits and review — are deliberately
   * NOT in this list even though they have their own routes: the dashboard
   * calls into them on first paint, so deferring them would trade a fast boot
   * for an empty dashboard. That is not a trade worth making.
   */
  var LAZY_VIEWS = {
    kanban:  { file: "kanban.js",   global: "KanbanView" },
    reports: { file: "reports.js",  global: "ReportsView" },
    focus:   { file: "pomodoro.js", global: "FocusView" },
    goals:   { file: "goals.js",    global: "GoalsView" },
    trash:   { file: "trash.js",    global: "TrashView" },
  };
  var lazyLoaded = {}, lazyLoading = {};
  var lazyCtx = function () { return null; };

  function loadLazyView(route) {
    var spec = LAZY_VIEWS[route];
    if (!spec) return Promise.reject(new Error("unknown view " + route));
    if (window[spec.global] && lazyLoaded[route]) return Promise.resolve();
    if (lazyLoading[route]) return lazyLoading[route];

    lazyLoading[route] = new Promise(function (resolve, reject) {
      // The URL comes from the page, where Django resolved it through the
      // static manifest. Building it here would work in development and 404
      // in production, where filenames are content-hashed.
      var meta = document.querySelector('meta[name="lazy-' + route + '"]');
      if (!meta || !meta.content) {
        reject(new Error("no url for " + route)); return;
      }
      var el0 = document.createElement("script");
      el0.src = meta.content;
      el0.defer = false;
      el0.onload = function () {
        var mod = window[spec.global];
        if (!mod) { reject(new Error("loaded but missing " + spec.global)); return; }
        // the module has never been initialised, since boot skipped it
        if (mod.init && !lazyLoaded[route]) mod.init(lazyCtx());
        lazyLoaded[route] = true;
        resolve();
      };
      el0.onerror = function () { reject(new Error("failed to load " + spec.file)); };
      document.head.appendChild(el0);
    });
    // a failed load must not poison the route forever: clear the latch so the
    // next visit tries again
    lazyLoading[route]["catch"](function () { lazyLoading[route] = null; });
    return lazyLoading[route];
  }

  function renderLazy(route, host) {
    var spec = LAZY_VIEWS[route];
    if (window[spec.global] && lazyLoaded[route]) {
      window[spec.global].render(host);
      return;
    }
    skeleton(host);            // the wait has shape, same as unlock
    loadLazyView(route).then(function () {
      // the user may have navigated on while this was in flight
      if (currentRoute() !== route) return;
      host.textContent = "";
      window[spec.global].render(host);
    })["catch"](function (err) {
      if (currentRoute() !== route) return;
      renderRouteError(host, err);
    });
  }

  /* ================================================================
   * v6.6 — «بیشتر» یک مقصد است، نه کشو
   *
   * On a phone this button opened the desktop sidebar: a tall column of
   * fourteen text links, which is exactly the clutter testers bounced off.
   * A drawer of leftovers also tells you nothing about what the app can do.
   *
   * As a real screen it can group things by what they are for, give each
   * one a target you can hit without aiming, and let someone who just
   * arrived read the whole product in one scroll.
   * ================================================================ */
  var MORE_GROUPS = [
    ["more_gPlan",  [["kanban", "kanban"], ["goals", "goals"], ["habits", "habits"]]],
    ["more_gWrite", [["notes", "notes"], ["review", "review"], ["tags", "tags"]]],
    ["more_gLook",  [["reports", "reports"], ["focus", "focus"], ["search", "search"]]],
    ["more_gApp",   [["settings", "settings"], ["trash", "trash"], ["help", "help"]]],
  ];

  /* ================================================================
   * v6.6 — سه جمله در اولین ورود
   *
   * Testers said the same thing in different words: "I got in and I didn't
   * know what to do". Not a bug — the app simply never said what it was.
   *
   * This is deliberately not a product tour. Tours are skipped, and the ones
   * that are not are forgotten by the second screen. It is three sentences
   * on one card: what this is, where things go, and the one promise that
   * matters. Then it gets out of the way and never returns.
   *
   * It is stored per device, not in the vault: it is a fact about this
   * browser, not about the person, and a synced flag would mean someone
   * opening Aegis on a new phone gets no welcome at all.
   * ================================================================ */
  var WELCOME_KEY = "sp_welcomed";

  function maybeWelcome() {
    if (!isPhone()) return;              // desktop has the room to explain itself
    if (pref(WELCOME_KEY, "")) return;
    var host = $("view-app");
    if (!host || host.querySelector(".wl-card")) return;

    var card = el("div", "wl-card");
    card.setAttribute("role", "note");
    card.appendChild(icn("logo", "wl-card__mark"));
    card.appendChild(el("h2", "wl-card__t", T.t("wl_t")));

    [["wl_1", "sun"], ["wl_2", "plus"], ["wl_3", "key"]].forEach(function (o) {
      var r = el("div", "wl-row");
      r.appendChild(icn(o[1], "wl-row__ic"));
      r.appendChild(el("span", "wl-row__x", T.t(o[0])));
      card.appendChild(r);
    });

    var go = el("button", "btn btn--primary wl-card__go", T.t("wl_go"));
    go.type = "button";
    go.addEventListener("click", function () {
      setPref(WELCOME_KEY, "1");
      card.classList.add("wl-card--out");
      setTimeout(function () { if (card.parentNode) card.remove(); }, 200);
    });
    card.appendChild(go);
    host.insertBefore(card, host.firstChild);
  }

  function renderMore(host) {
    host.appendChild(el("h1", "mr-title", T.t("nav_more")));
    MORE_GROUPS.forEach(function (g) {
      var sec = el("section", "mr-sec");
      sec.appendChild(el("div", "mr-sec__t", T.t(g[0])));
      var grid = el("div", "mr-grid");
      g[1].forEach(function (o) {
        var a = el("a", "mr-tile");
        a.href = "#/" + o[0];
        a.appendChild(icn(o[1], "mr-tile__ic"));
        a.appendChild(el("span", "mr-tile__l", T.t("nav_" + o[0])));
        grid.appendChild(a);
      });
      sec.appendChild(grid);
      host.appendChild(grid.children.length ? sec : el("span"));
    });

    /* The one line about privacy that belongs in the app itself. The detail
     * lives on its own page — people who want the algorithm can go and read
     * it, and everyone else just needs to know the promise. */
    var pr = el("a", "mr-privacy");
    // /about/ is the existing "how is this secure?" page — the detail lives
    // there rather than being scattered through the app, and building a second
    // one would have split the same explanation across two places.
    pr.href = "/about/";
    pr.appendChild(icn("key", "mr-privacy__ic"));
    var pb = el("div", "mr-privacy__b");
    pb.appendChild(el("strong", "mr-privacy__t", T.t("more_privT")));
    pb.appendChild(el("span", "mr-privacy__s", T.t("more_privS")));
    pr.appendChild(pb);
    host.appendChild(pr);
  }

  function renderRouteError(host, err) {
    if (window.console && console.error) console.error("[route error]", err);
    host.textContent = "";
    var p = el("div", "panel err-boundary");
    p.appendChild(elIc("h2", "panel__title", "warn", T.t("err_title")));
    p.appendChild(el("p", "panel__text", T.t("err_body")));
    var row = el("div", "overlay__actions");
    var reload = el("button", "btn btn--primary btn--sm", T.t("err_reload"));
    reload.addEventListener("click", function () { location.reload(); });
    var home = el("button", "btn btn--ghost btn--sm", T.t("nav_dashboard"));
    home.addEventListener("click", function () { location.hash = "#/dashboard"; });
    row.appendChild(reload); row.appendChild(home);
    p.appendChild(row);
    host.appendChild(p);
  }

  function renderStub(host) {
    var p = el("div", "panel");
    p.appendChild(el("p", "panel__text", T.t("comingSoon")));
    host.appendChild(p);
  }

  // ---- dashboard ----------------------------------------------------------
  function isoDay(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }
  function sleepRing(hours) {
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 44 44");
    svg.setAttribute("class", "wl-ring");
    var bg = document.createElementNS(NS, "circle");
    bg.setAttribute("cx", 22); bg.setAttribute("cy", 22); bg.setAttribute("r", 18);
    bg.setAttribute("class", "wl-ring__bg");
    svg.appendChild(bg);
    var pct = Math.max(0, Math.min(1, hours / 8));
    var circ = 2 * Math.PI * 18;
    var fg = document.createElementNS(NS, "circle");
    fg.setAttribute("cx", 22); fg.setAttribute("cy", 22); fg.setAttribute("r", 18);
    fg.setAttribute("class", "wl-ring__fg");
    fg.setAttribute("stroke-dasharray", (pct * circ) + " " + circ);
    fg.setAttribute("transform", "rotate(-90 22 22)");
    svg.appendChild(fg);
    var tx = document.createElementNS(NS, "text");
    tx.setAttribute("x", 22); tx.setAttribute("y", 26);
    tx.setAttribute("text-anchor", "middle");
    tx.setAttribute("class", "wl-ring__t");
    tx.textContent = hours ? num(hours) : "—";
    svg.appendChild(tx);
    return svg;
  }

  // ---- productivity score (honest: points for real completed work) --------
  function calcScore() {
    var v = S.vault, pts = 0, br = { task: 0, habit: 0, pomo: 0, journal: 0, goal: 0 };
    (v.tasks || []).forEach(function (x) {
      if (x.done) { br.task += x.pr === "high" ? 15 : 10; }
    });
    (v.archive || []).forEach(function (x) {
      if (x.done) { br.task += x.pr === "high" ? 15 : 10; }
    });
    (v.habits || []).forEach(function (h) {
      Object.keys(h.log || {}).forEach(function () { br.habit += 5; });
    });
    var pl = (v.settings && v.settings.pomoLog) || {};
    Object.keys(pl).forEach(function (k) { br.pomo += (pl[k] || 0) * 20; });
    br.journal = (v.notes || []).filter(function (n) { return n.jdate; }).length * 5;
    (v.goals || []).forEach(function (G) {
      br.goal += (G.ms || []).filter(function (m) { return m.done; }).length * 15;
      if (G.reached) {
        // reaching a goal is a real achievement — worth far more than a task
        br.goal += G.horizon === "long" ? 400 : (G.horizon === "year" ? 250 : 120);
      }
    });
    pts = br.task + br.habit + br.pomo + br.journal + br.goal;
    return { total: pts, level: Math.floor(pts / 500) + 1, br: br };
  }


  // =====================================================================
  // v2.6 — فاز N7: "Today"
  //
  // The page you open in the morning and close at night. Everything here
  // answers one of three questions: what is happening now, what still needs
  // me, and how was the day. Anything that answers a different question
  // belongs on another route.
  // =====================================================================

  function todayJ() {
    var n = new Date();
    return J.toJalaali(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }

  // ---- the day, in order, with a "now" marker --------------------------
  function todayTimeline(host) {
    var j = todayJ();
    var day = { jy: j.jy, jm: j.jm, jd: j.jd };
    var timed = (S.vault.tasks || []).filter(function (x) {
      return !x.archived && x.due && sameDay(x.due, day) && x.timeFrom;
    }).sort(function (a, b) { return String(a.timeFrom).localeCompare(String(b.timeFrom)); });

    var untimed = (S.vault.tasks || []).filter(function (x) {
      return !x.archived && !x.done && x.due && sameDay(x.due, day) && !x.timeFrom;
    });

    if (!timed.length && !untimed.length) return;

    var now = new Date();
    var mins = now.getHours() * 60 + now.getMinutes();
    var p = el("div", "panel td-panel");
    p.appendChild(elIc("h2", "panel__title", "calendar", T.t("td_today")));

    var line = el("div", "td-line");
    var nowPlaced = false;
    timed.forEach(function (x) {
      var parts = String(x.timeFrom).split(":");
      var m = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
      if (!nowPlaced && m > mins) {
        line.appendChild(nowMarker());
        nowPlaced = true;
      }
      line.appendChild(todayRow(x, true));
    });
    if (!nowPlaced && timed.length) line.appendChild(nowMarker());
    untimed.forEach(function (x) { line.appendChild(todayRow(x, false)); });
    p.appendChild(line);
    host.appendChild(p);
  }

  function nowMarker() {
    var n = new Date();
    var w = el("div", "td-now");
    w.appendChild(el("span", "td-now__t",
      num(String(n.getHours()).padStart(2, "0") + ":" + String(n.getMinutes()).padStart(2, "0"))));
    w.appendChild(el("span", "td-now__line"));
    return w;
  }

  function todayRow(x, timed) {
    var r = el("div", "td-row" + (x.done ? " td-row--done" : "") +
      (x.kind === "event" ? " td-row--event" : ""));
    var time = el("span", "td-row__time");
    time.textContent = timed ? num(x.timeFrom) : "—";
    r.appendChild(time);

    if (x.kind !== "event") {
      var chk = el("input"); chk.type = "checkbox";
      chk.className = "task-check"; chk.checked = !!x.done;
      chk.addEventListener("change", async function () {
        x.done = chk.checked;
        x.doneAt = chk.checked ? new Date().toISOString() : null;
        if (chk.checked && window.FX) window.FX.confetti(chk);
        renderRoute(); persistBg();
      });
      r.appendChild(chk);
    } else {
      var ev = el("span", "td-row__ev");
      ev.appendChild(icn("calendar"));
      r.appendChild(ev);
    }

    var body = el("button", "td-row__main");
    body.type = "button";
    body.appendChild(el("span", "td-row__title", x.title));
    body.addEventListener("click", function () { window.TasksView.openById(x.id); });
    r.appendChild(body);
    if (window.TaskColor.isCustom(x.color)) r.style.setProperty("--tc", x.color);
    else r.classList.add(window.TaskColor.cls(x.color));
    return r;
  }

  // ---- habits, only the ones that still want something today -----------
  function todayHabits(host) {
    var hs = (S.vault.habits || []).filter(function (h) { return !h.archived; });
    if (!hs.length) return;
    var key = (function (d) {
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
        "-" + String(d.getDate()).padStart(2, "0");
    })(new Date());

    var p = el("div", "panel");
    var head = el("div", "sp-card__top");
    head.appendChild(elIc("h2", "panel__title", "habits", T.t("td_habits")));
    var doneN = hs.filter(function (h) { return h.log && h.log[key]; }).length;
    head.appendChild(el("span", "badge", num(doneN) + "/" + num(hs.length)));
    p.appendChild(head);

    var row = el("div", "td-habits");
    hs.forEach(function (h) {
      var on = !!(h.log && h.log[key]);
      var b = el("button", "td-hab" + (on ? " td-hab--on" : ""));
      b.type = "button";
      var dot = el("span", "td-hab__dot");
      if (on) dot.appendChild(icn("check"));
      b.appendChild(dot);
      b.appendChild(el("span", "td-hab__n", h.name));
      b.addEventListener("click", async function () {
        if (!h.log) h.log = {};
        if (on) delete h.log[key]; else h.log[key] = { d: 1 };
        if (window.FX && window.FX.haptic) window.FX.haptic("soft");
        renderRoute(); persistBg();
      });
      row.appendChild(b);
    });
    p.appendChild(row);
    host.appendChild(p);
  }

  // ---- the evening question --------------------------------------------
  // Shown only in the evening and only if today has no journal entry yet.
  // A prompt that appears every hour is nagging; one that appears once, at
  // the right time, is a ritual.
  function eveningCheckin(host) {
    var now = new Date();
    if (now.getHours() < 17) return;
    var iso = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") +
      "-" + String(now.getDate()).padStart(2, "0");
    /* v3.5: journal entries are notes in the «ژورنال» folder with a jdate */
    var has = (S.vault.notes || []).some(function (n) { return n.jdate === iso; });
    if (has) return;

    var p = el("div", "panel td-check");
    p.appendChild(el("h2", "panel__title", T.t("td_evening")));
    p.appendChild(el("p", "panel__text", T.t("td_eveningSub")));
    var moods = el("div", "td-moods");
    ["mood-0", "mood-1", "mood-2", "mood-3", "mood-4"].forEach(function (m, i) {
      var b = el("button", "td-mood");
      b.type = "button";
      b.title = T.t("mood_" + i);
      b.appendChild(icn(m));
      b.addEventListener("click", async function () {
        if (!S.vault.notes) S.vault.notes = [];
        S.vault.notes.push({
          id: "n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          title: iso, body: "", html: "",
          folder: "ژورنال", mood: i, jdate: iso,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        if (window.FX && window.FX.haptic) window.FX.haptic("soft");
        status("msg_saved", "success"); renderRoute(); persistBg();
      });
      moods.appendChild(b);
    });
    p.appendChild(moods);
    host.appendChild(p);
  }


  // =====================================================================
  // v2.8 — the quiet signature.
  //
  // The footer says "made with ♥" and nothing else. Whoever is curious
  // enough to press the heart gets a terminal that types one name and stops.
  // No link, no bio, no photo — the credit is there for the person who looks
  // for it, and invisible to everyone else.
  // =====================================================================
  function initWhoami() {
    var btn = $("made-with");
    var box = $("whoami");
    var out = $("whoami-out");
    if (!btn || !box || !out) return;

    var LINES = [
      { txt: "$ whoami", pause: 420 },
      { txt: "Sepehr", pause: 0, quiet: true },
    ];

    var typing = null;
    function close() {
      if (typing) { clearTimeout(typing); typing = null; }
      box.classList.add("hidden");
      out.textContent = "";
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    function run() {
      out.textContent = "";
      box.classList.remove("hidden");
      document.addEventListener("keydown", onKey);

      // someone who asked for less motion gets the answer immediately
      if (window.FX && window.FX.reduced()) {
        out.textContent = LINES.map(function (l) { return l.txt; }).join("\n");
        out.appendChild(el("span", "term__cur"));
        return;
      }

      var li = 0, ci = 0;
      var cur = el("span", "term__cur");
      function step() {
        if (li >= LINES.length) { out.appendChild(cur); typing = null; return; }
        var line = LINES[li];
        if (ci === 0 && li > 0) out.appendChild(document.createTextNode("\n"));
        if (ci < line.txt.length) {
          out.appendChild(document.createTextNode(line.txt.charAt(ci)));
          ci++;
          // slight jitter so it reads as typing, not as a machine printing
          typing = setTimeout(step, line.quiet ? 90 : 55 + Math.random() * 45);
        } else {
          li++; ci = 0;
          typing = setTimeout(step, line.pause || 260);
        }
      }
      step();
    }

    btn.addEventListener("click", run);
    box.addEventListener("click", close);
  }

  /* ================================================================
   * v6.5 — «امروز» روی گوشی
   *
   * The desktop dashboard opens with a greeting, a clock and four counters.
   * On a phone that is the wrong screen: testers said they did not know
   * where to start, and a counter is not something you can act on. "You
   * have 7 open tasks" tells someone a number; it does not tell them what
   * today is.
   *
   * So the phone gets its own home: the actual things that are due today,
   * in a list you can tick. Nothing else. The desktop dashboard is
   * untouched — it has the room for an overview and people use it
   * differently there.
   * ================================================================ */
  var phoneQuery = window.matchMedia ? window.matchMedia("(max-width: 820px)") : null;
  function isPhone() { return !!(phoneQuery && phoneQuery.matches); }

  function renderToday(host) {
    var now = new Date();
    var jt = J.toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());
    var uname = (document.querySelector('meta[name="acct-name"]') || {}).content ||
      (document.querySelector('meta[name="username"]') || {}).content || "";

    // ---- the date, stated once and plainly ----
    var head = el("div", "td-head");
    // the same greeting the desktop uses, so the two homes speak with one voice
    var hr = now.getHours();
    var gk = hr < 5 ? "greet_night" : hr < 12 ? "greet_morning"
      : hr < 17 ? "greet_afternoon" : hr < 21 ? "greet_evening" : "greet_night";
    var disp = CS.jToDisp(jt);
    var dateTxt = num(disp.d) + " " + CS.monthName(disp.m) + " " + num(disp.y);
    head.appendChild(el("div", "td-date", dateTxt));
    head.appendChild(el("h1", "td-hello",
      T.t(gk) + (uname ? "، " + uname : "")));
    host.appendChild(head);

    // ---- what is actually on today ----
    var items = (S.vault.tasks || []).filter(function (x) {
      return !x.done && !x.archived && x.due &&
             x.due.jy === jt.jy && x.due.jm === jt.jm && x.due.jd === jt.jd;
    }).sort(function (a, b) {
      return (a.timeFrom || "99:99").localeCompare(b.timeFrom || "99:99");
    });

    var overdue = (S.vault.tasks || []).filter(function (x) {
      if (x.done || x.archived || !x.due) return false;
      return jCompare(x.due, jt) < 0;
    });

    if (!items.length && !overdue.length) {
      host.appendChild(todayEmpty());
    } else {
      if (overdue.length) {
        host.appendChild(todaySection("td_overdue", overdue.slice(0, 20), true));
      }
      if (items.length) {
        host.appendChild(todaySection("td_due", items, false));
      }
    }

    // ---- habits, only if the person keeps any ----
    var habits = (S.vault.habits || []).filter(function (h) { return !h.archived; });
    if (habits.length && window.HabitsView && window.HabitsView.stripFor) {
      var hs = window.HabitsView.stripFor(host);
      if (hs) host.appendChild(hs);
    }
  }

  function jCompare(a, b) {
    if (a.jy !== b.jy) return a.jy - b.jy;
    if (a.jm !== b.jm) return a.jm - b.jm;
    return a.jd - b.jd;
  }

  function todaySection(titleKey, list, warn) {
    var sec = el("section", "td-sec" + (warn ? " td-sec--warn" : ""));
    var h = el("div", "td-sec__h");
    h.appendChild(el("span", "td-sec__t", T.t(titleKey)));
    h.appendChild(el("span", "td-sec__n", num(list.length)));
    sec.appendChild(h);
    list.forEach(function (x) { sec.appendChild(todayRow(x)); });
    return sec;
  }

  function todayRow(x) {
    var row = el("div", "td-row");
    row.setAttribute("data-task-id", x.id);
    var box = el("button", "td-check");
    box.type = "button";
    box.setAttribute("aria-label", T.t("markDone"));
    box.addEventListener("click", function (e) {
      e.stopPropagation();
      x.done = true; x.doneAt = new Date().toISOString();
      row.classList.add("td-row--going");
      if (window.FX && window.FX.haptic) window.FX.haptic("tick");
      setTimeout(function () { renderRoute(); }, 180);
      persistBg();
    });
    row.appendChild(box);

    var body = el("div", "td-row__b");
    body.appendChild(el("div", "td-row__t", x.title));
    if (x.timeFrom) body.appendChild(el("div", "td-row__m", x.timeFrom));
    row.appendChild(body);

    row.addEventListener("click", function () {
      if (window.TasksView && window.TasksView.openById) window.TasksView.openById(x.id);
    });
    return row;
  }

  /* An empty screen is an invitation, not a blank. This is the first thing a
   * new user sees, and testers bounced off it — so it says what this app is
   * for in one line and gives exactly one thing to do. */
  function todayEmpty() {
    var box = el("div", "td-empty");
    box.appendChild(icn("sun", "td-empty__ic"));
    box.appendChild(el("h2", "td-empty__t", T.t("td_emptyT")));
    box.appendChild(el("p", "td-empty__s", T.t("td_emptyS")));
    var go = el("button", "btn btn--primary td-empty__go", T.t("td_emptyGo"));
    go.type = "button";
    go.addEventListener("click", function () {
      if (window.TasksView && window.TasksView.openNew) window.TasksView.openNew();
      else location.hash = "#/tasks";
    });
    box.appendChild(go);
    return box;
  }

  function renderDashboard(host) {
    if (isPhone()) return renderToday(host);
    var now = new Date();
    var jt = J.toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());
    // v1.19 (فاز I): a real name beats a login handle — the optional name from
    // Settings › Account is used when present; username stays the fallback.
    var uname = (document.querySelector('meta[name="acct-name"]') || {}).content ||
      (document.querySelector('meta[name="username"]') || {}).content || "";

    // backup reminder (>7 days since last export, or never)
    var st = S.vault.settings || {};
    var lastExp = st.lastExportAt ? new Date(st.lastExportAt).getTime() : 0;
    if (!lastExp || Date.now() - lastExp > 7 * 86400000) {
      var bn = el("div", "bk-banner");
      bn.appendChild(el("span", "bk-banner__t", T.t(lastExp ? "bk_banner" : "bk_never")));
      var eb = el("button", "btn btn--primary btn--sm", T.t("exportVault"));
      eb.addEventListener("click", exportVault);
      bn.appendChild(eb);
      host.appendChild(bn);
    }

    var hi = el("div", "panel dash-hero");
    var hiTop = el("div", "dash-hero__top");
    // v4.5: the same full-screen control the calendar has — Today is the other
    // page people sit on while planning, and it deserves the same quiet.
    var dashTools = el("div", "dash-hero__tools");
    dashTools.appendChild(sidebarBtn());
    dashTools.appendChild(fullscreenBtn());
    hi.appendChild(dashTools);
    // greeting follows the clock. Persian and English divide the day
    // differently: Persian "عصر" gives way to "شب" earlier than English
    // "evening" turns to "night", so the evening→night cutoff is per-language
    // (fixes 8pm reading "عصر بخیر" instead of "شب بخیر").
    var hr = now.getHours();
    var eveEnd = T.lang === "fa" ? 19 : 22;
    var gk = hr < 5 ? "greet_night" : hr < 12 ? "greet_morning"
      : hr < 17 ? "greet_afternoon" : hr < eveEnd ? "greet_evening" : "greet_night";
    var gIcon = { greet_morning: "sun", greet_afternoon: "cloudsun", greet_evening: "dusk", greet_night: "moon" }[gk];
    hiTop.appendChild(el("h2", "panel__title dash-hero__hello",
      T.t(gk) + (uname ? (T.lang === "fa" ? "، " : ", ") + uname : "")));
    var gEl = hiTop.lastChild; gEl.appendChild(document.createTextNode(" ")); gEl.appendChild(icn(gIcon));
    var isPrem = ((document.querySelector('meta[name="premium"]') || {}).content === "1");
    if (isPrem) {
      var chip = elIc("span", "prem-chip", "star", T.t("prem_badge"));
      chip.title = T.t("prem_active");
      hiTop.appendChild(chip);
    }
    hi.appendChild(hiTop);
    // primary date in the chosen display calendar, the other system as a hint
    var dd = CS.fromDate(now);
    var dateLine = CS.weekdayFullOf(now) + " " + num(dd.d) + " " + CS.monthName(dd.m) + " " + num(dd.y);
    var alt;
    if (CS.isJalali()) {
      alt = gregFull(now);
    } else {
      alt = num(jt.jd) + " " + T.t("months")[jt.jm - 1] + " " + num(jt.jy); // intentional: the *other* calendar as a hint
    }
    var dline = el("p", "panel__text dash-hero__date", dateLine);
    dline.appendChild(el("span", "dash-hero__alt", " · " + alt));
    hi.appendChild(dline);

    // v1.19 (فاز I): a quiet live clock in the hero. It ticks on the minute,
    // not every second — a jittering second hand is noise, not polish — and it
    // stops itself as soon as the node leaves the DOM, so no timer leaks.
    var clock = el("div", "dash-clock");
    var ct = el("span", "dash-clock__t");
    clock.appendChild(ct);
    hi.appendChild(clock);
    function tick() {
      var d = new Date();
      ct.textContent = num(String(d.getHours()).padStart(2, "0")) + ":" +
        num(String(d.getMinutes()).padStart(2, "0"));
    }
    tick();
    if (dashTimer) clearInterval(dashTimer);
    dashTimer = setInterval(function () {
      if (!document.body.contains(ct)) { clearInterval(dashTimer); dashTimer = null; return; }
      tick();
    }, 20000);

    host.appendChild(hi);

    // smart overview — honest nudges, no motivation theater
    var alerts = [];
    var tj2 = J.toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());
    var todayT = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    todayTimeline(host);        // v2.6 (فاز N7)
    todayHabits(host);
    eveningCheckin(host);

    var openT = (S.vault.tasks || []).filter(function (x) { return !x.done; });
    var overdueN = 0, todayN = 0, nextUp = null, nextD = Infinity;
    openT.forEach(function (x) {
      if (!x.due) return;
      var g = J.toGregorian(x.due.jy, x.due.jm, x.due.jd);
      var dd = new Date(g.gy, g.gm - 1, g.gd);
      var diff = Math.round((dd - todayT) / 86400000);
      if (diff < 0) overdueN++;
      else if (diff === 0) todayN++;
      else if (diff < nextD) { nextD = diff; nextUp = x; }
    });
    if (overdueN) alerts.push(["focus", num(overdueN) + " " + T.t("ov_overdue"), "#/tasks", "ov-row--danger"]);
    if (todayN) alerts.push(["tasks", num(todayN) + " " + T.t("ov_today"), "#/tasks", ""]);
    if (nextUp && nextD <= 7) alerts.push(["calendar",
      T.t("ov_next") + ": «" + nextUp.title + "» — " + num(nextD) + " " + T.t("daysLeft"),
      "#/tasks", nextD <= 2 ? "ov-row--warn" : ""]);
    var hd0 = window.HabitsView.doneToday();
    if (hd0.total && hd0.done < hd0.total) {
      alerts.push(["habits", num(hd0.total - hd0.done) + " " + T.t("ov_habits"), "#/habits", ""]);
    }
    (S.vault.goals || []).forEach(function (G) {
      if (!G.deadline) return;
      var gg = J.toGregorian(G.deadline.jy, G.deadline.jm, G.deadline.jd);
      var dl = Math.round((new Date(gg.gy, gg.gm - 1, gg.gd) - todayT) / 86400000);
      var doneMs = (G.ms || []).filter(function (m) { return m.done; }).length;
      if (dl >= 0 && dl <= 14 && doneMs < (G.ms || []).length) {
        alerts.push(["goals", T.t("ov_goal") + " «" + G.title + "» — " + num(dl) + " " + T.t("daysLeft"),
          "#/goals", dl <= 3 ? "ov-row--warn" : ""]);
      }
    });
    var ov = el("div", "panel");
    ov.appendChild(el("h2", "panel__title", T.t("ov_title")));
    if (!alerts.length) {
      ov.appendChild(elIc("p", "panel__text ov-clear", "check", T.t("ov_clear")));
    } else {
      alerts.slice(0, 6).forEach(function (a) {
        var row = el("a", "ov-row " + a[3]);
        row.href = a[2];
        var ic0 = el("span", "ov-row__ic"); ic0.appendChild(icn(a[0])); row.appendChild(ic0);
        row.appendChild(el("span", "ov-row__t", a[1]));
        ov.appendChild(row);
      });
    }
    var pri = window.ReviewView.currentPriorities();
    if (pri) {
      pri.forEach(function (p, i) {
        var row = el("a", "ov-row");
        row.href = "#/review";
        var icp = el("span", "ov-row__ic"); icp.appendChild(icn("goals")); row.appendChild(icp);
        row.appendChild(el("span", "ov-row__t", T.t("ov_prio") + " " + num(i + 1) + ": " + p));
        ov.appendChild(row);
      });
    }
    host.appendChild(ov);

    // Today's goal — a single daily focus, separate from tasks. Shows the saved
    // goal as clear text (with edit/clear) so it's obvious it persisted.
    (function () {
      if (!S.vault.settings) S.vault.settings = {};
      if (!S.vault.settings.dayGoals) S.vault.settings.dayGoals = {};
      var key = tj2.jy + "-" + tj2.jm + "-" + tj2.jd;
      var dg = el("div", "panel dg-panel");
      var head = el("div", "h-card__head");
      head.appendChild(elIc("h2", "panel__title", "goals", T.t("dg_title")));
      dg.appendChild(head);

      var body = el("div", "dg-body");
      dg.appendChild(body);

      function showSaved() {
        body.textContent = "";
        var cur = S.vault.settings.dayGoals[key] || "";
        var wrap = el("div", "dg-saved");
        var txt = el("span", "dg-saved__text", cur);
        var editB = elIc("button", "btn btn--ghost btn--sm", "edit", T.t("edit"));
        editB.addEventListener("click", function () { showEditor(cur); });
        var clearB = el("button", "btn btn--ghost btn--sm btn--danger", T.t("delete"));
        clearB.addEventListener("click", async function () {
          delete S.vault.settings.dayGoals[key];
          window.UI.toast(T.t("dg_cleared"), { kind: "success" }); showEditor(""); persistBg();
        });
        wrap.appendChild(txt); wrap.appendChild(editB); wrap.appendChild(clearB);
        body.appendChild(wrap);
      }
      function showEditor(initial) {
        body.textContent = "";
        var row = el("div", "dg-row");
        var inp = el("input", "dg-input");
        inp.type = "text"; inp.value = initial || ""; inp.placeholder = T.t("dg_ph");
        var save = el("button", "btn btn--primary btn--sm", T.t("save"));
        async function doSave() {
          var val = inp.value.trim();
          if (val) S.vault.settings.dayGoals[key] = val;
          else delete S.vault.settings.dayGoals[key];
          // v5.5 — confirm immediately; the write follows. Disabling the
          // button while a background save runs would put a spinner on an
          // action that has, from the user's side, already happened.
          window.UI.toast(T.t("dg_saved"), { kind: "success" });
          if (val) showSaved(); else showEditor("");
          persistBg();
        }
        save.addEventListener("click", doSave);
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") doSave(); });
        row.appendChild(inp); row.appendChild(save);
        body.appendChild(row);
        inp.focus();
      }

      if (S.vault.settings.dayGoals[key]) showSaved();
      else showEditor("");
      host.appendChild(dg);
    })();

    var grid = el("div", "stat-grid");
    var sc = calcScore();
    var scCard = statCard(icoLabel("goals", T.t("sc_score")), num(sc.total));
    var scVal = scCard.querySelector(".stat-card__value");
    if (!window.FX.reduced()) {
      window.FX.countUp(scVal, sc.total, {
        format: function (n) { return num(n) + " · " + T.t("sc_level") + " " + num(sc.level); },
      });
    } else {
      scVal.textContent = num(sc.total) + " · " + T.t("sc_level") + " " + num(sc.level);
    }
    scCard.classList.add("stat-card--go");
    scCard.setAttribute("role", "button");
    scCard.setAttribute("tabindex", "0");
    scCard.addEventListener("click", openLevels);
    scCard.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLevels(); }
    });
    grid.appendChild(scCard);
    grid.appendChild(statCard(icoLabel("tasks", T.t("openTasks")), num(0),
      window.TasksView.openCount(), "tasks"));
    grid.appendChild(statCard(icoLabel("notes", T.t("notesCount")), num(0),
      (S.vault.notes || []).length, "notes"));
    var hd = window.HabitsView.doneToday();
    if (hd.total) {
      grid.appendChild(statCard(icoLabel("habits", T.t("habitsToday")),
        num(hd.done) + "/" + num(hd.total), null, "habits"));
    }
    host.appendChild(grid);

    // wellness: water + sleep (today)
    if (!S.vault.wellness) S.vault.wellness = { water: {}, sleep: {} };
    var w = S.vault.wellness;
    if (!w.water) w.water = {};
    if (!w.sleep) w.sleep = {};
    var key = isoDay(now);

    var wp = el("div", "panel");
    wp.appendChild(el("h2", "panel__title", T.t("wl_title")));

    var wrow = el("div", "wl-row");
    wrow.appendChild(elIc("span", "wl-lb", "drop", T.t("wl_water")));
    var minus = el("button", "icon-btn", "−");
    var count = el("span", "wl-count", num(w.water[key] || 0) + " / " + num(8));
    var plus = el("button", "icon-btn icon-btn--accent", "＋");
    var wtrack = el("div", "rp-cat__track wl-track");
    var wfill = el("div", "rp-cat__fill");
    wfill.style.setProperty("--p", Math.min(1, (w.water[key] || 0) / 8));
    wtrack.appendChild(wfill);
    async function setWater(v) {
      w.water[key] = Math.max(0, Math.min(20, v));
      count.textContent = num(w.water[key]) + " / " + num(8);
      wfill.style.setProperty("--p", Math.min(1, w.water[key] / 8));
      persistBg();   // v5.5: the counter already moved; don't gate on the write
    }
    minus.addEventListener("click", function () { setWater((w.water[key] || 0) - 1); });
    plus.addEventListener("click", function () { setWater((w.water[key] || 0) + 1); });
    wrow.appendChild(minus); wrow.appendChild(count); wrow.appendChild(plus);
    wrow.appendChild(wtrack);
    wp.appendChild(wrow);

    var srow = el("div", "wl-row wl-row--sleep");
    srow.appendChild(elIc("span", "wl-lb", "moon", T.t("wl_sleep")));

    /* v3.8.3 — this used to be a free number field. Two problems: you could
     * type 100, and although the SAVED value was clamped to 14 the box kept
     * showing 100, so the screen lied about what was stored. It also asked
     * the wrong question: nobody knows "7.5" offhand, everybody knows "I went
     * to bed at 23:30 and woke at 7". So it's two native time pickers now —
     * the OS clock, the way it was asked for — and the duration is computed.
     * An impossible number is impossible by construction, and crossing
     * midnight is handled (wake before bed = next morning).
     * Existing data keeps working: the duration still lives in w.sleep[key],
     * so the ring, the 7-day average and every report read exactly as before. */
    if (!w.sleepAt) w.sleepAt = {};
    var at = w.sleepAt[key] || {};
    var bed = el("input", "tsel wl-time");
    bed.type = "time"; bed.value = at.from || "";
    bed.setAttribute("aria-label", T.t("wl_bed"));
    var wake = el("input", "tsel wl-time");
    wake.type = "time"; wake.value = at.to || "";
    wake.setAttribute("aria-label", T.t("wl_wake"));

    var ring = sleepRing(w.sleep[key] || 0);
    var dur = el("span", "wl-dur");
    function durText() {
      var v = w.sleep[key];
      dur.textContent = (v == null) ? "" : num(Math.round(v * 10) / 10) + " " + T.t("wl_hours");
    }
    durText();

    function sleepAvgText() {
      var vals = [];
      for (var i = 0; i < 7; i++) {
        var d = new Date(now); d.setDate(now.getDate() - i);
        var v = w.sleep[isoDay(d)];
        if (v != null) vals.push(v);
      }
      if (!vals.length) return "";
      var m = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      return T.t("wl_avg") + ": " + num(Math.round(m * 10) / 10) + " " + T.t("wl_hours");
    }
    var avg = el("span", "wl-avg", sleepAvgText());

    function mins(hhmm) {
      var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
      if (!m) return null;
      var h = +m[1], mi = +m[2];
      if (h > 23 || mi > 59) return null;
      return h * 60 + mi;
    }
    async function recompute() {
      var a = mins(bed.value), b = mins(wake.value);
      if (a == null || b == null) return;          // wait until both are set
      var span = b - a;
      if (span <= 0) span += 24 * 60;              // slept across midnight
      var hours = Math.round((span / 60) * 10) / 10;
      w.sleep[key] = hours;
      w.sleepAt[key] = { from: bed.value, to: wake.value };
      var nr = sleepRing(hours);
      ring.replaceWith(nr); ring = nr;
      durText();
      avg.textContent = sleepAvgText();
      persistBg();   // v5.5: the ring already redrew; don't gate on the write
    }
    bed.addEventListener("change", recompute);
    wake.addEventListener("change", recompute);

    var trow = el("div", "wl-times");
    trow.appendChild(bed);
    trow.appendChild(el("span", "time-sep", T.t("time_to")));
    trow.appendChild(wake);
    srow.appendChild(trow);
    srow.appendChild(ring); srow.appendChild(dur); srow.appendChild(avg);
    wp.appendChild(srow);
    host.appendChild(wp);
  }
  // a stat label with the app's own line icon instead of an emoji
  function icoLabel(icon, text) {
    var w = el("span", "stat-card__lbwrap");
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ic ic--inline");
    svg.setAttribute("viewBox", "0 0 24 24");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#ic-" + icon);
    svg.appendChild(use);
    w.appendChild(svg);
    w.appendChild(el("span", null, text));
    return w;
  }

  // `countTo` (optional) makes the value roll up from zero instead of popping in
  /* v3.8.3 — a dashboard number is a question ("4 notes?"), and the answer is
   * always the section it came from. The cards were inert <div>s, so the
   * obvious tap did nothing. Passing a route turns the card into a real
   * <button> that navigates — keyboard-reachable and announced properly,
   * rather than a div with a click handler bolted on. */
  /* v3.8.3 — tapping the score used to do nothing, which left the number
   * unexplained: "5 · Level 1" says nothing about what a level costs or what
   * comes next. This is the ladder: every rank, its threshold, and exactly how
   * many points are left to the next one. Ranks are named rather than numbered
   * because "Consistent" tells you something "Level 3" doesn't. */
  var LEVEL_STEP = 500;
  var RANKS = ["rk1", "rk2", "rk3", "rk4", "rk5", "rk6", "rk7", "rk8"];
  function rankKey(level) {
    return RANKS[Math.min(RANKS.length - 1, Math.max(0, level - 1))];
  }

  function openLevels() {
    var sc = calcScore();
    var ov = el("div", "overlay");
    var card = el("div", "overlay__card lv-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.appendChild(el("h2", "panel__title", T.t("sc_levels")));

    // where you stand right now, and what's left
    var toNext = LEVEL_STEP - (sc.total % LEVEL_STEP);
    var head = el("div", "lv-now");
    head.appendChild(el("div", "lv-now__rank", T.t(rankKey(sc.level))));
    head.appendChild(el("div", "lv-now__sub",
      T.t("sc_level") + " " + num(sc.level) + " · " + num(sc.total) + " " + T.t("sc_points")));
    var track = el("div", "lv-bar");
    var fill = el("div", "lv-bar__fill");
    fill.style.setProperty("--p", (sc.total % LEVEL_STEP) / LEVEL_STEP);
    track.appendChild(fill);
    head.appendChild(track);
    head.appendChild(el("div", "lv-now__next",
      T.t("sc_toNext").replace("{n}", num(toNext))));
    card.appendChild(head);

    // the whole ladder, so the next rungs are visible and not a mystery
    var list = el("div", "lv-list");
    RANKS.forEach(function (rk, i) {
      var lvl = i + 1;
      var from = i * LEVEL_STEP;
      var row = el("div", "lv-row" + (lvl === sc.level ? " lv-row--now" : "") +
        (sc.total >= from ? " lv-row--reached" : ""));
      row.appendChild(el("span", "lv-row__n", num(lvl)));
      row.appendChild(el("span", "lv-row__name", T.t(rk)));
      row.appendChild(el("span", "lv-row__pts",
        (i === RANKS.length - 1 ? num(from) + "+" : num(from) + "–" + num(from + LEVEL_STEP - 1))));
      list.appendChild(row);
    });
    card.appendChild(list);

    // where the points actually came from — the number stops being magic
    if (sc.br) {
      var brWrap = el("div", "lv-break");
      brWrap.appendChild(el("div", "lv-break__h", T.t("sc_where")));
      Object.keys(sc.br).forEach(function (k) {
        if (!sc.br[k]) return;
        var r = el("div", "lv-break__row");
        r.appendChild(el("span", null, T.t("sc_br_" + k) || k));
        r.appendChild(el("span", "lv-break__v", num(sc.br[k])));
        brWrap.appendChild(r);
      });
      card.appendChild(brWrap);
    }

    var actions = el("div", "overlay__actions");
    var close = el("button", "btn btn--primary btn--sm", T.t("close"));
    close.addEventListener("click", function () { ov.remove(); });
    actions.appendChild(close);
    card.appendChild(actions);
    ov.appendChild(card);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { ov.remove(); document.removeEventListener("keydown", esc); }
    });
    document.body.appendChild(ov);
    close.focus();
  }

  function statCard(label, value, countTo, route) {
    var c = el(route ? "button" : "div", "stat-card" + (route ? " stat-card--go" : ""));
    if (route) {
      c.type = "button";
      c.addEventListener("click", function () { location.hash = "#/" + route; });
    }
    var lb = el("div", "stat-card__label");
    if (label && label.nodeType) lb.appendChild(label); else lb.textContent = label;
    c.appendChild(lb);
    var v = el("div", "stat-card__value", value);
    c.appendChild(v);
    if (countTo != null && !window.FX.reduced()) {
      window.FX.countUp(v, countTo, { format: function (n) { return num(n); } });
    }
    return c;
  }

  // ---- calendar (month / week / day views) --------------------------------
  function dateToJ(d) { return J.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function sameDay(a, b) { return a.jy === b.jy && a.jm === b.jm && a.jd === b.jd; }
  // Convert a Jalali {jy,jm,jd} to a comparable Date (midnight).
  function jToDate(j) { var g = J.toGregorian(j.jy, j.jm, j.jd); return new Date(g.gy, g.gm - 1, g.gd); }
  function jDiffDays(a, b) { return Math.round((jToDate(b) - jToDate(a)) / 86400000); }
  // Does a task cover this day? Multi-day tasks have dueEnd; single-day use due.
  function coversDay(x, day) {
    if (!x.due) return false;
    if (!x.dueEnd) return sameDay(x.due, day);
    var s = jToDate(x.due), e = jToDate(x.dueEnd), d = jToDate(day);
    if (e < s) { var t = s; s = e; e = t; }
    return d >= s && d <= e;
  }
  function isSpan(x) { return x.dueEnd && jDiffDays(x.due, x.dueEnd) !== 0; }
  // Position of `day` within a task's span: {start, end, mid} booleans.
  function spanPos(x, day) {
    var s = x.due, e = x.dueEnd || x.due;
    if (jToDate(e) < jToDate(s)) { var t = s; s = e; e = t; }
    return { start: sameDay(s, day), end: sameDay(e, day),
      mid: !sameDay(s, day) && !sameDay(e, day) };
  }

  function shiftMonth(delta) {
    cal.m += delta;
    if (cal.m > 12) { cal.m = 1; cal.y += 1; }
    else if (cal.m < 1) { cal.m = 12; cal.y -= 1; }
    renderRoute();
  }

  // v1.16 (فاز F مورد ۳۵): calendar-wide kind/status filter. "open" keeps the
  // historical behaviour — the calendar always hid done tasks — and events,
  // which can never be done, stay visible unless "done only" is chosen.
  var calFilter = "open";   // open | events | done | all
  function isEventRec(x) { return x && x.kind === "event"; }
  function passesCalFilter(x) {
    if (calFilter === "events") return isEventRec(x);
    if (calFilter === "done") return !isEventRec(x) && !!x.done;
    if (calFilter === "all") return true;
    return isEventRec(x) || !x.done;            // "open"
  }
  function tasksOn(jy, jm, jd) {
    var day = { jy: jy, jm: jm, jd: jd };
    return (S.vault.tasks || []).filter(function (x) {
      if (x.archived || !passesCalFilter(x)) return false;
      return coversDay(x, day);
    });
  }

  async function moveTaskTo(taskId, jy, jm, jd) {
    var x = (S.vault.tasks || []).find(function (i) { return i.id === taskId; });
    if (!x) return;
    var from = x.due;                       // remember where it left
    // A multi-day task paints a chip on EVERY day of its span, so moving one
    // changes more cells than the two endpoints. Rather than enumerate a range
    // that could be arbitrarily long, spans take the full-render path — they
    // are the rare case, and a stale chip left behind would be a real bug.
    var wasSpan = isSpan(x);
    x.due = { jy: jy, jm: jm, jd: jd };
    // v5.5 — the drop lands now; the write follows (measured: 0.8s wifi /
    // 1.5s weak link of pure waiting before this changed).
    status("msg_saved", "success");
    window.FX.haptic("tick");
    // v5.7 — a move touches two days, not the whole month.
    if (wasSpan || isSpan(x) ||
        !refreshCalDays([from, { jy: jy, jm: jm, jd: jd }])) {
      renderRoute();
    }
    // the moved item springs into its new home (it was just re-created)
    var landed = document.querySelector('[data-task-id="' + taskId + '"]');
    if (landed) window.FX.settle(landed);
    persistBg();
  }

  function chipFor(x, day) {
    // (event chips are outlined instead of filled — see .cal-chip--event)
    var cls = "cal-chip " + window.TaskColor.cls(x.color) +
      (x.pr === "high" ? " cal-chip--high" : "") +
      (isEventRec(x) ? " cal-chip--event" : "") +
      (x.cat === "exam" ? " cal-chip--exam" : "");
    var label = x.title;
    if (day && isSpan(x)) {
      var pos = spanPos(x, day);
      cls += " cal-chip--span" +
        (pos.start ? " cal-chip--span-start" : "") +
        (pos.end ? " cal-chip--span-end" : "") +
        (pos.mid ? " cal-chip--span-mid" : "");
      if (!pos.start) label = "‹ " + x.title;
    }
    var chip = el("div", cls, label);
    if (window.TaskColor.isCustom(x.color)) chip.style.setProperty("--tc", x.color);
    chip.setAttribute("data-task-id", x.id);
    chip.title = x.title;
    chip.draggable = true;
    chip.addEventListener("dragstart", function (e) {
      e.dataTransfer.setData("text/plain", x.id);
      e.dataTransfer.effectAllowed = "move";
    });
    chip.addEventListener("click", function (e) {
      e.stopPropagation();
      window.TasksView.openById(x.id);
    });
    attachPointerDrag(chip, x.id);
    attachTaskMenu(chip, x);   // right-click + long-press (v1.13.2)
    return chip;
  }
  function makeDrop(elm, day) {
    elm.setAttribute("data-jday", JSON.stringify(day));
    elm.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      elm.classList.add("cal-cell--over");
    });
    elm.addEventListener("dragleave", function () { elm.classList.remove("cal-cell--over"); });
    elm.addEventListener("drop", function (e) {
      e.preventDefault();
      elm.classList.remove("cal-cell--over");
      var id = e.dataTransfer.getData("text/plain");
      if (id) moveTaskTo(id, day.jy, day.jm, day.jd);
    });
  }

  // Pointer-based drag: works on both mouse and touch. Starts after a small
  // hold/movement so taps and scrolls still work; on release, the task moves
  // to whichever day container (month cell / week column / day grid) is under
  // the pointer, marked with data-jday.
  function attachPointerDrag(elm, taskId) {
    var dragging = false, ghost = null, startX = 0, startY = 0, holdTimer = null;
    function cleanup() {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      if (ghost) { ghost.remove(); ghost = null; }
      document.querySelectorAll(".drop-hot").forEach(function (n) { n.classList.remove("drop-hot"); });
      dragging = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    }
    function begin(e) {
      dragging = true;
      ghost = elm.cloneNode(true);
      ghost.className += " drag-ghost";
      ghost.style.width = elm.offsetWidth + "px";
      document.body.appendChild(ghost);
      position(e);
    }
    function position(e) {
      if (!ghost) return;
      ghost.style.left = (e.clientX + 8) + "px";
      ghost.style.top = (e.clientY + 8) + "px";
      var under = document.elementFromPoint(e.clientX, e.clientY);
      var target = under && under.closest("[data-jday]");
      document.querySelectorAll(".drop-hot").forEach(function (n) { n.classList.remove("drop-hot"); });
      if (target) target.classList.add("drop-hot");
    }
    function onMove(e) {
      if (!dragging) {
        if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
          if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
          begin(e);
        }
        return;
      }
      e.preventDefault();
      position(e);
    }
    function onUp(e) {
      var wasDragging = dragging;
      var under = document.elementFromPoint(e.clientX, e.clientY);
      var target = under && under.closest("[data-jday]");
      cleanup();
      if (wasDragging && target) {
        try {
          var d = JSON.parse(target.getAttribute("data-jday"));
          moveTaskTo(taskId, d.jy, d.jm, d.jd);
        } catch (err) {}
      }
    }
    elm.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      startX = e.clientX; startY = e.clientY;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      holdTimer = setTimeout(function () { begin(e); }, 280);
    });
  }

  /* v4.0 — the calendar header used to be three full-width control rows
   * stacked above the grid (title row + five view chips + four filter chips),
   * which ate the vertical space the grid needs and made the calendar look
   * like a form. Google fits all of it in ONE row by hiding the choices
   * behind two small controls; that's what these two menus are. */
  function calMenu(anchorEl, items) {
    var open = document.querySelector(".tb-pop");
    if (open) { open.remove(); return; }
    var pop = el("div", "tb-pop cal-pop");
    items.forEach(function (it) {
      var b = el("button", "tb-pop__item" + (it.active ? " tb-pop__item--on" : ""), it.label);
      b.type = "button";
      b.addEventListener("click", function () { pop.remove(); it.onClick(); });
      pop.appendChild(b);
    });
    document.body.appendChild(pop);
    var r = anchorEl.getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + "px";
    var w = pop.offsetWidth || 190;
    pop.style.insetInlineStart = "auto";
    pop.style.left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8) + "px";
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
    var first = pop.querySelector(".tb-pop__item");
    if (first) first.focus();
  }

  var CAL_VIEWS = [["month", "cal_vMonth"], ["week", "cal_vWeek"], ["3day", "cal_v3Day"],
                   ["day", "cal_vDay"], ["agenda", "cal_vAgenda"]];
  var CAL_FILTERS = [["open", "cf_open"], ["events", "cf_events"],
                     ["done", "cf_done"], ["all", "cf_all"]];

  // the view picker: one button showing the current view, like Google's "Day ▾"
  function viewPicker() {
    var cur = CAL_VIEWS.filter(function (o) { return o[0] === cal.view; })[0] || CAL_VIEWS[0];
    var b = el("button", "btn btn--ghost btn--sm cal-pick", T.t(cur[1]));
    b.type = "button";
    b.setAttribute("aria-haspopup", "true");
    b.appendChild(el("span", "tb-caret", "▾"));
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      calMenu(b, CAL_VIEWS.map(function (o) {
        return { label: T.t(o[1]), active: cal.view === o[0], onClick: function () {
          cal.view = o[0]; setPref("sp_calview", o[0]); renderRoute();
        } };
      }));
    });
    return b;
  }

  // the filter: an icon button, with a dot when it is narrowing the view
  function filterPicker() {
    var b = el("button", "icon-btn cal-filter" + (calFilter !== "open" ? " cal-filter--on" : ""));
    b.type = "button";
    b.setAttribute("aria-label", T.t("cal_filter"));
    b.setAttribute("aria-haspopup", "true");
    b.appendChild(icn("filter"));
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      calMenu(b, CAL_FILTERS.map(function (o) {
        return { label: T.t(o[1]), active: calFilter === o[0], onClick: function () {
          calFilter = o[0]; setPref("sp_calfilter", o[0]); renderRoute();
        } };
      }));
    });
    return b;
  }

  /* v4.0.1 — two ways to give the calendar more room, both persistent.
   *
   * Fullscreen: hides the app's own chrome (top bar, bottom nav, sidebar) so
   * a whole day can be planned without anything else on screen. This is a
   * CSS-class toggle rather than the browser Fullscreen API on purpose — the
   * API needs a user gesture every time, exits on any navigation, and on iOS
   * Safari simply isn't available. A class survives route changes and works
   * identically everywhere.
   *
   * Sidebar collapse: desktop only, because on phones the sidebar is already
   * off-canvas. The calendar reflows automatically since v4.0 sizes it with
   * flex rather than fixed numbers. */
  var CAL_FS_KEY = "sp_calfs", SIDEBAR_KEY = "sp_sidebar";

  function applyCalFullscreen(on) {
    document.documentElement.classList.toggle("cal-fs", !!on);
    setPref(CAL_FS_KEY, on ? "1" : "0");
  }
  function calFullscreenOn() { return pref(CAL_FS_KEY, "0") === "1"; }

  /* v4.5 — full screen started as a calendar-only control, but the reason it
   * exists ("let me plan without anything else on screen") is just as true on
   * the Today page. It is one shared toggle now: the same class, the same
   * stored preference, so turning it on in one place and walking to the other
   * doesn't flip it back. */
  function fullscreenBtn() {
    var on = calFullscreenOn();
    var b = el("button", "icon-btn cal-fsbtn" + (on ? " cal-fsbtn--on" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", T.t(on ? "cal_fsExit" : "cal_fsEnter"));
    b.title = T.t(on ? "cal_fsExit" : "cal_fsEnter");
    b.appendChild(icn(on ? "minimize" : "maximize"));
    b.addEventListener("click", function () {
      applyCalFullscreen(!calFullscreenOn());
      renderRoute();
    });
    return b;
  }

  function applySidebar(collapsed) {
    document.documentElement.classList.toggle("sb-collapsed", !!collapsed);
    setPref(SIDEBAR_KEY, collapsed ? "0" : "1");
  }
  function sidebarCollapsed() { return pref(SIDEBAR_KEY, "1") === "0"; }

  function sidebarBtn() {
    var col = sidebarCollapsed();
    var b = el("button", "icon-btn cal-sbbtn");
    b.type = "button";
    b.setAttribute("aria-pressed", col ? "true" : "false");
    b.setAttribute("aria-label", T.t(col ? "cal_sbShow" : "cal_sbHide"));
    b.title = T.t(col ? "cal_sbShow" : "cal_sbHide");
    b.appendChild(icn("sidebar"));
    b.addEventListener("click", function () {
      applySidebar(!sidebarCollapsed());
      renderRoute();
    });
    return b;
  }

  /* v4.9 — the view switcher, twice.
   *
   * Measured on a 375px viewport, the old single-row header overflowed its
   * `overflow: hidden` parent: on the day view the date title collapsed to
   * zero width and the view picker sat at left:-9px — off-screen, with no
   * scroll to reach it. The controls people needed most were the ones that
   * fell off the edge.
   *
   * So the switcher exists in two forms and CSS picks one. Desktop keeps the
   * compact dropdown. Phones get a segmented bar on its own row: every view
   * visible, one tap instead of two, and nothing competing for the same line
   * as the date. Both are always in the DOM — no resize listener to drift out
   * of sync, and no layout that depends on JS having measured anything.
   */
  function calViewBar() {
    var bar = el("div", "cal-viewbar");
    bar.setAttribute("role", "tablist");
    bar.setAttribute("aria-label", T.t("cal_viewLabel"));
    CAL_VIEWS.forEach(function (o) {
      var on = cal.view === o[0];
      var b = el("button", "cal-vb__btn" + (on ? " is-on" : ""), T.t(o[1]));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.addEventListener("click", function () {
        if (cal.view === o[0]) return;
        cal.view = o[0]; setPref("sp_calview", o[0]); renderRoute();
      });
      bar.appendChild(b);
    });
    return bar;
  }

  // the controls every calendar header ends with
  function calTail() {
    var tail = el("div", "cal-head__tail");
    tail.appendChild(sidebarBtn());
    tail.appendChild(fullscreenBtn());
    tail.appendChild(filterPicker());
    tail.appendChild(viewPicker());
    return tail;
  }

  function renderCalendar(host) {
    if (!cal.view) cal.view = pref("sp_calview", "month");
    calFilter = pref("sp_calfilter", "open");
    if (!cal.anchor) cal.anchor = new Date();
    if (!cal.y) {
      var td0 = CS.fromDate(new Date());
      cal.y = td0.y; cal.m = td0.m;
    }
    if (cal.view === "agenda") { renderAgenda(host); calFab(host); attachCalSwipe(host); return; }
    if (cal.view === "week") { renderTimeGrid(host, 7); calFab(host); attachCalSwipe(host); return; }
    if (cal.view === "3day") { renderTimeGrid(host, 3); calFab(host); attachCalSwipe(host); return; }
    if (cal.view === "day") {
      renderTimeGrid(host, 1);
      upNextCard(host);           // v2.3: what is coming, without scrolling for it
      calFab(host);
      attachCalSwipe(host);
      return;
    }
    renderMonth(host);
    calFab(host);
    attachCalSwipe(host);
  }

  // v2.3: one place that knows how to move the calendar, so the arrow keys,
  // the header buttons and the swipe gesture can never drift apart.
  function calStep(dir) {
    if (cal.view === "month" || cal.view === "agenda") {
      cal.m += dir;
      if (cal.m > 12) { cal.m = 1; cal.y++; }
      if (cal.m < 1) { cal.m = 12; cal.y--; }
      cal.anchor = CS.toDate({ y: cal.y, m: cal.m, d: 1 });
    } else {
      var step = cal.view === "week" ? 7 : (cal.view === "3day" ? 3 : 1);
      if (!cal.anchor) cal.anchor = new Date();
      cal.anchor.setDate(cal.anchor.getDate() + dir * step);
    }
    renderRoute();
  }

  // Swipe to change month/week/day, the way every native calendar behaves.
  // Only horizontal intent counts, so vertical scrolling is untouched; a drag
  // in progress wins; and RTL flips direction so "forward" means the same
  // thing to a Persian reader.
  function attachCalSwipe(node) {
    var sx = 0, sy = 0, id = null, decided = false, horiz = false;
    node.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "touch" || id !== null) return;
      if (e.target.closest(".cal-chip, .tt-block, .seg, button, select, input, .ag-row")) return;
      id = e.pointerId; sx = e.clientX; sy = e.clientY; decided = false; horiz = false;
    });
    node.addEventListener("pointermove", function (e) {
      if (e.pointerId !== id || decided) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      decided = true;
      horiz = Math.abs(dx) > Math.abs(dy) * 1.6;
    });
    function end(e) {
      if (e.pointerId !== id) return;
      var dx = e.clientX - sx;
      id = null;
      if (!horiz || Math.abs(dx) < 55) return;
      if (document.querySelector(".drag-ghost, .kb-ghost")) return;
      var rtl = document.documentElement.getAttribute("dir") === "rtl";
      var dir = dx < 0 ? 1 : -1;
      if (rtl) dir = -dir;
      if (window.FX && window.FX.haptic) window.FX.haptic("soft");
      calStep(dir);
    }
    node.addEventListener("pointerup", end);
    node.addEventListener("pointercancel", function (e) { if (e.pointerId === id) id = null; });
  }

  // ---- "up next" card (v2.3) ---------------------------------------------
  // In the reference, the day view answers one question before you scroll:
  // what is happening next. Shown only for today, only when something with a
  // time is still ahead — a card that says "nothing" is just clutter.
  function upNextCard(host) {
    var now = new Date();
    var a = cal.anchor || now;
    if (a.toDateString() !== now.toDateString()) return;

    var j = J.toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());
    var mins = now.getHours() * 60 + now.getMinutes();
    var next = null;
    tasksOn(j.jy, j.jm, j.jd).forEach(function (x) {
      if (!x.timeFrom || x.done) return;
      var parts = String(x.timeFrom).split(":");
      var m = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
      if (m < mins) return;
      if (!next || m < next.m) next = { m: m, x: x };
    });
    if (!next) return;

    var away = next.m - mins;
    var card = el("div", "cal-next");
    card.appendChild(el("div", "cal-next__lb",
      away <= 0 ? T.t("cal_nowLabel")
        : T.t("cal_nextIn").replace("{n}", num(away < 60 ? away : Math.round(away / 60)))
            .replace("{u}", away < 60 ? T.t("unit_min") : T.t("unit_hour"))));
    card.appendChild(el("div", "cal-next__t", next.x.title));
    var when = next.x.timeFrom + (next.x.timeTo ? " – " + next.x.timeTo : "");
    card.appendChild(el("div", "cal-next__time", num(when)));
    var go = el("button", "btn btn--primary btn--sm cal-next__go", T.t("cal_openTask"));
    go.addEventListener("click", function () { window.TasksView.openById(next.x.id); });
    card.appendChild(go);
    host.appendChild(card);
  }

  // ---- agenda (v2.3) ------------------------------------------------------
  // The view people actually live in: one scrolling column of days, empty days
  // skipped, so a month reads as a story instead of a grid of blanks.
  function renderAgenda(host) {
    var panel = el("div", "panel ag-panel");
    var head = el("div", "cal-head");
    var prev = el("button", "icon-btn", "‹"); prev.setAttribute("aria-label", T.t("cal_prev"));
    var next = el("button", "icon-btn", "›"); next.setAttribute("aria-label", T.t("cal_next"));
    prev.addEventListener("click", function () { calStep(-1); });
    next.addEventListener("click", function () { calStep(1); });
    head.appendChild(prev);
    head.appendChild(el("h2", "cal-title", CS.monthName(cal.m) + " " + num(cal.y)));
    head.appendChild(next);
    var todayB = el("button", "btn btn--ghost btn--sm", T.t("cal_today"));
    todayB.addEventListener("click", function () {
      var t0 = CS.fromDate(new Date());
      cal.y = t0.y; cal.m = t0.m; cal.anchor = new Date();
      renderRoute();
    });
    head.appendChild(todayB);
    head.appendChild(calTail());
    panel.appendChild(head);
    panel.appendChild(calViewBar());   // v4.9: phone-only segmented switcher

    var len = CS.monthLength(cal.y, cal.m);
    function isoOf(dt) {
      return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") +
        "-" + String(dt.getDate()).padStart(2, "0");
    }
    var todayIso = isoOf(new Date());
    var rows = 0;

    for (var d = 1; d <= len; d++) {
      var date = CS.toDate({ y: cal.y, m: cal.m, d: d });
      var j = J.toJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate());
      var items = tasksOn(j.jy, j.jm, j.jd);
      if (!items.length) continue;          // empty days are noise here
      rows++;

      var row = el("div", "ag-row" + (isoOf(date) === todayIso ? " ag-row--today" : ""));
      var dcol = el("div", "ag-day");
      dcol.appendChild(el("span", "ag-day__wd", CS.weekdayShort(CS.dowCol(date))));
      dcol.appendChild(el("span", "ag-day__n", num(d)));
      row.appendChild(dcol);

      var list = el("div", "ag-items");
      items
        .slice()
        .sort(function (a, b) { return (a.timeFrom || "99").localeCompare(b.timeFrom || "99"); })
        .forEach(function (x) {
          var it = el("button", "ag-item " + window.TaskColor.cls(x.color) +
            (x.done ? " ag-item--done" : "") + (x.kind === "event" ? " ag-item--event" : ""));
          it.type = "button";
          if (x.timeFrom) it.appendChild(el("span", "ag-item__t", num(x.timeFrom)));
          it.appendChild(el("span", "ag-item__title", x.title));
          it.addEventListener("click", function () { window.TasksView.openById(x.id); });
          attachTaskMenu(it, x);
          list.appendChild(it);
        });
      row.appendChild(list);
      panel.appendChild(row);
    }

    if (!rows) {
      panel.appendChild(el("p", "panel__text ag-empty", T.t("cal_agEmpty")));
    }
    host.appendChild(panel);
  }

  // v1.13.4 (فاز C2): floating quick-add, phones only (CSS shows it ≤820px) —
  // same position and job as Google Calendar's FAB. Opens the task form on the
  // selected day, or today.
  function calFab(host) {
    var fab = el("button", "cal-fab");
    fab.type = "button";
    fab.title = T.t("newTask");
    fab.setAttribute("aria-label", T.t("newTask"));
    fab.appendChild(icn("plus"));
    fab.addEventListener("click", function () {
      window.TasksView.openNew(selDay || dateToJ(new Date()));
    });
    host.appendChild(fab);

    /* v3.7 — the reference FAB tucks itself away while you scroll and comes
     * back when you stop, so it never sits on the content you're reading.
     * We watch the nearest scroller (the time grid on day/week, else the
     * route/page) and toggle a class; reduced-motion users keep it static. */
    var reduce = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    if (reduce) return;
    var scroller = host.querySelector(".tg-scroll") || host.querySelector(".route-view") || host;
    var lastY = 0, idle = null;
    function onScroll() {
      var y = scroller.scrollTop || 0;
      if (y > lastY + 6 && y > 40) fab.classList.add("cal-fab--tucked");
      else if (y < lastY - 6) fab.classList.remove("cal-fab--tucked");
      lastY = y;
      if (idle) clearTimeout(idle);
      idle = setTimeout(function () { fab.classList.remove("cal-fab--tucked"); }, 700);
    }
    scroller.addEventListener("scroll", onScroll, { passive: true });
  }

  // Quick date jump ("mini-map"): pick a year and month to jump the calendar.
  function openMonthJump(anchorEl) {
    var existing = document.querySelector(".mm-pop");
    if (existing) { existing.remove(); return; }
    var tj = CS.fromDate(new Date());
    var y = cal.y || tj.y;
    var pop = el("div", "mm-pop");
    function build() {
      pop.textContent = "";
      var head = el("div", "mm-head");
      var py = el("button", "icon-btn", "‹"); py.setAttribute("aria-label", T.t("cal_prev"));
      var yl = el("span", "mm-year", num(y));
      var ny = el("button", "icon-btn", "›"); ny.setAttribute("aria-label", T.t("cal_next"));
      py.addEventListener("click", function () { y--; build(); });
      ny.addEventListener("click", function () { y++; build(); });
      head.appendChild(py); head.appendChild(yl); head.appendChild(ny);
      pop.appendChild(head);
      var grid = el("div", "mm-grid");
      CS.monthNames().forEach(function (mname, i) {
        var isCur = (y === (cal.y || tj.y) && (i + 1) === cal.m);
        var isToday = (y === tj.y && (i + 1) === tj.m);
        var b = el("button", "mm-cell" + (isCur ? " active" : "") + (isToday ? " today" : ""), mname);
        b.addEventListener("click", function () {
          cal.y = y; cal.m = i + 1;
          cal.anchor = null; // month view uses y/m directly
          pop.remove();
          renderRoute();
        });
        grid.appendChild(b);
      });
      pop.appendChild(grid);
    }
    build();
    document.body.appendChild(pop);
    var r = anchorEl.getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + "px";
    pop.style.insetInlineStart = Math.max(8, r.left) + "px";
    setTimeout(function () {
      document.addEventListener("click", function outside(e) {
        // also detach when the popover was removed by a re-render rather than
        // by a click — otherwise the listener outlives its node for good
        if (!document.body.contains(pop)) {
          document.removeEventListener("click", outside);
          return;
        }
        if (!pop.contains(e.target) && e.target !== anchorEl) {
          pop.remove(); document.removeEventListener("click", outside);
        }
      });
    }, 0);
  }

  function renderMonth(host) {
    var td = CS.fromDate(new Date());
    var panel = el("div", "panel");
    var head = el("div", "cal-head");
    var prev = el("button", "icon-btn", "‹"); prev.setAttribute("aria-label", T.t("cal_prev"));
    var next = el("button", "icon-btn", "›"); next.setAttribute("aria-label", T.t("cal_next"));
    prev.addEventListener("click", function () { shiftMonth(-1); });
    next.addEventListener("click", function () { shiftMonth(1); });
    var title = el("button", "cal-title cal-title--btn", CS.monthName(cal.m) + " " + num(cal.y));
    title.setAttribute("aria-label", T.t("cal_jump"));
    title.addEventListener("click", function () { openMonthJump(title); });
    var todayBtn = el("button", "btn btn--ghost btn--sm", T.t("cal_today"));
    todayBtn.addEventListener("click", function () {
      cal.y = 0; cal.anchor = new Date(); renderRoute();
    });
    var printBtn = el("button", "btn btn--ghost btn--sm cal-print", T.t("printMonth"));
    printBtn.addEventListener("click", function () { window.print(); });
    head.appendChild(todayBtn);
    head.appendChild(prev); head.appendChild(next);
    head.appendChild(title);
    var mTail = calTail();
    mTail.insertBefore(printBtn, mTail.firstChild);
    head.appendChild(mTail);
    panel.appendChild(head);
    panel.appendChild(calViewBar());   // v4.9: phone-only segmented switcher

    var grid = el("div", "cal-grid");
    for (var w = 0; w < 7; w++) grid.appendChild(el("div", "cal-wd", CS.weekdayShort(w)));
    var fd = CS.toDate({ y: cal.y, m: cal.m, d: 1 });
    var startCol = CS.dowCol(fd);
    var len = CS.monthLength(cal.y, cal.m);
    for (var b = 0; b < startCol; b++) grid.appendChild(el("div", "cal-cell cal-cell--empty"));
    for (var d = 1; d <= len; d++) grid.appendChild(calCell(d, td));
    panel.appendChild(grid);
    /* v6.9 — the drag hint is desktop-only. On a phone there is no dragging to
     * hint at, and a line of instructions nobody can act on is exactly the
     * clutter testers complained about. */
    if (!isPhone()) panel.appendChild(el("p", "cal-hint", T.t("cal_dndHint")));
    host.appendChild(panel);

    /* v6.9 — on a phone a month grid alone is a dead end: seven columns on a
     * 390px screen give each day about 50px, which is enough to show that
     * something exists and not enough to show what. The day list underneath is
     * where the actual work is, so a phone always has a day selected — today,
     * unless the person picked another — instead of showing an empty grid and
     * waiting to be tapped. */
    if (isPhone() && !selDay) {
      var t0 = CS.fromDate(new Date());
      if (t0.y === cal.y && t0.m === cal.m) selDay = CS.dispToJ(t0);
    }
    if (selDay) {
      var selDisp = CS.jToDisp(selDay);
      if (selDisp.y === cal.y && selDisp.m === cal.m) {
        host.appendChild(dayPanel(selDay));
        // one-shot: the listener removes itself, so re-renders can't stack them
        document.addEventListener("keydown", function esc(e) {
          document.removeEventListener("keydown", esc);
          if (e.key === "Escape" && selDay) { selDay = null; renderRoute(); }
        });
      }
    }
  }

  /* v5.7 — repaint ONE day instead of the whole month. A cell depends only on
   * its own day's tasks, so refreshing the affected cells is equivalent to a
   * full rebuild at a fraction of the work. Returns false when a cell is not
   * on screen, so the caller falls back to a full render. */
  function refreshCalDay(day) {
    var host = $("route-view");
    if (!host) return false;
    var key = day.jy + "-" + day.jm + "-" + day.jd;
    var cell = host.querySelector('.cal-cell[data-day="' + key + '"]');
    if (!cell) return false;
    // rebuild from the same source of truth the grid used, so a refreshed cell
    // and a fully-rendered one can never disagree
    var fresh = calCell(day.jd, CS.fromDate(new Date()));
    cell.replaceWith(fresh);
    return true;
  }

  /* All-or-nothing: if any affected cell is off-screen, report false and let
   * the caller do a full render. A half-updated grid is worse than a slow one. */
  function refreshCalDays(days) {
    var seen = {}, list = [];
    days.forEach(function (d) {
      if (!d) return;
      var k = d.jy + "-" + d.jm + "-" + d.jd;
      if (!seen[k]) { seen[k] = 1; list.push(d); }
    });
    if (!list.length) return false;
    // check all of them BEFORE mutating, so we never half-apply
    var host = $("route-view");
    if (!host) return false;
    for (var i = 0; i < list.length; i++) {
      var k = list[i].jy + "-" + list[i].jm + "-" + list[i].jd;
      if (!host.querySelector('.cal-cell[data-day="' + k + '"]')) return false;
    }
    list.forEach(refreshCalDay);
    return true;
  }

  function calCell(d, td) {
    var gd = CS.toDate({ y: cal.y, m: cal.m, d: d });
    var cell = el("div", "cal-cell");
    if (cal.y === td.y && cal.m === td.m && d === td.d) cell.classList.add("cal-cell--today");
    if (CS.isHoliday(gd)) cell.classList.add("cal-cell--fri");

    var head = el("div", "cal-cell__head");
    head.appendChild(el("span", "cal-cell__j", num(d)));
    cell.appendChild(head);

    var jj = dateToJ(gd);
    var day = { jy: jj.jy, jm: jj.jm, jd: jj.jd };
    var list = tasksOn(day.jy, day.jm, day.jd);
    var box = el("div", "cal-chips");
    list.slice(0, 3).forEach(function (x) { box.appendChild(chipFor(x, day)); });
    if (list.length > 3) box.appendChild(el("div", "cal-more", "+" + num(list.length - 3)));
    cell.appendChild(box);
    if (list.length) {
      var dots = el("div", "cal-dots");
      list.slice(0, 3).forEach(function () { dots.appendChild(el("span", "cal-dot")); });
      cell.appendChild(dots);
    }

    if (selDay && sameDay(selDay, day)) cell.classList.add("cal-cell--sel");
    // v5.7 — a stable key so one cell can be refreshed without touching the
    // other forty-one.
    cell.setAttribute("data-day", day.jy + "-" + day.jm + "-" + day.jd);
    cell.addEventListener("click", function (e) {
      if (e.target.closest(".cal-chip")) return;
      selDay = day;
      renderRoute();
    });
    makeDrop(cell, day);
    return cell;
  }

  // ---- unified time grid (day / 3-day / week) -----------------------------
  // One CSS grid holds the header row, the all-day row and the timed body:
  // the same column tracks are shared by every row, so header/body can never
  // drift apart. The grid itself is the (only) scroll container; header and
  // all-day cells are sticky inside it, and the hour gutter is sticky on the
  // inline-start side. Events, the "now" line and the drag-selection are all
  // positioned inside their own day column (position:relative) with
  // percentage-based inline geometry — RTL-safe by construction.
  var TG_HEAD_H = 46; // fixed header row height (px) so the all-day row can stick under it

  function renderTimeGrid(host, nDays) {
    var today = dateToJ(new Date());
    var isDay = nDays === 1;
    var start = new Date(cal.anchor);
    if (nDays === 7) start.setDate(start.getDate() - CS.dowCol(start));
    var days = [];
    for (var i = 0; i < nDays; i++) {
      var dd = new Date(start); dd.setDate(start.getDate() + i);
      days.push({ date: dd, j: dateToJ(dd), disp: CS.fromDate(dd) });
    }
    var range = hourRange(days.map(function (o) { return timedOf(o.j); }));
    var gridH = (range.end - range.start) * HOUR_H;

    // ---- header (panel toolbar) ----
    var panel = el("div", "panel");
    var head = el("div", "cal-head");
    var prev = el("button", "icon-btn", "‹"); prev.setAttribute("aria-label", T.t("cal_prev"));
    var next = el("button", "icon-btn", "›"); next.setAttribute("aria-label", T.t("cal_next"));
    prev.addEventListener("click", function () {
      cal.anchor.setDate(cal.anchor.getDate() - nDays); renderRoute();
    });
    next.addEventListener("click", function () {
      cal.anchor.setDate(cal.anchor.getDate() + nDays); renderRoute();
    });
    var title;
    if (isDay) {
      var d0 = days[0];
      title = el("div", "cal-title",
        CS.weekdayFullOf(d0.date) + " " + num(d0.disp.d) + " " + CS.monthName(d0.disp.m) +
        " " + num(d0.disp.y) + (sameDay(d0.j, today) ? " · " + T.t("cal_today") : ""));
    } else {
      var ds = days[0].disp, de = days[nDays - 1].disp;
      title = el("div", "cal-title",
        num(ds.d) + " " + CS.monthName(ds.m) + " – " +
        num(de.d) + " " + CS.monthName(de.m) + " " + num(de.y));
    }
    var todayBtn = el("button", "btn btn--ghost btn--sm", T.t("cal_today"));
    todayBtn.addEventListener("click", function () { cal.anchor = new Date(); renderRoute(); });
    /* v4.0 — one row, in the reference's order: Today, the arrows, the date,
     * then everything else pushed to the far edge. The five view chips and
     * four filter chips became two compact controls, which is the whole
     * reason the grid can now have the height it needs. */
    head.appendChild(todayBtn);
    head.appendChild(prev); head.appendChild(next);
    head.appendChild(title);
    var tail = calTail();
    if (isDay) {
      var add = el("button", "btn btn--primary btn--sm", T.t("day_add"));
      add.addEventListener("click", function () { window.TasksView.openNew(days[0].j); });
      tail.insertBefore(add, tail.firstChild);
    }
    head.appendChild(tail);
    panel.appendChild(head);
    panel.appendChild(calViewBar());   // v4.9: phone-only segmented switcher

    // ---- the grid ----
    var tg = el("div", "tg" + (nDays >= 5 ? " tg--wide" : "") + (isDay ? " tg--day" : ""));
    tg.style.setProperty("--tg-cols", nDays);
    tg.style.setProperty("--tg-headh", TG_HEAD_H + "px");

    // header row: corner + one cell per day
    var corner = el("div", "tg__hcell tg__corner");
    tg.appendChild(corner);
    days.forEach(function (o) {
      var h = el("div", "tg__hcell" + (sameDay(o.j, today) ? " tg__hcell--today" : "") +
        (CS.isHoliday(o.date) ? " tg__hcell--holiday" : ""));
      var btn = el("button", "tg__hbtn");
      btn.appendChild(el("span", "tg__hwd", CS.weekdayFullOf(o.date)));
      btn.appendChild(el("span", "tg__hd", num(o.disp.d)));
      btn.setAttribute("aria-label", CS.weekdayFullOf(o.date) + " " + num(o.disp.d));
      if (!isDay) {
        btn.addEventListener("click", function () {
          cal.anchor = o.date; cal.view = "day"; setPref("sp_calview", "day"); renderRoute();
        });
      }
      h.appendChild(btn);
      h.setAttribute("data-jday", JSON.stringify(o.j));
      makeDrop(h, o.j);
      tg.appendChild(h);
    });

    // all-day row (multi-day spans + untimed tasks) — only when present
    var anyAllday = days.some(function (o) { return untimedOf(o.j).length > 0; });
    if (anyAllday) {
      tg.classList.add("tg--allday");
      var acorner = el("div", "tg__acell tg__acorner");
      acorner.appendChild(el("span", "tg__alb", T.t("cal_allday")));
      tg.appendChild(acorner);
      days.forEach(function (o) {
        var a = el("div", "tg__acell" + (sameDay(o.j, today) ? " tg__acell--today" : ""));
        untimedOf(o.j).forEach(function (x) { a.appendChild(chipFor(x, o.j)); });
        a.setAttribute("data-jday", JSON.stringify(o.j));
        makeDrop(a, o.j);
        tg.appendChild(a);
      });
    }

    // body row: hour gutter + one timed column per day
    var gutter = el("div", "tg__gcell");
    gutter.style.height = gridH + "px";
    for (var hh = range.start; hh < range.end; hh++) {
      var lbl = el("div", "tt-hour", num(String(hh).padStart(2, "0") + ":00"));
      lbl.style.top = ((hh - range.start) * HOUR_H) + "px";
      gutter.appendChild(lbl);
    }
    tg.appendChild(gutter);

    days.forEach(function (o) {
      var col = el("div", "tg__col" + (sameDay(o.j, today) ? " tg__col--today" : "") +
        (CS.isHoliday(o.date) ? " tg__col--holiday" : ""));
      col.style.height = gridH + "px";
      col.setAttribute("data-jday", JSON.stringify(o.j));
      for (var hh2 = range.start; hh2 < range.end; hh2++) {
        var line = el("div", "tt-line");
        line.style.top = ((hh2 - range.start) * HOUR_H) + "px";
        col.appendChild(line);
      }
      var colList = timedOf(o.j);
      var colLay = layoutBlocks(colList);
      colList.forEach(function (x) { col.appendChild(timeBlock(x, range, colLay[x.id])); });
      if (sameDay(o.j, today)) {
        var nl = nowLine(range, true);
        if (nl) col.appendChild(nl);
      }
      if (isDay) attachDragCreate(col, o.j, range);
      else attachClickCreate(col, o.j, range);
      tg.appendChild(col);
    });

    panel.appendChild(tg);
    panel.appendChild(el("p", "cal-hint", T.t("cal_timedHint") + " · " + T.t("cal_rcHint")));
    host.appendChild(panel);

    var hasToday = days.some(function (o) { return sameDay(o.j, today); });
    requestAnimationFrame(function () {
      tg.scrollTop = hasToday ? nowOffset(range) : 7 * HOUR_H;
      // if the grid overflows horizontally (mobile week), scroll today into view
      if (hasToday && tg.scrollWidth > tg.clientWidth + 4) {
        var tc = tg.querySelector(".tg__col--today");
        if (tc) tc.scrollIntoView({ block: "nearest", inline: "center" });
      }
    });
  }

  // click an empty hour → new task at that hour (week / 3-day views)
  function attachClickCreate(col, jday, range) {
    col.addEventListener("click", function (e) {
      if (e.target.closest(".tt-block")) return;
      var rect = col.getBoundingClientRect();
      var hour = range.start + Math.floor((e.clientY - rect.top) / HOUR_H);
      window.TasksView.openNew(jday,
        String(Math.max(0, Math.min(23, hour))).padStart(2, "0") + ":00");
    });
  }

  // drag an empty range → new task with from/to (day view). Mouse drags start
  // immediately; touch requires a short hold so normal scrolling still works.
  function attachDragCreate(col, jday, range) {
    var selBox = null, selStartMin = null;
    function yToMin(clientY) {
      var rect = col.getBoundingClientRect();
      var y = Math.max(0, Math.min(rect.height, clientY - rect.top));
      var mins = range.start * 60 + (y / HOUR_H) * 60;
      return Math.round(mins / 15) * 15; // snap to 15 min
    }
    function drawSel(a, b) {
      if (!selBox) return;
      var lo = Math.min(a, b), hi = Math.max(a, b);
      selBox.style.top = ((lo - range.start * 60) / 60 * HOUR_H) + "px";
      selBox.style.height = Math.max(12, (hi - lo) / 60 * HOUR_H) + "px";
      selBox.textContent = num(fmtMin(lo)) + " – " + num(fmtMin(hi));
    }
    var holdTimer = null, pendingDown = null, selActive = false;
    function beginSel(clientY, pointerId) {
      selActive = true;
      selStartMin = yToMin(clientY);
      selBox = el("div", "tt-sel");
      col.appendChild(selBox);
      try { col.setPointerCapture(pointerId); } catch (err) {}
      drawSel(selStartMin, selStartMin + 15);
      if (navigator.vibrate) { try { navigator.vibrate(10); } catch (err) {} }
    }
    function cancelHold() {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      pendingDown = null;
    }
    col.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".tt-block")) return;
      if (e.button != null && e.button !== 0) return;
      if (e.pointerType === "mouse") { beginSel(e.clientY, e.pointerId); return; }
      pendingDown = { y: e.clientY, x: e.clientX, id: e.pointerId };
      holdTimer = setTimeout(function () {
        if (pendingDown) { beginSel(pendingDown.y, pendingDown.id); pendingDown = null; }
      }, 350);
    });
    col.addEventListener("pointermove", function (e) {
      if (pendingDown && !selActive) {
        if (Math.abs(e.clientY - pendingDown.y) > 8 || Math.abs(e.clientX - pendingDown.x) > 8) cancelHold();
        return;
      }
      if (selStartMin == null) return;
      e.preventDefault();
      drawSel(selStartMin, yToMin(e.clientY));
    });
    col.addEventListener("pointercancel", function () {
      cancelHold();
      if (selBox) { selBox.remove(); selBox = null; }
      selStartMin = null; selActive = false;
    });
    col.addEventListener("pointerup", function (e) {
      cancelHold();
      if (selStartMin == null || !selActive) { selActive = false; return; }
      var endMin = yToMin(e.clientY);
      var lo = Math.min(selStartMin, endMin), hi = Math.max(selStartMin, endMin);
      if (hi - lo < 15) hi = lo + 60; // a plain click → default 1h block
      if (selBox) { selBox.remove(); selBox = null; }
      selStartMin = null; selActive = false;
      window.TasksView.openNew(jday, fmtMin(lo), fmtMin(hi));
    });
  }

  // shared time helpers for the timed day/week grids
  var HOUR_H = 46; // px per hour
  function toMin(hhmm) {
    if (!hhmm) return null;
    var p = hhmm.split(":");
    return parseInt(p[0], 10) * 60 + parseInt(p[1] || "0", 10);
  }
  function hourRange(taskLists) {
    // Full day, always. Both views scroll and open near the morning so you can
    // reach any hour without the range clipping early/late tasks.
    return { start: 0, end: 24 };
  }
  function timedOf(day) {
    return (S.vault.tasks || []).filter(function (x) {
      return x.due && !x.archived && passesCalFilter(x) &&
        !isSpan(x) && sameDay(x.due, day) && x.timeFrom;
    });
  }
  function untimedOf(day) {
    return (S.vault.tasks || []).filter(function (x) {
      if (!x.due || x.archived || !passesCalFilter(x)) return false;
      if (isSpan(x)) return coversDay(x, day);       // multi-day → all-day row
      return sameDay(x.due, day) && !x.timeFrom;
    });
  }
  // Partition overlapping timed tasks into side-by-side columns (Google-style).
  // Returns a map id -> { col, cols } so blocks share width within a cluster.
  function layoutBlocks(list) {
    var items = list.map(function (x) {
      var s = toMin(x.timeFrom), e = toMin(x.timeTo) || (s + 60);
      if (e <= s) e = s + 30;
      return { x: x, s: s, e: e, col: 0, cols: 1 };
    }).sort(function (a, b) { return a.s - b.s || a.e - b.e; });
    var i = 0;
    while (i < items.length) {
      var cluster = [items[i]], clusterEnd = items[i].e, j = i + 1;
      while (j < items.length && items[j].s < clusterEnd) {
        cluster.push(items[j]); clusterEnd = Math.max(clusterEnd, items[j].e); j++;
      }
      var colsEnd = [];
      cluster.forEach(function (it) {
        var placed = false;
        for (var c = 0; c < colsEnd.length; c++) {
          if (it.s >= colsEnd[c]) { it.col = c; colsEnd[c] = it.e; placed = true; break; }
        }
        if (!placed) { it.col = colsEnd.length; colsEnd.push(it.e); }
      });
      cluster.forEach(function (it) { it.cols = colsEnd.length; });
      i = j;
    }
    var map = {};
    items.forEach(function (it) { map[it.x.id] = { col: it.col, cols: it.cols }; });
    return map;
  }

  // Red "now" line + its auto-updating tick. Returns the element; caller places
  // it in the grid. Only shown when `day` is today and within the range.
  function nowLine(range, isToday) {
    if (!isToday) return null;
    var line = el("div", "tt-now");
    line.appendChild(el("span", "tt-now__dot"));
    function place() {
      var n = new Date();
      var mins = n.getHours() * 60 + n.getMinutes();
      var y = ((mins - range.start * 60) / 60) * HOUR_H;
      line.style.top = y + "px";
    }
    place();
    if (nowLineTimer) clearInterval(nowLineTimer);   // only one can be current
    nowLineTimer = setInterval(function () {
      if (!document.body.contains(line)) {
        clearInterval(nowLineTimer);
        nowLineTimer = null;
        return;
      }
      place();
    }, 60000);
    line.__timer = nowLineTimer;
    return line;
  }
  function nowOffset(range) {
    var n = new Date();
    var mins = n.getHours() * 60 + n.getMinutes();
    return Math.max(0, ((mins - range.start * 60) / 60) * HOUR_H - 120);
  }

  function timeBlock(x, range, lay) {
    var s = toMin(x.timeFrom);
    var e = toMin(x.timeTo) || (s + 60);
    if (e <= s) e = s + 30;
    var top = ((s - range.start * 60) / 60) * HOUR_H;
    var h = Math.max(20, ((e - s) / 60) * HOUR_H);
    var b = el("div", "tt-block " + window.TaskColor.cls(x.color) +
      (x.done ? " tt-block--done" : "") + (isEventRec(x) ? " tt-block--event" : ""));
    if (window.TaskColor.isCustom(x.color)) b.style.setProperty("--tc", x.color);
    b.setAttribute("data-task-id", x.id);
    b.style.top = top + "px";
    b.style.height = h + "px";
    if (lay && lay.cols > 1) {
      // side-by-side geometry as a fraction of the day column itself —
      // works identically in RTL and LTR, never overflows the column
      var off = (lay.col / lay.cols) * 100, frac = 100 / lay.cols;
      b.style.insetInlineStart = "calc(" + off + "% + 2px)";
      b.style.width = "calc(" + frac + "% - 5px)";
      b.style.insetInlineEnd = "auto";
      b.classList.add("tt-block--split");
    }
    var lbl = el("span", "tt-block__time",
      num(x.timeFrom) + (x.timeTo ? "–" + num(x.timeTo) : ""));
    b.appendChild(lbl);
    b.appendChild(el("span", "tt-block__title", x.title));
    var handle = el("div", "tt-block__resize");
    b.appendChild(handle);
    attachBlockDrag(b, x, range, handle, lbl);
    attachTaskMenu(b, x);      // right-click + long-press (v1.13.2)
    return b;
  }

  // lightweight right-click / long-press menu for a task on the calendar
  function blockMenu(e, x) {
    e.preventDefault();
    document.querySelectorAll(".ctx-menu").forEach(function (n) { n.remove(); });
    var task = (S.vault.tasks || []).find(function (t2) { return t2.id === x.id; });
    if (!task) return;
    var menu = el("div", "ctx-menu");

    function item(label, fn, danger) {
      var it = el("button", "ctx-item" + (danger ? " ctx-item--danger" : ""), label);
      it.addEventListener("click", async function () {
        menu.remove();
        await fn();
      });
      return it;
    }
    menu.appendChild(item(T.t(task.done ? "ctx_undone" : "ctx_done"), async function () {
      task.done = !task.done;
      task.doneAt = task.done ? new Date().toISOString() : null;
      renderRoute(); persistBg();
    }));
    menu.appendChild(item("→ " + T.t("ctx_tomorrow"), async function () {
      if (task.due) {
        var g = J.toGregorian(task.due.jy, task.due.jm, task.due.jd);
        var d = new Date(g.gy, g.gm - 1, g.gd); d.setDate(d.getDate() + 1);
        var nj = dateToJ(d);
        task.due = { jy: nj.jy, jm: nj.jm, jd: nj.jd };
        noteReschedule(task);   // v5.3: pushing to tomorrow IS a reschedule
        renderRoute(); persistBg();
      }
    }));
    menu.appendChild(item(T.t("edit"), async function () { window.TasksView.openById(x.id); }));

    // color row
    var colors = el("div", "ctx-colors");
    ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"].forEach(function (cc) {
      var dot = el("button", "ctx-dot task-" + cc + (task.color === cc ? " active" : ""));
      dot.addEventListener("click", async function () {
        task.color = cc; menu.remove();
        renderRoute(); persistBg();
      });
      colors.appendChild(dot);
    });
    menu.appendChild(colors);

    menu.appendChild(item(T.t("delete"), async function () {
      S.trashPut("task", task);
      S.vault.tasks = (S.vault.tasks || []).filter(function (t2) { return t2.id !== x.id; });
      window.UI.toast(T.t("msg_trashed"), { kind: "success" }); renderRoute(); persistBg();
    }, true));

    document.body.appendChild(menu);
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var px = Math.min(e.clientX, window.innerWidth - mw - 8);
    var py = Math.min(e.clientY, window.innerHeight - mh - 8);
    menu.style.left = px + "px";
    menu.style.top = py + "px";
    setTimeout(function () {
      document.addEventListener("click", function close() {
        menu.remove();
        document.removeEventListener("click", close);
      });
    }, 0);
  }

  // v1.13.2 (فاز B مورد ۱۴): phones get the same task menu as desktop
  // right-click. iOS never fires "contextmenu" for touch, so the 450ms hold is
  // detected manually; Android *does* fire it, so the swallow flags eat the
  // native event that lands right after ours (one menu, no flicker) and the
  // ghost click that follows pointerup (which would close the menu or open the
  // editor). A hold that already turned into a drag (chips/blocks lift at
  // 280–300ms) never opens the menu.
  var lpSwallowClick = false, lpSwallowCtx = false;
  document.addEventListener("click", function (e) {
    if (lpSwallowClick) { lpSwallowClick = false; e.preventDefault(); e.stopPropagation(); }
  }, true);
  function attachTaskMenu(node, x) {
    var lpTimer = null, lpX = 0, lpY = 0, lpId = null;
    node.addEventListener("contextmenu", function (e) {
      if (lpSwallowCtx) { lpSwallowCtx = false; e.preventDefault(); return; }
      blockMenu(e, x);
    });
    node.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "touch" || lpId !== null) return;
      lpId = e.pointerId; lpX = e.clientX; lpY = e.clientY;
      lpTimer = setTimeout(function () {
        lpTimer = null;
        if (document.querySelector(".drag-ghost, .kb-ghost, .tt-block--dragging")) return;
        lpSwallowClick = true; lpSwallowCtx = true;
        setTimeout(function () { lpSwallowClick = false; lpSwallowCtx = false; }, 700);
        if (window.FX && window.FX.haptic) window.FX.haptic("soft");
        blockMenu({ preventDefault: function () {}, clientX: lpX, clientY: lpY }, x);
      }, 450);
    });
    function lpEnd(e) {
      if (e.pointerId !== lpId) return;
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
      lpId = null;
    }
    node.addEventListener("pointermove", function (e) {
      if (e.pointerId !== lpId || !lpTimer) return;
      if (Math.abs(e.clientX - lpX) > 8 || Math.abs(e.clientY - lpY) > 8) {
        clearTimeout(lpTimer); lpTimer = null;
      }
    });
    node.addEventListener("pointerup", lpEnd);
    node.addEventListener("pointercancel", lpEnd);
  }

  function fmtMin(mins) {
    mins = ((mins % 1440) + 1440) % 1440;
    var h = Math.floor(mins / 60), m = mins % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  // Drag a timed block to reschedule (move whole block) or resize (bottom edge)
  // — pointer-based so it works on mouse and touch, like Google/Notion Calendar.
  function attachBlockDrag(b, x, range, handle, lbl) {
    var mode = null;        // "move" | "resize"
    var startY = 0, startX = 0, origTop = 0, origH = 0, moved = false, holdT = null;
    var durMin = (toMin(x.timeTo) || (toMin(x.timeFrom) + 60)) - toMin(x.timeFrom);
    if (durMin <= 0) durMin = 30;

    function snap(px) { return Math.round(px / (HOUR_H / 4)) * (HOUR_H / 4); } // 15-min grid
    function begin(kind) {
      mode = kind; moved = true;
      b.classList.add("tt-block--dragging");
    }
    function onMove(e) {
      if (!mode) {
        if (Math.abs(e.clientY - startY) > 6 || Math.abs(e.clientX - startX) > 6) {
          if (holdT) { clearTimeout(holdT); holdT = null; }
          begin(handleHit ? "resize" : "move");
        } else return;
      }
      e.preventDefault();
      if (mode === "resize") {
        var nh = Math.max(HOUR_H / 4, snap(origH + (e.clientY - startY)));
        b.style.height = nh + "px";
        var startMin = range.start * 60 + Math.round(origTop / HOUR_H * 60);
        var endMin = startMin + Math.round(nh / HOUR_H * 60);
        if (lbl) lbl.textContent = num(fmtMin(startMin)) + "–" + num(fmtMin(endMin));
      } else {
        var nt = snap(origTop + (e.clientY - startY));
        nt = Math.max(0, Math.min((range.end - range.start) * HOUR_H - origH, nt));
        b.style.top = nt + "px";
        var sMin = range.start * 60 + Math.round(nt / HOUR_H * 60);
        if (lbl) lbl.textContent = num(fmtMin(sMin)) + "–" + num(fmtMin(sMin + durMin));
        // highlight a different day column if hovering one (week view)
        var under = document.elementFromPoint(e.clientX, e.clientY);
        document.querySelectorAll(".drop-hot").forEach(function (n) { n.classList.remove("drop-hot"); });
        var col = under && under.closest("[data-jday]");
        if (col) col.classList.add("drop-hot");
      }
    }
    async function onUp(e) {
      var wasMode = mode;
      if (holdT) { clearTimeout(holdT); holdT = null; }
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      b.classList.remove("tt-block--dragging");
      document.querySelectorAll(".drop-hot").forEach(function (n) { n.classList.remove("drop-hot"); });
      if (!wasMode) { window.TasksView.openById(x.id); return; } // plain click → edit
      mode = null;

      var task = (S.vault.tasks || []).find(function (t2) { return t2.id === x.id; });
      if (!task) return;

      if (wasMode === "resize") {
        var nh = parseFloat(b.style.height);
        var sMin = toMin(task.timeFrom);
        var eMin = sMin + Math.round(nh / HOUR_H * 60);
        task.timeTo = fmtMin(eMin);
      } else {
        var nt = parseFloat(b.style.top);
        var sMin2 = range.start * 60 + Math.round(nt / HOUR_H * 60);
        task.timeFrom = fmtMin(sMin2);
        task.timeTo = fmtMin(sMin2 + durMin);
        // dropped on another day column?
        var under = document.elementFromPoint(e.clientX, e.clientY);
        var col = under && under.closest("[data-jday]");
        if (col) {
          try {
            var d = JSON.parse(col.getAttribute("data-jday"));
            if (task.due && (task.due.jy !== d.jy || task.due.jm !== d.jm || task.due.jd !== d.jd)) {
              task.due = { jy: d.jy, jm: d.jm, jd: d.jd };
              noteReschedule(task);   // v5.3: dragging to another day counts too
            }
          } catch (err) {}
        }
      }
      renderRoute(); persistBg();
    }

    var handleHit = false;
    b.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      handleHit = (e.target === handle);
      startY = e.clientY; startX = e.clientX;
      origTop = parseFloat(b.style.top) || 0;
      origH = parseFloat(b.style.height) || HOUR_H;
      moved = false; mode = null;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      // long-press starts a move on touch without needing a big drag
      holdT = setTimeout(function () { if (!mode) begin(handleHit ? "resize" : "move"); }, 300);
    });
  }

  function appendDayRows(p, day) {
    var list = (S.vault.tasks || []).filter(function (x) {
      return x.due && sameDay(x.due, day);
    }).sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (a.timeFrom || "99:99").localeCompare(b.timeFrom || "99:99");
    });
    if (!list.length) {
      p.appendChild(el("p", "panel__text", T.t("day_none")));
      return;
    }
    list.forEach(function (x) {
      var row = el("div", "day-task " + window.TaskColor.cls(x.color) + (x.done ? " day-task--done" : ""));
      if (window.TaskColor.isCustom(x.color)) row.style.setProperty("--tc", x.color);
      var c = el("input"); c.type = "checkbox"; c.className = "task-check task-check--sm";
      c.checked = !!x.done;
      c.addEventListener("change", async function () {
        x.done = c.checked;
        x.doneAt = c.checked ? new Date().toISOString() : null;
        renderRoute(); persistBg();
      });
      row.appendChild(c);
      if (x.timeFrom) row.appendChild(el("span", "day-task__time",
        num(x.timeFrom) + (x.timeTo ? "–" + num(x.timeTo) : "")));
      var tt = el("span", "day-task__title", x.title);
      tt.addEventListener("click", function () { window.TasksView.openById(x.id); });
      row.appendChild(tt);
      if (x.pr === "high") row.appendChild(el("span", "badge badge--high", T.t("pr_high")));
      if (x.cat === "exam") row.appendChild(el("span", "badge badge--exam", T.t("cat_exam")));
      if (x.link) {
        var la = el("a", "badge badge--link"); la.appendChild(icn("link"));
        la.href = x.link; la.target = "_blank"; la.rel = "noopener noreferrer";
        row.appendChild(la);
      }
      p.appendChild(row);
    });
  }

  function dayPanel(day) {
    var p = el("div", "panel day-panel");
    var head = el("div", "day-panel__head");
    var dpd = CS.jToDisp(day);
    head.appendChild(el("h2", "panel__title",
      T.t("day_tasks") + " — " + num(dpd.d) + " " + CS.monthName(dpd.m)));
    var add = el("button", "btn btn--primary btn--sm", T.t("day_add"));
    add.addEventListener("click", function () { window.TasksView.openNew(day); });
    head.appendChild(add);

    /* v4.1 — picking a day opened this panel with no way out: the month
     * stayed pushed up and the only escape was picking another day or
     * leaving the route entirely. A panel that can be opened must be
     * closable. Escape works too, since that's what a dismissible thing
     * should answer to. */
    var close = el("button", "icon-btn day-panel__close");
    close.type = "button";
    close.setAttribute("aria-label", T.t("close"));
    close.title = T.t("close");
    close.appendChild(icn("close"));
    close.addEventListener("click", function () { selDay = null; renderRoute(); });
    head.appendChild(close);

    p.appendChild(head);
    appendDayRows(p, day);
    return p;
  }

  // ---- notes --------------------------------------------------------------
  function extractTags(text) {
    var out = {};
    ((text || "").match(/#[\u0600-\u06FF\w\u200c]+/g) || []).forEach(function (h) { out[h] = 1; });
    return out;
  }

  // v1.16 (فاز F مورد ۳۶): folders (a plain field on the note — no schema
  // migration, missing folder = «همه»), pinned-first ordering, and a Markdown
  // export of the current view.
  var noteFolder = null;
  function notesToMarkdown(list) {
    return list.map(function (n) {
      var head = "## " + (n.title || T.t("untitled"));
      if (n.folder) head += "  \n*" + T.t("n_folder") + ": " + n.folder + "*";
      var body = n.body || (n.html ? window.RT.htmlToText(n.html) : "");
      return head + "\n\n" + (body || "") + "\n";
    }).join("\n---\n\n");
  }
  // "2026-07-21" → «۳۰ تیر» / "21 Jul", respecting the active calendar system
  function isoJLabel(iso) {
    try {
      var pr = iso.split("-");
      var jt = J.toJalaali(+pr[0], +pr[1], +pr[2]);
      return CS.label({ jy: jt.jy, jm: jt.jm, jd: jt.jd });
    } catch (e) { return iso; }
  }

  /* v3.9.0 — note card overflow menu (same .tb-pop control as elsewhere). */
  /* one writer for both the "all notes" button and the per-note menu, so the
   * two exports can never drift into different file formats. A filename is
   * built from the note's own title where there is one — a folder full of
   * "notes-2026-07-23.md" helps nobody. */
  function exportNotesFile(list, baseName) {
    if (!list || !list.length) { status("tr_empty", "error"); return; }
    var safe = String(baseName || "notes")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")   // illegal on Windows and friends
      .replace(/\s+/g, " ").trim() || "note";
    var blob = new Blob([notesToMarkdown(list)], { type: "text/markdown;charset=utf-8" });
    var a = el("a"); a.href = URL.createObjectURL(blob);
    a.download = safe + "-" + new Date().toISOString().slice(0, 10) + ".md";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    status("n_exported", "success");
  }

  function noteMenu(anchorEl, n) {
    var existing = document.querySelector(".tb-pop");
    if (existing) { existing.remove(); return; }
    var pop = el("div", "tb-pop");

    /* v4.6 — exporting used to be all-or-nothing: the toolbar button dumped
     * every note in the current folder into one file. Wanting ONE note out —
     * to send it, publish it, keep it — is the far more common wish, and it
     * had no answer. Same writer, one item. */
    var md = el("button", "tb-pop__item", T.t("n_exportOne"));
    md.addEventListener("click", function () {
      pop.remove();
      exportNotesFile([n], (n.title || T.t("untitled")).slice(0, 60));
    });
    pop.appendChild(md);
    pop.appendChild(el("div", "tb-pop__sep"));

    var del = el("button", "tb-pop__item", T.t("delete"));
    del.addEventListener("click", function () { pop.remove(); deleteNote(n.id); });
    pop.appendChild(del);
    document.body.appendChild(pop);
    var r = anchorEl.getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + "px";
    var w = pop.offsetWidth || 200;
    pop.style.insetInlineStart = "auto";
    pop.style.left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8) + "px";
    function close() {
      if (pop.parentNode) pop.remove();
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
    del.focus();
  }

  function renderNotes(host) {
    var tb = el("div", "toolbar");
    var add = el("button", "btn btn--primary btn--sm", T.t("newNote"));
    add.addEventListener("click", function () { openEditor(null); });
    tb.appendChild(add);
    var mdBtn = el("button", "btn btn--ghost btn--sm n-export", T.t("n_exportMd"));
    mdBtn.addEventListener("click", function () {
      var list = (S.vault.notes || []).filter(function (n) {
        return !noteFolder || (n.folder || "") === noteFolder;
      });
      if (!list.length) { status("tr_empty", "error"); return; }
      exportNotesFile(list, "notes");
    });
    tb.appendChild(mdBtn);
    host.appendChild(tb);

    // v2.2: a notes app without in-page search is a filing cabinet with the
    // drawers glued shut. Search, sort and density live together.
    var tools = el("div", "n-tools");
    var sIn = el("input", "dg-input n-tools__search");
    sIn.type = "search"; sIn.placeholder = T.t("n_searchPh"); sIn.value = noteQuery;
    sIn.addEventListener("input", function () {
      noteQuery = sIn.value;
      if (noteQTimer) clearTimeout(noteQTimer);
      noteQTimer = setTimeout(function () { renderRoute(); }, 180);
    });
    tools.appendChild(sIn);

    var sortSel = el("select", "sel");
    [["updated", "n_sortUpdated"], ["created", "n_sortCreated"], ["title", "n_sortTitle"]]
      .forEach(function (o) {
        var op = el("option", null, T.t(o[1])); op.value = o[0];
        if (noteSort === o[0]) op.selected = true;
        sortSel.appendChild(op);
      });
    sortSel.addEventListener("change", function () {
      noteSort = sortSel.value; setPref("sp_notesort", noteSort); renderRoute();
    });
    tools.appendChild(sortSel);

    var dens = el("button", "icon-btn");
    dens.appendChild(icn(noteDense === "rows" ? "lists" : "kanban"));
    dens.title = T.t("n_density");
    dens.addEventListener("click", function () {
      noteDense = noteDense === "rows" ? "grid" : "rows";
      setPref("sp_notedense", noteDense);
      renderRoute();
    });
    tools.appendChild(dens);
    host.appendChild(tools);

    noteSort = pref("sp_notesort", "updated");
    noteDense = pref("sp_notedense", "grid");

    var all = (S.vault.notes || []).slice();

    // folder chips
    var folders = {};
    all.forEach(function (n) { if (n.folder) folders[n.folder] = (folders[n.folder] || 0) + 1; });
    var fnames = Object.keys(folders).sort();
    if (noteFolder && !folders[noteFolder]) noteFolder = null;
    if (fnames.length) {
      var fbar = el("div", "tg-cloud tg-cloud--inline");
      var fall = el("button", "tg-chip" + (noteFolder ? "" : " on"), T.t("n_allFolders"));
      fall.addEventListener("click", function () { noteFolder = null; renderRoute(); });
      fbar.appendChild(fall);
      fnames.forEach(function (f) {
        var c = el("button", "tg-chip" + (noteFolder === f ? " on" : ""),
          f + " · " + num(folders[f]));
        c.addEventListener("click", function () {
          noteFolder = (noteFolder === f) ? null : f;
          renderRoute();
        });
        fbar.appendChild(c);
      });
      host.appendChild(fbar);
    }
    if (noteFolder) {
      all = all.filter(function (n) { return (n.folder || "") === noteFolder; });
    }
    all.sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0); });

    // hashtag filter bar
    var tagmap = {};
    all.forEach(function (n) {
      Object.keys(extractTags((n.title || "") + " " + (n.body || ""))).forEach(function (h) {
        tagmap[h] = (tagmap[h] || 0) + 1;
      });
    });
    var tags = Object.keys(tagmap).sort(function (a, b) { return tagmap[b] - tagmap[a]; });
    if (noteTagFilter && !tagmap[noteTagFilter]) noteTagFilter = null;
    if (tags.length) {
      var bar = el("div", "tg-cloud tg-cloud--inline");
      tags.forEach(function (h) {
        var b = el("button", "tag-chip" + (noteTagFilter === h ? " active" : ""),
          h + " · " + num(tagmap[h]));
        b.addEventListener("click", function () {
          noteTagFilter = noteTagFilter === h ? null : h;
          renderRoute();
        });
        bar.appendChild(b);
      });
      host.appendChild(bar);
    }

    var q = noteQuery.trim().toLowerCase();
    var notes = all.filter(function (n) {
      if (noteTagFilter && !extractTags((n.title || "") + " " + (n.body || ""))[noteTagFilter]) {
        return false;
      }
      if (!q) return true;
      return ((n.title || "") + " " + (n.body || "")).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      // pinned always float, whatever the sort — that is what pinning means
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      if (noteSort === "title") {
        return (a.title || "").localeCompare(b.title || "", "fa");
      }
      if (noteSort === "created") {
        return (b.createdAt || b.updatedAt || "").localeCompare(a.createdAt || a.updatedAt || "");
      }
      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    });

    if (!notes.length) {
      if (q || noteTagFilter) {
        host.appendChild(el("p", "panel__text", T.t("n_noMatch")));
      } else {
        host.appendChild(window.FX.empty("notes", T.t("emptyNotes"), T.t("emptyNotesSub"),
          { label: T.t("newNote"), onClick: function () { openEditor(null); } }));
      }
      return;
    }

    var grid = el("div", "notes-grid" + (noteDense === "rows" ? " notes-grid--rows" : ""));
    notes.forEach(function (n) {
      var card = el("div", "note-card" + (n.pinned ? " note-card--pinned" : ""));

      var head = el("div", "note-card__top");
      if (n.mood != null) {
        var md = el("span", "note-card__mood");
        md.appendChild(icn("mood-" + n.mood));
        head.appendChild(md);
      }
      head.appendChild(el("h3", "note-card__title", n.title || T.t("untitled")));
      if (n.jdate) head.appendChild(el("span", "note-card__date", isoJLabel(n.jdate)));
      if (n.folder) head.appendChild(el("span", "note-card__folder", n.folder));
      var pin = el("button", "note-pin" + (n.pinned ? " on" : "")); pin.appendChild(icn("pin"));
      pin.type = "button";
      pin.title = T.t(n.pinned ? "n_unpin" : "n_pin");
      pin.addEventListener("click", async function () {
        n.pinned = !n.pinned;
        renderRoute(); persistBg();
      });
      head.appendChild(pin);
      card.appendChild(head);

      if (n.html || n.body) {
        var bd = el("div", "note-card__body");
        if (q) {
          // While searching, show a plain excerpt around the hit with the term
          // marked. Built with text nodes and <mark> — the sanitised HTML path
          // is skipped here on purpose so nothing can be injected via a query.
          var plain = (n.body || (n.html ? window.RT.htmlToText(n.html) : "")) || "";
          var at = plain.toLowerCase().indexOf(q);
          var from = at > 40 ? at - 40 : 0;
          var slice = (from ? "…" : "") + plain.slice(from, from + 180);
          var low = slice.toLowerCase();
          var pos = low.indexOf(q), cur = 0;
          while (pos >= 0) {
            bd.appendChild(document.createTextNode(slice.slice(cur, pos)));
            var mk = el("mark", "n-hit", slice.substr(pos, q.length));
            bd.appendChild(mk);
            cur = pos + q.length;
            pos = low.indexOf(q, cur);
          }
          bd.appendChild(document.createTextNode(slice.slice(cur)));
        } else {
          bd.innerHTML = window.RT.sanitize(n.html || window.RT.textToHtml(n.body));
          window.Links.decorate(bd);   // [[links]] become clickable (v1.13)
        }
        card.appendChild(bd);
      }
      /* v3.9.0 — every card carried a visible Edit and Delete, so a wall of
       * six buttons appeared before you'd read a single note, and the
       * destructive one sat at the same weight as the everyday one. The card
       * itself opens the note now (the obvious gesture, which previously did
       * nothing), and delete lives in a "⋯" menu. */
      var actions = el("div", "note-card__actions");
      var open = el("button", "btn btn--ghost btn--sm", T.t("edit"));
      open.addEventListener("click", function (e) { e.stopPropagation(); openEditor(n.id); });
      var nMore = el("button", "btn btn--ghost btn--sm icon-only", "\u22EF");
      nMore.type = "button";
      nMore.setAttribute("aria-label", T.t("tb_more"));
      nMore.setAttribute("aria-haspopup", "true");
      nMore.addEventListener("click", function (e) {
        e.stopPropagation();
        noteMenu(nMore, n);
      });
      actions.appendChild(open); actions.appendChild(nMore);
      card.appendChild(actions);
      card.classList.add("note-card--open");
      card.addEventListener("click", function () { openEditor(n.id); });
      grid.appendChild(card);
    });
    host.appendChild(grid);
  }

  var noteRT = null;
  // exposed so [[links]] and the palette can open a note directly (v1.13)
  window.NotesView = { openById: function (id) { location.hash = "#/notes"; openEditor(id); } };
  var editorMood = null;
  function openEditor(id) {
    editingNoteId = id || null;
    var note = id ? (S.vault.notes || []).find(function (n) { return n.id === id; }) : null;
    $("editor-heading").textContent = id ? T.t("editNote") : T.t("newNote");
    $("editor-title").value = note ? note.title || "" : "";
    $("editor-folder").value = note ? note.folder || "" : (noteFolder || "");

    // v3.5 (فاز ۴): the journal merged into notes, so every note can carry a
    // mood. Optional — click the active one again to clear it.
    editorMood = (note && note.mood != null) ? note.mood : null;
    var moodRow = $("editor-mood");
    if (moodRow) {
      moodRow.textContent = "";
      ["mood-0", "mood-1", "mood-2", "mood-3", "mood-4"].forEach(function (m, i) {
        var b = el("button", "mood-btn" + (editorMood === i ? " active" : ""));
        b.type = "button"; b.title = T.t("mood_" + i);
        b.appendChild(icn(m));
        b.addEventListener("click", function () {
          editorMood = (editorMood === i) ? null : i;
          moodRow.querySelectorAll(".mood-btn").forEach(function (x, xi) {
            x.classList.toggle("active", editorMood === xi);
          });
          markDirty();
        });
        moodRow.appendChild(b);
      });
    }
    var dl = $("note-folders"); dl.textContent = "";
    var seen = {};
    (S.vault.notes || []).forEach(function (n) {
      if (n.folder && !seen[n.folder]) {
        seen[n.folder] = true;
        var op = el("option"); op.value = n.folder; dl.appendChild(op);
      }
    });
    var slot = $("editor-body-slot");
    slot.textContent = "";
    noteRT = window.RT.editor(
      note ? (note.html || window.RT.textToHtml(note.body)) : "", T.t);
    slot.appendChild(noteRT.root);
    var oldBl = $("editor").querySelector(".bl-panel");
    if (oldBl) oldBl.remove();
    if (id) {
      var bl = window.Links.backlinksPanel("note", id, function () { closeOverlay("editor"); });
      if (bl) slot.parentNode.insertBefore(bl, slot.nextSibling);
    }
    // v2.2: a note deserves a writing surface, not a cramped dialog.
    $("editor").classList.remove("hidden");
    $("editor").classList.add("overlay--write");

    // autosave: losing writing because you didn't press a button is the one
    // thing a notes app may never do. Debounced so it saves on a pause, not
    // on every keystroke.
    var st = $("editor-status");
    if (st) {
      st.textContent = "";
      st.className = "n-status";
    }
    if (noteAuto) { clearTimeout(noteAuto); noteAuto = null; }
    function markDirty() {
      if (st) { st.textContent = T.t("n_unsaved"); st.className = "n-status n-status--dirty"; }
      if (noteAuto) clearTimeout(noteAuto);
      noteAuto = setTimeout(async function () {
        noteAuto = null;
        var ok = await saveEditor({ silent: true });
        if (ok && st) { st.textContent = T.t("n_saved"); st.className = "n-status n-status--ok"; }
        updateCount();
      }, 1200);
    }
    function updateCount() {
      var c = $("editor-count");
      if (!c) return;
      var txt = (noteRT ? noteRT.getText() : "").trim();
      var words = txt ? txt.split(/\s+/).length : 0;
      c.textContent = num(words) + " " + T.t("n_words");
    }
    $("editor-title").oninput = markDirty;
    $("editor-folder").oninput = markDirty;
    noteRT.root.addEventListener("input", function () { markDirty(); updateCount(); });
    updateCount();

    $("editor-title").focus();
  }
  async function saveEditor(opts) {
    opts = opts || {};
    var title = $("editor-title").value.trim();
    var folder = $("editor-folder").value.trim().slice(0, 40);
    var html = noteRT ? noteRT.getHTML() : "";
    var body = noteRT ? noteRT.getText() : "";
    if (!title && !body.trim()) {
      if (opts.silent) return false;      // an empty autosave writes nothing
      closeOverlay("editor");
      return false;
    }
    var now = new Date().toISOString();
    if (!S.vault.notes) S.vault.notes = [];
    if (editingNoteId) {
      var n = S.vault.notes.find(function (x) { return x.id === editingNoteId; });
      if (n) { n.title = title; n.body = body; n.html = html; n.folder = folder; n.mood = editorMood; n.updatedAt = now; }
    } else {
      var fresh = {
        id: "n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title: title, body: body, html: html, folder: folder,
        mood: editorMood,
        createdAt: now, updatedAt: now,
      };
      S.vault.notes.push(fresh);
      // an autosaved new note keeps editing the SAME record instead of
      // creating a duplicate on every pause
      editingNoteId = fresh.id;
    }
    // The ONE place that still waits, on purpose: the note editor's autosave
    // shows a real "saved / unsaved" indicator, and an indicator that reports
    // success before the write lands would be lying about the safety of the
    // user's writing. Everything else in the app is optimistic.
    if (opts.silent) return await persist();
    if (noteAuto) { clearTimeout(noteAuto); noteAuto = null; }
    closeOverlay("editor");
    status("msg_saved", "success"); renderRoute(); persistBg();
    return true;
  }
  async function deleteNote(id) {
    if (!(await window.UI.confirm({ body: T.t("confirmDeleteNote"), danger: true }))) return;
    var n = (S.vault.notes || []).find(function (x) { return x.id === id; });
    if (n) S.trashPut("note", n);
    S.vault.notes = (S.vault.notes || []).filter(function (x) { return x.id !== id; });
    status("msg_trashed", "success"); renderRoute(); persistBg();
  }

  // ---- offline pill (v1.13.3, فاز C مورد ۱۵) ------------------------------
  // A small truth-teller in the header: hidden when everything is synced,
  // amber while changes wait locally, accent-colored while syncing.
  function initNetPill() {
    var actions = document.querySelector(".content-actions");
    if (!actions || $("net-pill")) return;
    var pill = el("span", "net-pill hidden");
    pill.id = "net-pill";
    actions.insertBefore(pill, actions.firstChild);
    function paint(d) {
      var key = d.syncing ? "net_sync" : ((d.offline || d.pending) ? "net_off" : null);
      pill.classList.toggle("hidden", !key);
      pill.classList.toggle("net-pill--sync", !!d.syncing);
      if (key) {
        pill.setAttribute("data-i18n", key);
        pill.textContent = T.t(key);
        pill.title = T.t("net_off_hint");
      }
    }
    document.addEventListener("sp:net", function (ev) {
      var d = ev.detail || {};
      if (d.back) window.UI.toast(T.t("net_back"), { kind: "success" });
      paint(d);
    });
    var n0 = S.net();                       // state set before the pill existed
    paint({ offline: n0.offline, pending: n0.pending });
    if (n0.dropped) {
      window.UI.toast(T.t("net_dropped"), { kind: "warning" });
      S.clearDropped();
    }
  }

  async function persist() {
    try { await S.save(); return true; }
    catch (e) {
      // v4.8 (فاز F): a frozen (read-only) vault gets its own message, not the
      // generic "save failed" — the edit was refused on purpose.
      var key = e.code === "readonly" ? "ro_blocked"
              : e.code === "conflict" ? "msg_conflict"
              : "msg_saveFail";
      status(key, "error");
      return false;
    }
  }

  // v3.1 (فاز N11): optimistic save.
  //
  // Every interaction used to run `if (await persist()) rerender()`, which
  // means the user waited for: the 700ms save debounce, then encrypting the
  // whole vault, then a full network round trip — BEFORE the screen changed.
  // Dropping a kanban card left it visibly in the old column for a second or
  // more on a good connection, and much longer on a bad one. That is the
  // "kanban is slow" report, and it applied to every checkbox in the app.
  //
  // Now the screen updates immediately and the save runs behind it. A failed
  // save still tells the user (persist() shows the error), and the offline
  // queue already handles being disconnected — so the only thing we gave up
  // is a delay nobody wanted.
  function persistBg() {
    persist();
    return true;
  }

  // ---- settings -----------------------------------------------------------
  function seg(current, options, onPick) {
    var box = el("div", "seg");
    options.forEach(function (o) {
      var b = el("button", "seg__btn" + (String(o.val) === String(current) ? " active" : ""), o.label);
      b.addEventListener("click", function () {
        // Move the selected indicator immediately, even for controls whose
        // handler doesn't re-render (e.g. density) — fixes the switch that
        // "didn't move" (B1).
        Array.prototype.forEach.call(box.children, function (c) { c.classList.remove("active"); });
        b.classList.add("active");
        onPick(o.val);
      });
      box.appendChild(b);
    });
    return box;
  }
  function settingRow(label, control) {
    var row = el("div", "set-row");
    row.appendChild(el("div", "set-row__label", label));
    row.appendChild(control);
    return row;
  }
  // ---- Settings hub (v1.9, Telegram-style) ---------------------------------
  // Settings used to be one long page. It's now a hub of focused sections
  // (mirrors the Help hub pattern): Personalize / Privacy & Security /
  // Notifications / Data / Language / Help. Every control from the old page
  // lives in exactly one section — nothing was dropped.
  var settingsSection = null;   // null = the hub itself

  /* v5.3 — subscription meter. Term length is derived from expiry + days left
   * rather than adding a field. The ticker stops when the view is replaced so
   * it can't fire against a detached node. */
  var subTimer = null;
  function subMeter(untilStr, daysLeft) {
    var wrap = el("div", "sm-box");
    var g = untilStr.split("-").map(Number);
    var end = new Date(g[0], g[1] - 1, g[2], 23, 59, 59);

    // Assume a term of at least as long as what remains, rounded up to a
    // familiar plan length, so the bar has an honest denominator.
    var PLANS = [30, 90, 180, 365];
    var term = PLANS.find(function (p) { return p >= daysLeft; }) || daysLeft;
    var pct = Math.max(0, Math.min(100, Math.round((1 - daysLeft / term) * 100)));

    var head = el("div", "sm-head");
    head.appendChild(el("span", "sm-head__t", T.t("sub_widget")));
    head.appendChild(el("span", "sm-head__p", T.t("sub_pct").replace("{n}", num(pct))));
    wrap.appendChild(head);

    var track = el("div", "sm-track");
    var fill = el("i", "sm-fill" + (daysLeft <= 7 ? " sm-fill--warn" : ""));
    fill.style.width = pct + "%";
    track.appendChild(fill);
    wrap.appendChild(track);

    var cd = el("div", "sm-cd");
    wrap.appendChild(cd);

    var months = Math.round(daysLeft / 30);
    if (months >= 1) {
      wrap.appendChild(el("div", "sm-months",
        T.t("sub_months").replace("{n}", num(months))));
    }
    wrap.appendChild(el("div", "sm-note", T.t("sub_endsRo")));

    function tick() {
      var ms = end - new Date();
      if (ms <= 0) { cd.textContent = T.t("sub_expired"); stop(); return; }
      var sec = Math.floor(ms / 1000);
      var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
      var m = Math.floor((sec % 3600) / 60), sx = sec % 60;
      cd.textContent = T.t("sub_dhms")
        .replace("{d}", num(d)).replace("{h}", num(h))
        .replace("{m}", num(m)).replace("{s}", num(sx));
    }
    function stop() { if (subTimer) { clearInterval(subTimer); subTimer = null; } }
    stop();
    tick();
    subTimer = setInterval(function () {
      if (!document.body.contains(cd)) { stop(); return; }   // view replaced
      tick();
    }, 1000);
    return wrap;
  }

  function renderSettings(host) {
    if (settingsSection) return renderSettingsSection(host, settingsSection);

    // Subscription card on the hub top (v1.10): status, days left, expiry
    // date in the display calendar — the user should never have to ask
    // "how long do I have left?"
    if ((document.querySelector('meta[name="premium"]') || {}).content === "1") {
      var prem = el("div", "panel prem-card");
      var top = el("div", "prem-card__top");
      top.appendChild(elIc("span", "prem-chip", "star", T.t("prem_badge")));
      var pdays = (document.querySelector('meta[name="premium-days"]') || {}).content;
      var puntil = (document.querySelector('meta[name="premium-until"]') || {}).content;
      if (pdays !== "" && pdays != null) {
        var d = parseInt(pdays, 10);
        var chipCls = d <= 1 ? " prem-left--danger" : d <= 7 ? " prem-left--warn" : "";
        top.appendChild(el("span", "prem-left" + chipCls,
          T.t("prem_days").replace("{n}", num(d))));
      } else {
        top.appendChild(el("span", "prem-left", T.t("prem_unlimited")));
      }
      prem.appendChild(top);
      var sub = T.t("prem_note");
      if (puntil) {
        var pg = puntil.split("-").map(Number);
        sub += " · " + T.t("prem_until").replace("{d}",
          window.CalSys.labelDate(new Date(pg[0], pg[1] - 1, pg[2])));
      }
      prem.appendChild(el("p", "panel__text prem-card__sub", sub));

      /* v5.3 — the subscription as a shape. A day count is a quantity; the
       * meter shows where you are in the term. Only for a dated subscription:
       * an open-ended one has no progress to show. */
      if (puntil && pdays !== "" && pdays != null) {
        prem.appendChild(subMeter(puntil, parseInt(pdays, 10)));
      }

      if (pdays !== "" && parseInt(pdays, 10) <= 7) {
        prem.appendChild(el("p", "panel__text prem-card__renew", T.t("prem_renew")));
      }
      var goSub = el("a", "btn btn--ghost btn--sm prem-card__go", T.t("ro_renewBtn"));
      goSub.href = "/accounts/subscribe/";
      prem.appendChild(goSub);
      host.appendChild(prem);
    }

    var grid = el("div", "hub-grid");
    [
      ["personalize", "goals", T.t("st_personalize"), T.t("st_personalizeS")],
      ["account", "user", T.t("st_account"), T.t("st_accountS")],
      ["security", "passwords", T.t("st_security"), T.t("st_securityS")],
      ["notifications", "bell", T.t("st_notifs"), T.t("st_notifsS")],
      ["data", "review", T.t("st_data"), T.t("st_dataS")],
      ["language", "journal", T.t("st_language"), T.t("st_languageS")],
      ["helplink", "help", T.t("nav_help"), T.t("st_helpS")],
      ["maker", "heart", T.t("st_maker"), T.t("st_makerS")],
    ].forEach(function (o) {
      var card = el("button", "hub-card");
      var ic = el("span", "hub-card__ic");
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "ic"); svg.setAttribute("viewBox", "0 0 24 24");
      var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", "#ic-" + o[1]);
      svg.appendChild(use); ic.appendChild(svg);
      card.appendChild(ic);
      var body = el("div", "hub-card__body");
      body.appendChild(el("span", "hub-card__t", o[2]));
      body.appendChild(el("span", "hub-card__s", o[3]));
      card.appendChild(body);
      card.appendChild(el("span", "hub-card__go", T.lang === "fa" ? "‹" : "›"));
      card.addEventListener("click", function () {
        if (o[0] === "helplink") { location.hash = "#/help"; return; }
        // v3.6.1: "about the maker" opens the same terminal as the heart in
        // the sidebar footer — one answer, one place, reachable two ways.
        if (o[0] === "maker") { var h = $("made-with"); if (h) h.click(); return; }
        settingsSection = o[0];
        renderRoute();
      });
      grid.appendChild(card);
    });
    host.appendChild(grid);

    // hub footer: feedback + developer/about — small, out of the way
    var foot = el("div", "panel");
    foot.appendChild(el("p", "panel__text", T.t("fb_note")));
    var footRow = el("div", "toolbar");
    var fbBtn = elIc("button", "btn btn--ghost btn--sm", "chat", T.t("fb_open"));
    fbBtn.addEventListener("click", openFeedback);
    footRow.appendChild(fbBtn);
    /* v4.1 — removed: this pointed at /team/, a page deleted back in v3.4.2,
     * so the button 404'd. Settings now has exactly one route to the maker
     * (the "about the maker" card), which opens the terminal. */
    var aboutLink = el("a", "btn btn--ghost btn--sm", T.t("st_privMore"));
    aboutLink.href = "/about/"; aboutLink.target = "_blank";
    footRow.appendChild(aboutLink);
    foot.appendChild(footRow);
    host.appendChild(foot);
  }

  function settingsBack(host) {
    var top = el("div", "hub-back");
    var back = el("button", "btn btn--ghost btn--sm",
      (T.lang === "fa" ? "› " : "‹ ") + T.t("help_back"));
    back.addEventListener("click", function () { settingsSection = null; renderRoute(); });
    top.appendChild(back);
    host.appendChild(top);
  }

  function renderSettingsSection(host, key) {
    settingsBack(host);
    if (key === "personalize") return settingsPersonalize(host);
    if (key === "account") return settingsAccount(host);
    if (key === "security") return settingsSecurity(host);
    if (key === "notifications") return settingsNotifs(host);
    if (key === "data") return settingsData(host);
    if (key === "language") return settingsLanguage(host);
    settingsSection = null; renderRoute();
  }

  // -- Account (v1.15, فاز E مورد ۳۱): username + optional name/email --------
  // The two optional fields live server-side on the User row (contact &
  // support only) — the zero-knowledge vault is not involved in any way.
  function settingsAccount(host) {
    var app = el("div", "panel");
    app.appendChild(el("h2", "panel__title", T.t("st_account")));
    function meta(n) {
      var m = document.querySelector('meta[name="' + n + '"]');
      return m ? m.content : "";
    }
    var uRow = el("div", "set-row");
    uRow.appendChild(el("div", "set-row__label", T.t("pf_username")));
    uRow.appendChild(el("span", "panel__text pf-username", meta("username")));
    app.appendChild(uRow);
    var nameI = el("input", "dg-input"); nameI.type = "text"; nameI.maxLength = 60;
    nameI.value = meta("acct-name");
    var mailI = el("input", "dg-input"); mailI.type = "email"; mailI.maxLength = 254;
    mailI.value = meta("acct-email"); mailI.setAttribute("dir", "ltr");
    app.appendChild(settingRow(T.t("pf_name"), nameI));
    app.appendChild(settingRow(T.t("pf_email"), mailI));
    var save = el("button", "btn btn--primary btn--sm", T.t("save"));
    save.addEventListener("click", async function () {
      save.disabled = true;
      try {
        var r = await fetch("/accounts/profile/", {
          method: "POST",
          headers: { "Content-Type": "application/json",
                     "X-CSRFToken": document.querySelector('meta[name="csrf-token"]').content },
          body: JSON.stringify({ name: nameI.value.trim(), email: mailI.value.trim() }),
        });
        if (r.ok) {
          var m1 = document.querySelector('meta[name="acct-name"]');
          var m2 = document.querySelector('meta[name="acct-email"]');
          if (m1) m1.content = nameI.value.trim();
          if (m2) m2.content = mailI.value.trim();
          window.UI.toast(T.t("pf_saved"), { kind: "success" });
        } else {
          window.UI.toast(T.t("pf_emailBad"), { kind: "danger" });
        }
      } catch (e) {
        window.UI.toast(T.t("net_off"), { kind: "danger" });
      }
      save.disabled = false;
    });
    var foot = el("div", "cu-foot");
    foot.appendChild(save);
    foot.appendChild(el("span", "panel__text accent-hint", T.t("pf_hint")));
    app.appendChild(foot);
    host.appendChild(app);
  }

  // -- Personalize: theme, custom accent, font, size, density, calendar ------
  function settingsPersonalize(host) {
    var root = document.documentElement;
    var app = el("div", "panel");
    app.appendChild(el("h2", "panel__title", T.t("st_personalize")));

    var THEMES = ["light", "dark", "midnight", "custom"];
    // v1.15 (فاز E مورد ۳۰): the personal theme's six saved primitives
    var CUK = "sp_theme_custom";
    function customColors() {
      var d = { ink: "#0b1017", panel: "#141c28", text: "#eaf0f8",
                accent: "#4f8cff", danger: "#ff6b6b", ok: "#4ad991" };
      try {
        var c = JSON.parse(pref(CUK, "") || "null");
        if (c) for (var k in d) if (c[k]) d[k] = c[k];
      } catch (e) {}
      return d;
    }
    function syncCustomVars(name) {
      if (name === "custom") {
        if (window.PrefsCustomTheme) window.PrefsCustomTheme(customColors());
        return;
      }
      ["--ink", "--panel", "--panel-2", "--line", "--text", "--muted",
       "--danger", "--ok", "--accent", "--accent-2", "--accent-ink"]
        .forEach(function (p) { root.style.removeProperty(p); });
      /* v6.4 — a stored custom accent is no longer applied.
       *
       * The signature colour is the brand now, so an accent saved before this
       * release would quietly override it and that user would never see the
       * product's own identity. The stored value is cleared rather than
       * ignored, so nothing lingers waiting to reappear. */
      if (pref("sp_accent", "")) setPref("sp_accent", "");
    }
    var tgrid = el("div", "theme-grid");
    THEMES.forEach(function (name) {
      // three themes deserve a real preview, not a colour dot
      var b = el("button", "theme-tile" + (pref("sp_theme", "dark") === name ? " active" : ""));
      b.type = "button";
      var prev = el("div", "theme-tile__prev thp-" + name);
      prev.appendChild(el("span", "theme-tile__bar theme-tile__bar--1"));
      prev.appendChild(el("span", "theme-tile__bar theme-tile__bar--2"));
      prev.appendChild(el("span", "theme-tile__dot"));
      b.appendChild(prev);
      b.appendChild(el("span", "theme-tile__name", T.t("th_" + name)));
      b.addEventListener("click", function () {
        setPref("sp_theme", name);
        // cross-fade: a full-screen veil of the *new* palette fades away over
        // the old one, so switching feels like a dissolve, not a flash
        if (!window.FX.reduced()) {
          var veil = el("div", "fx-theme-veil");
          document.body.appendChild(veil);
          requestAnimationFrame(function () {
            root.setAttribute("data-theme", name);
            syncCustomVars(name);
            renderRoute();
            requestAnimationFrame(function () { veil.classList.add("out"); });
          });
          setTimeout(function () { veil.remove(); }, 520);
        } else {
          root.setAttribute("data-theme", name);
          syncCustomVars(name);
          renderRoute();
        }
      });
      tgrid.appendChild(b);
    });
    var twrap = el("div", "theme-wrap");
    twrap.appendChild(tgrid);
    var moreBtn = el("button", "btn btn--ghost btn--sm theme-more", T.t("themes_all"));
    var expanded = false;
    moreBtn.addEventListener("click", function () {
      expanded = !expanded;
      tgrid.classList.toggle("open", expanded);
      moreBtn.textContent = T.t(expanded ? "themes_less" : "themes_all");
    });
    twrap.appendChild(moreBtn);
    var trow = el("div", "set-row set-row--col");
    trow.appendChild(el("div", "set-row__label", T.t("theme")));
    trow.appendChild(twrap);
    app.appendChild(trow);

    // v1.15 (فاز E مورد ۳۰): the personal multi-colour theme editor —
    // visible only while the «شخصی» theme is selected. Edits apply live and
    // persist to prefs; the accent field also feeds sp_accent so the app has
    // one accent source everywhere.
    if (pref("sp_theme", "dark") === "custom") {
      var cuNow = customColors();
      var cuGrid = el("div", "cu-grid");
      [["ink", T.t("cu_bg")], ["panel", T.t("cu_panel")], ["text", T.t("cu_text")],
       ["accent", T.t("cu_accent")], ["danger", T.t("cu_danger")], ["ok", T.t("cu_ok")]]
        .forEach(function (o) {
          var it = el("label", "cu-item");
          var inp = el("input", "accent-input");
          inp.type = "color"; inp.value = cuNow[o[0]];
          inp.addEventListener("input", function () {
            cuNow[o[0]] = inp.value;
            setPref(CUK, JSON.stringify(cuNow));
            if (o[0] === "accent") setPref("sp_accent", inp.value);
            if (window.PrefsCustomTheme) window.PrefsCustomTheme(cuNow);
          });
          it.appendChild(inp);
          it.appendChild(el("span", "panel__text", o[1]));
          cuGrid.appendChild(it);
        });
      var cuReset = el("button", "btn btn--ghost btn--sm", T.t("cu_reset"));
      cuReset.addEventListener("click", function () {
        setPref(CUK, ""); setPref("sp_accent", "");
        syncCustomVars("none");     // drop every inline var
        syncCustomVars("custom");   // re-apply the defaults
        renderRoute();
      });
      var cuRow = el("div", "set-row set-row--col");
      cuRow.appendChild(el("div", "set-row__label", T.t("cu_title")));
      cuRow.appendChild(cuGrid);
      var cuFoot = el("div", "cu-foot");
      cuFoot.appendChild(cuReset);
      cuFoot.appendChild(el("span", "panel__text accent-hint", T.t("cu_hint")));
      cuRow.appendChild(cuFoot);
      app.appendChild(cuRow);
    }

    // Custom accent color (Telegram-style): rides on top of any theme.
    // applyAccent(hex) sets inline vars that beat the theme's CSS; reset
    // removes them so the theme's own accent shows again.
    var AC = "sp_accent";
    function applyAccent(hex) {
      var r = parseInt(hex.slice(1, 3), 16),
          gch = parseInt(hex.slice(3, 5), 16),
          b2 = parseInt(hex.slice(5, 7), 16);
      var darker = "#" + [r, gch, b2].map(function (v) {
        return Math.max(0, Math.round(v * 0.82)).toString(16).padStart(2, "0");
      }).join("");
      var ink = (r * 299 + gch * 587 + b2 * 114) / 1000 >= 150 ? "#111318" : "#ffffff";
      root.style.setProperty("--accent", hex);
      root.style.setProperty("--accent-2", darker);
      root.style.setProperty("--accent-ink", ink);
    }
    /* v6.4 — the accent picker is gone.
     *
     * Seven selectable accents meant Aegis had no colour of its own: two
     * screenshots could look like two different products. A brand is a
     * decision made once, on the user's behalf, so the signature is now
     * fixed and this control has nothing left to change. Removing it is
     * kinder than leaving a picker that no longer does anything. */

    /* v6.9 — the four display choices fold away on a phone.
     *
     * Font, size, density and calendar system are four decisions in a row, and
     * a person who opened Settings to turn on a reminder has to scroll past
     * all of them. They are real preferences and nobody's are being taken
     * away — they are simply not what Settings is for on a small screen, so
     * they sit behind one line that says what is inside.
     *
     * A <details> rather than a custom disclosure: it is open by default on
     * desktop via CSS, it works with a keyboard and a screen reader without
     * any code from us, and it cannot get stuck half-open.
     */
    var disp = el("details", "set-fold");
    // Desktop has the room, so it opens as a labelled group; the phone gets
    // the fold. CSS alone can't do this — `open` is an attribute, not a style.
    if (!isPhone()) disp.open = true;
    disp.appendChild(el("summary", "set-fold__s", T.t("st_display")));
    var dispBody = el("div", "set-fold__b");

    dispBody.appendChild(settingRow(T.t("font"), seg(pref("sp_font", "vazir"), [
      { val: "vazir", label: T.t("fontVazir") },
      { val: "system", label: T.t("fontSystem") },
      { val: "serif", label: T.t("fontSerif") },
    ], function (v) { setPref("sp_font", v); root.setAttribute("data-font", v); renderRoute(); })));

    dispBody.appendChild(settingRow(T.t("fontSize"), seg(pref("sp_fontscale", "1"), [
      { val: "0.9", label: T.t("sizeSmall") },
      { val: "1", label: T.t("sizeMedium") },
      { val: "1.15", label: T.t("sizeLarge") },
    ], function (v) { setPref("sp_fontscale", v); root.style.setProperty("--font-scale", v); renderRoute(); })));

    dispBody.appendChild(settingRow(T.t("density"), seg(pref("sp_density", "normal"), [
      { val: "compact", label: T.t("dens_compact") },
      { val: "normal", label: T.t("dens_normal") },
      { val: "comfortable", label: T.t("dens_comfy") },
    ], function (v) {
      setPref("sp_density", v);
      document.documentElement.setAttribute("data-density", v);
    })));

    dispBody.appendChild(settingRow(T.t("calSystem"), seg(pref("sp_calsys", "auto"), [
      { val: "auto", label: T.t("cal_auto") },
      { val: "jalali", label: T.t("cal_jalali") },
      { val: "gregorian", label: T.t("cal_gregorian") },
    ], function (v) {
      setPref("sp_calsys", v);
      cal.y = 0; cal.m = 0; // re-anchor the calendar in the new system
      renderRoute();
    })));

    disp.appendChild(dispBody);
    app.appendChild(disp);

    host.appendChild(app);
  }

  // -- Privacy & security: lock blur, PIN, recovery key, master password -----
  function settingsSecurity(host) {
    var p = el("div", "panel");
    p.appendChild(el("h2", "panel__title", T.t("st_security")));
    p.appendChild(el("p", "panel__text", T.t("st_secBody")));
    var toHelpRow = el("div", "toolbar");
    var toHelp = el("button", "btn btn--ghost btn--sm", T.t("st_secOpen"));
    toHelp.addEventListener("click", function () {
      helpSection = "privacy";
      location.hash = "#/help";
    });
    toHelpRow.appendChild(toHelp);
    p.appendChild(toHelpRow);

    p.appendChild(settingRow(T.t("lk_blur"), seg(pref("sp_lockblur", "0"), [
      { val: "0", label: T.t("opt_off") },
      { val: "1", label: T.t("opt_on") },
    ], function (v) { setPref("sp_lockblur", v); renderRoute(); })));

    // change master password
    var pwRow = el("div", "qk");
    pwRow.appendChild(el("p", "panel__text", T.t("st_pwNote")));
    var rk = el("button", "btn btn--ghost btn--sm", T.t("changeMaster"));
    rk.addEventListener("click", function () { openRekey(); });
    pwRow.appendChild(rk);
    p.appendChild(pwRow);

    // recovery key — the way back in if the master password is ever forgotten
    p.appendChild(renderRecoveryBlock());

    // quick unlock (device PIN)
    var qk = el("div", "qk");
    qk.appendChild(el("p", "panel__text", T.t("qk_note")));
    if (quickEnabled()) {
      var off = el("button", "btn btn--ghost btn--sm btn--danger", T.t("qk_disable"));
      off.addEventListener("click", function () {
        quickWipe();
        status("qk_removed", "success");
        renderRoute();
      });
      qk.appendChild(off);
    } else {
      var pinInp = el("input", "qk-input");
      pinInp.type = "password"; pinInp.inputMode = "numeric";
      pinInp.maxLength = 8; pinInp.placeholder = T.t("qk_pin2");
      qk.appendChild(pinInp);
      var on = el("button", "btn btn--primary btn--sm", T.t("qk_enable"));
      on.addEventListener("click", async function () {
        var pin = pinInp.value.trim();
        if (!/^\d{4,8}$/.test(pin)) { status("qk_short", "error"); return; }
        var raw = S.getDekRaw();
        if (!raw) { status("qk_short", "error"); return; }
        var blob = await C.pinWrap(pin, raw);
        localStorage.setItem(QK_KEY, JSON.stringify(blob));
        localStorage.removeItem(QK_FAILS);
        pinInp.value = "";
        status("qk_saved", "success");
        renderRoute();
      });
      qk.appendChild(on);
    }
    p.appendChild(qk);

    // Passkey unlock (WebAuthn PRF) — only offered where it actually works.
    var pk = el("div", "qk");
    pk.appendChild(elIc("p", "panel__text rk-block__h", "key", T.t("pk_title")));
    pk.appendChild(el("p", "panel__text", T.t("pk_note")));
    var pkRow = el("div", "overlay__actions");
    if (pkEnabled()) {
      pk.appendChild(elIc("p", "panel__text rk-ok", "check", T.t("pk_on")));
      var pkOff = el("button", "btn btn--ghost btn--sm btn--danger", T.t("pk_remove"));
      pkOff.addEventListener("click", function () { pkWipe(); renderRoute(); });
      pkRow.appendChild(pkOff);
    } else {
      var pkOn = el("button", "btn btn--primary btn--sm", T.t("pk_enable"));
      pkOn.addEventListener("click", async function () {
        if (!(await pkSupported())) return window.UI.toast(T.t("pk_unsupported"), { kind: "error" });
        setBusy(pkOn, true);
        try { await pkEnable(); }
        catch (e) {
          setBusy(pkOn, false);
          if (e && e.message === "no_prf") return window.UI.toast(T.t("pk_noPrf"), { kind: "error" });
          if (e && (e.name === "NotAllowedError" || e.name === "AbortError")) return;
          return window.UI.toast(T.t("pk_failed"), { kind: "error" });
        }
        window.UI.toast(T.t("pk_enabled"), { kind: "success" });
        renderRoute();
      });
      pkRow.appendChild(pkOn);
    }
    pk.appendChild(pkRow);
    p.appendChild(pk);

    // danger zone: delete account
    var dz = el("div", "qk dz");
    dz.appendChild(elIc("p", "panel__text dz__title", "warn", T.t("da_title")));
    dz.appendChild(el("p", "panel__text", T.t("da_note")));
    var daBtn = el("button", "btn btn--ghost btn--sm btn--danger", T.t("da_btn"));
    daBtn.addEventListener("click", openDeleteAccount);
    dz.appendChild(daBtn);
    p.appendChild(dz);

    host.appendChild(p);
  }

  // -- Notifications: cleanup + Web Push reminders (v1.11) -------------------
  function settingsNotifs(host) {
    var p = el("div", "panel");
    p.appendChild(el("h2", "panel__title", T.t("st_notifs")));
    p.appendChild(el("p", "panel__text", T.t("nt_autoNote")));
    var row = el("div", "toolbar");
    var clr = elIc("button", "btn btn--ghost btn--sm", "clean", T.t("nt_clearAll"));
    clr.addEventListener("click", function () {
      window.Notifs.clearAll();
      window.UI.toast(T.t("nt_cleared"), { kind: "success" });
    });
    row.appendChild(clr);
    p.appendChild(row);

    // Web Push — reminders while the app is closed. The toggle only appears
    // when the server exposes a VAPID key and the browser supports push.
    if (window.Push && window.Push.available()) {
      var wp = el("div", "qk");
      wp.appendChild(elIc("p", "panel__text rk-block__h", "bell", T.t("push_title")));
      wp.appendChild(el("p", "panel__text", T.t("push_body")));
      wp.appendChild(el("p", "panel__text dg-hint", T.t("push_privacy")));
      var wrow = el("div", "overlay__actions");
      if (window.Push.enabled()) {
        wp.appendChild(elIc("p", "panel__text rk-ok", "check", T.t("push_on")));
        var off = el("button", "btn btn--ghost btn--sm btn--danger", T.t("push_disable"));
        off.addEventListener("click", async function () {
          setBusy(off, true);
          await window.Push.disable();
          renderRoute();
        });
        wrow.appendChild(off);
      } else {
        var on = el("button", "btn btn--primary btn--sm", T.t("push_enable"));
        on.addEventListener("click", async function () {
          setBusy(on, true);
          var res = await window.Push.enable();
          setBusy(on, false);
          if (res === "ok") { window.UI.toast(T.t("push_enabled"), { kind: "success" }); renderRoute(); }
          else if (res === "denied") window.UI.toast(T.t("push_denied"), { kind: "error" });
          else window.UI.toast(T.t("msg_saveFail"), { kind: "error" });
        });
        wrow.appendChild(on);
      }
      wp.appendChild(wrow);
      if (window.Push.enabled()) {
        wp.appendChild(settingRow(T.t("push_lead"), seg(String(window.Push.lead()), [
          { val: "5", label: T.t("push_m5") },
          { val: "10", label: T.t("push_m10") },
          { val: "30", label: T.t("push_m30") },
          { val: "60", label: T.t("push_m60") },
        ], function (v) {
          window.Push.setLead(parseInt(v, 10));
          window.Push.syncSlots();
        })));
      }
      p.appendChild(wp);
    }
    host.appendChild(p);
  }

  // -- Data: vault export/import, iCal, archive, trash ------------------------
  function settingsData(host) {
    var acc = el("div", "panel");
    acc.appendChild(el("h2", "panel__title", T.t("st_data")));
    var actions = el("div", "toolbar");
    var exp = el("button", "btn btn--ghost btn--sm", T.t("exportVault"));
    exp.addEventListener("click", exportVault);
    var imp = el("button", "btn btn--ghost btn--sm", T.t("importVault"));
    imp.addEventListener("click", function () { $("file-import").click(); });
    var tr = el("a", "btn btn--ghost btn--sm", T.t("nav_trash"));
    tr.href = "#/trash";
    actions.appendChild(exp); actions.appendChild(imp); actions.appendChild(tr);
    acc.appendChild(actions);
    acc.appendChild(elIc("p", "panel__text dg-hint", "save", T.t("bk_advice")));

    // iCal (.ics) interop with Google/Apple Calendar
    var ics = el("div", "qk");
    ics.appendChild(el("p", "panel__text", T.t("ics_note")));
    var icsRow = el("div", "overlay__actions");
    var icsExp = elIc("button", "btn btn--ghost btn--sm", "export", T.t("ics_export"));
    icsExp.addEventListener("click", function () {
      var data = window.ICal.exportICS();
      download(data, "secure-planner-" + new Date().toISOString().slice(0, 10) + ".ics");
      window.UI.toast(T.t("ics_exported"), { kind: "success" });
    });
    var icsImp = elIc("button", "btn btn--ghost btn--sm", "import", T.t("ics_import"));
    var icsFile = el("input"); icsFile.type = "file"; icsFile.accept = ".ics,text/calendar"; icsFile.style.display = "none";
    icsFile.addEventListener("change", async function () {
      var f = icsFile.files && icsFile.files[0]; if (!f) return;
      var text = await f.text();
      var n = await window.ICal.importICS(text);
      window.UI.toast(T.t("ics_imported").replace("{n}", num(n)), { kind: "success" });
      icsFile.value = "";
    });
    icsImp.addEventListener("click", function () { icsFile.click(); });
    icsRow.appendChild(icsExp); icsRow.appendChild(icsImp); icsRow.appendChild(icsFile);
    ics.appendChild(icsRow);
    acc.appendChild(ics);
    var arch = (S.vault.archive || []).length;
    if (arch) acc.appendChild(el("p", "panel__text",
      T.t("ar_note") + ": " + num(arch) + " " + T.t("ar_items")));

    host.appendChild(acc);
  }

  // -- Language ----------------------------------------------------------------
  function settingsLanguage(host) {
    var root = document.documentElement;
    var p = el("div", "panel");
    p.appendChild(el("h2", "panel__title", T.t("st_language")));
    p.appendChild(settingRow(T.t("language"), seg(pref("sp_lang", "fa"), [
      { val: "fa", label: T.t("persian") },
      { val: "en", label: T.t("english") },
    ], function (v) {
      switchLang(v, function () {
        if (window.Push && window.Push.enabled()) window.Push.syncSwText();
        translatePage(); renderRoute();
      });
    })));
    host.appendChild(p);
  }

  // ---- help ---------------------------------------------------------------
  // ---- Help hub (v1.8.2) ---------------------------------------------------
  // One place for everything the user might ask: a Telegram-style hub with
  // sections (Privacy, Features, FAQ, Ask). All copy lives in i18n, so both
  // languages are real translations rather than a hardcoded Persian wall.
  var helpSection = null;
  var helpQuery = "";
  var helpTimer = null;   // null = the hub itself

  function renderHelp(host) {
    if (helpSection) return renderHelpSection(host, helpSection);

    var head = el("div", "panel hub-hero");
    head.appendChild(el("h2", "panel__title", T.t("helpTitle")));
    head.appendChild(el("p", "panel__text", T.t("help_sub")));
    host.appendChild(head);

    var grid = el("div", "hub-grid");
    [
      ["privacy", "passwords", T.t("help_privacy"), T.t("help_privacyS")],
      ["features", "goals", T.t("help_features"), T.t("help_featuresS")],
      ["guide", "review", T.t("help_guide"), T.t("help_guideS")],
      ["faq", "help", T.t("help_faq"), T.t("help_faqS")],
      ["ask", "journal", T.t("help_ask"), T.t("help_askS")],
    ].forEach(function (o) {
      var card = el("button", "hub-card");
      var ic = el("span", "hub-card__ic");
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "ic"); svg.setAttribute("viewBox", "0 0 24 24");
      var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", "#ic-" + o[1]);
      svg.appendChild(use); ic.appendChild(svg);
      card.appendChild(ic);
      var body = el("div", "hub-card__body");
      body.appendChild(el("span", "hub-card__t", o[2]));
      body.appendChild(el("span", "hub-card__s", o[3]));
      card.appendChild(body);
      card.appendChild(el("span", "hub-card__go", T.lang === "fa" ? "‹" : "›"));
      card.addEventListener("click", function () {
        helpSection = o[0];
        renderRoute();
      });
      grid.appendChild(card);
    });
    host.appendChild(grid);
  }

  function renderHelpSection(host, key) {
    var panel = el("div", "panel doc-inline");
    var top = el("div", "hub-back");
    var back = el("button", "btn btn--ghost btn--sm",
      (T.lang === "fa" ? "› " : "‹ ") + T.t("help_back"));
    back.addEventListener("click", function () { helpSection = null; renderRoute(); });
    top.appendChild(back);
    panel.appendChild(top);

    if (key === "ask") {
      panel.appendChild(el("h2", "panel__title", T.t("help_ask")));
      panel.appendChild(el("p", "panel__text", T.t("help_askBody")));
      var box = el("textarea", "fb-area");
      box.rows = 5;
      box.placeholder = T.t("fb_ph");
      panel.appendChild(box);
      var send = el("button", "btn btn--primary", T.t("fb_send"));
      send.addEventListener("click", async function () {
        var msg = box.value.trim();
        if (!msg) { box.focus(); return; }
        setBusy(send, true);
        var ok = await sendFeedback(msg);
        setBusy(send, false);
        if (ok) { box.value = ""; window.UI.toast(T.t("fb_thanks"), { kind: "success" }); }
        else window.UI.toast(T.t("fb_fail"), { kind: "error" });
      });
      panel.appendChild(send);
      host.appendChild(panel);
      return;
    }

    // content sections are arrays of [heading, [paragraph, ...]]
    var data = T.t("help_" + key + "Data") || [];
    panel.appendChild(el("h2", "panel__title", T.t("help_" + key)));

    // v2.9: twelve sections is a manual, and a manual needs a way in that
    // isn't scrolling. Filtering matches headings and body lines alike.
    if (data.length > 3) {
      var q = el("input", "dg-input hlp-search");
      q.type = "search";
      q.placeholder = T.t("help_searchPh");
      q.value = helpQuery;
      var body = el("div", "hlp-body");
      function draw() {
        body.textContent = "";
        var needle = helpQuery.trim().toLowerCase();
        var shown = 0;
        data.forEach(function (sec) {
          var lines = needle
            ? sec[1].filter(function (l) { return l.toLowerCase().indexOf(needle) >= 0; })
            : sec[1];
          var headHit = needle && sec[0].toLowerCase().indexOf(needle) >= 0;
          if (needle && !headHit && !lines.length) return;
          if (headHit) lines = sec[1];
          shown++;
          body.appendChild(el("h3", "doc-h3", sec[0]));
          var ul = el("ul", "doc-list");
          lines.forEach(function (line) { ul.appendChild(el("li", null, line)); });
          body.appendChild(ul);
        });
        if (!shown) body.appendChild(el("p", "panel__text", T.t("help_noMatch")));
      }
      q.addEventListener("input", function () {
        helpQuery = q.value;
        if (helpTimer) clearTimeout(helpTimer);
        helpTimer = setTimeout(draw, 150);
      });
      panel.appendChild(q);
      panel.appendChild(body);
      draw();
      host.appendChild(panel);
      return;
    }
    data.forEach(function (sec) {
      var item = el("div", "help-item");
      item.appendChild(el("h3", "help-item__t", sec[0]));
      sec[1].forEach(function (p) {
        item.appendChild(el("p", "help-item__body", p));
      });
      panel.appendChild(item);
    });
    host.appendChild(panel);
  }



  // ---- export / import / rekey -------------------------------------------
  function openFeedback() {
    var ov = el("div", "overlay");
    var card = el("div", "overlay__card");
    card.appendChild(elIc("h2", "panel__title", "chat", T.t("fb_title")));
    card.appendChild(el("p", "panel__text", T.t("fb_desc")));

    var catRow = el("div", "field");
    catRow.appendChild(el("label", null, T.t("fb_cat")));
    var cat = el("select", "tsel");
    [["suggestion", "fb_c_suggestion"], ["feature", "fb_c_feature"],
     ["bug", "fb_c_bug"], ["collab", "fb_c_collab"], ["other", "fb_c_other"]]
      .forEach(function (o) {
        var op = el("option", null, T.t(o[1])); op.value = o[0]; cat.appendChild(op);
      });
    catRow.appendChild(cat);
    card.appendChild(catRow);

    // rating stars
    var rRow = el("div", "field");
    rRow.appendChild(el("label", null, T.t("fb_rating")));
    var stars = el("div", "fb-stars");
    var rating = 0;
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var st = el("button", "fb-star");
      st.appendChild(icn("star-fill"));
        st.type = "button";
        st.addEventListener("click", function () {
          rating = n;
          stars.querySelectorAll(".fb-star").forEach(function (s, idx) {
            s.classList.toggle("on", idx < n);
          });
        });
        stars.appendChild(st);
      })(i);
    }
    rRow.appendChild(stars);
    card.appendChild(rRow);

    var msg = el("textarea"); msg.rows = 5; msg.placeholder = T.t("fb_ph");
    card.appendChild(field2(T.t("fb_msg"), msg));

    var actions = el("div", "overlay__actions");
    var cancel = el("button", "btn btn--ghost btn--sm", T.t("cancel"));
    cancel.addEventListener("click", function () { ov.remove(); });
    var send = el("button", "btn btn--primary btn--sm", T.t("fb_send"));
    send.addEventListener("click", async function () {
      var text = msg.value.trim();
      if (!text) { msg.focus(); return; }
      send.disabled = true;
      try {
        var r = await fetch("/accounts/feedback/", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRFToken": S.csrf() },
          body: JSON.stringify({ category: cat.value, message: text, rating: rating || null }),
        });
        ov.remove();
        if (r.ok) window.UI.toast(T.t("fb_thanks"), { kind: "success" });
        else status("fb_fail", "error");
      } catch (e) { send.disabled = false; status("fb_fail", "error"); }
    });
    actions.appendChild(cancel); actions.appendChild(send);
    card.appendChild(actions);
    ov.appendChild(card);
    document.body.appendChild(ov);
    msg.focus();
  }

  function openDeleteAccount() {
    var ov = el("div", "overlay");
    var card = el("div", "overlay__card");
    card.appendChild(elIc("h2", "panel__title", "warn", T.t("da_title")));
    card.appendChild(el("p", "panel__text", T.t("da_warn")));
    var inp = el("input", "dg-input");
    inp.type = "text"; inp.setAttribute("dir", "ltr");
    inp.placeholder = T.t("da_confirm_ph");
    card.appendChild(field2(T.t("da_confirm"), inp));

    var form = el("form");
    form.method = "post"; form.action = "/accounts/delete/";
    var csrf = el("input"); csrf.type = "hidden"; csrf.name = "csrfmiddlewaretoken"; csrf.value = S.csrf();
    var conf = el("input"); conf.type = "hidden"; conf.name = "confirm_username";
    form.appendChild(csrf); form.appendChild(conf);
    document.body.appendChild(form);

    var actions = el("div", "overlay__actions");
    var cancel = el("button", "btn btn--ghost btn--sm", T.t("cancel"));
    cancel.addEventListener("click", function () { ov.remove(); form.remove(); });
    var del = el("button", "btn btn--danger btn--sm", T.t("da_btn"));
    del.addEventListener("click", async function () {
      var uname = (document.querySelector('meta[name="username"]') || {}).content || "";
      if (inp.value.trim() !== uname) { status("da_mismatch", "error"); return; }
      if (!(await window.UI.confirm({ title: T.t("da_title"), body: T.t("da_final"), danger: true }))) return;
      conf.value = inp.value.trim();
      // flush any pending save is irrelevant; just submit deletion
      form.submit();
    });
    actions.appendChild(cancel); actions.appendChild(del);
    card.appendChild(actions);
    ov.appendChild(card);
    document.body.appendChild(ov);
    inp.focus();
  }

  function field2(labelText, control) {
    var f = el("div", "field");
    f.appendChild(el("label", null, labelText));
    f.appendChild(control);
    return f;
  }

  function download(text, name) {
    var blob = new Blob([text], { type: "application/json" });
    var a = el("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  }
  async function exportVault() {
    try {
      var b = await S.exportBundle();
      download(JSON.stringify(b, null, 2), "vault-backup-" + new Date().toISOString().slice(0, 10) + ".json");
      if (!S.vault.settings) S.vault.settings = {};
      S.vault.settings.lastExportAt = new Date().toISOString();
      persist();
      window.UI.toast(T.t("bk_short"), { kind: "success" });
    } catch (e) { status("msg_saveFail", "error"); }
  }
  async function importVault(file) {
    var bundle;
    try { bundle = JSON.parse(await file.text()); }
    catch (e) { return status("msg_badFile", "error"); }
    if (!S.validBundle(bundle)) return status("msg_badBundle", "error");
    if (!(await window.UI.confirm({ body: T.t("msg_confirmImport"), danger: true }))) return;
    try { await S.restore(bundle); } catch (e) { return status("msg_saveFail", "error"); }
    doLock();
    status("msg_imported", "success");
    boot();
  }
  function openRekey() {
    var cur = $("rekey-cur"); if (cur) cur.value = "";
    $("rekey-new").value = $("rekey-new2").value = "";
    $("rekey").classList.remove("hidden");
    (cur || $("rekey-new")).focus();
  }
  async function saveRekey() {
    var curEl = $("rekey-cur");
    var cur = curEl ? curEl.value : "";
    var pw = $("rekey-new").value, pw2 = $("rekey-new2").value;
    // Path A (knows current password): verify it before changing.
    if (curEl) {
      if (!cur) { shake(curEl); return; }
      if (!(await S.verifyPassword(cur))) return status("rk_wrongPw", "error");
    }
    if (pw.length < MIN_LEN) return status("msg_shortMaster", "error");
    if (pw !== pw2) return status("msg_mismatch", "error");
    try {
      await S.rekey(pw);
      closeOverlay("rekey");
      status("msg_masterChanged", "success");
    } catch (e) { status("msg_rekeyFail", "error"); }
  }

  // ---- recovery key (v1.9) ------------------------------------------------
  // Re-verify the master password before any sensitive recovery action, even
  // though the session is already unlocked — the user asked for this gate.
  async function askMaster() {
    var pw = await window.UI.prompt({ label: T.t("rk_askPw"), type: "password" });
    if (pw == null) return false;
    if (!(await S.verifyPassword(pw))) { window.UI.toast(T.t("rk_wrongPw"), { kind: "error" }); return false; }
    return true;
  }
  function downloadRecovery(key) {
    var body = T.t("rk_fileHint") + "\n\n" + key + "\n\nAegis Planner · " +
      new Date().toISOString().slice(0, 10) + "\n";
    var blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    var a = el("a"); a.href = URL.createObjectURL(blob);
    a.download = "aegis-recovery-key.txt";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  }
  function showRecoveryModal(key) {
    var ov = el("div", "overlay");
    var card = el("div", "overlay__card");
    card.appendChild(elIc("h2", "panel__title", "key", T.t("rk_title")));
    card.appendChild(el("p", "panel__text", T.t("rk_saveWarn")));
    var box = el("div", "rk-key"); box.textContent = key; box.setAttribute("dir", "ltr");
    card.appendChild(box);
    var row = el("div", "overlay__actions");
    var copy = el("button", "btn btn--ghost btn--sm", T.t("rk_copy"));
    copy.addEventListener("click", function () {
      try { navigator.clipboard.writeText(key); } catch (e) {}
      copy.textContent = T.t("rk_copied");
    });
    var dl = el("button", "btn btn--ghost btn--sm", T.t("rk_download"));
    dl.addEventListener("click", function () {
      downloadRecovery(key); window.UI.toast(T.t("rk_downloaded"), { kind: "success" });
    });
    var close = el("button", "btn btn--primary btn--sm", T.t("ok"));
    close.addEventListener("click", function () { ov.remove(); });
    row.appendChild(copy); row.appendChild(dl); row.appendChild(close);
    card.appendChild(row);
    ov.appendChild(card);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
  }
  async function recoveryCreate() {
    if (!(await askMaster())) return;
    var key;
    try { key = await S.setupRecovery(); } catch (e) { return status("msg_saveFail", "error"); }
    window.UI.toast(T.t("rk_created"), { kind: "success" });
    showRecoveryModal(key);
    renderRoute();
  }
  async function recoveryDownload() {
    if (!(await askMaster())) return;
    var key = S.getRecoveryKey();
    if (key) showRecoveryModal(key);
  }
  async function recoveryRegen() {
    if (!(await window.UI.confirm({ body: T.t("rk_regenWarn"), danger: true }))) return;
    if (!(await askMaster())) return;
    var key;
    try { key = await S.setupRecovery(); } catch (e) { return status("msg_saveFail", "error"); }
    window.UI.toast(T.t("rk_created"), { kind: "success" });
    showRecoveryModal(key);
    renderRoute();
  }
  function renderRecoveryBlock() {
    var box = el("div", "qk rk-block");
    box.appendChild(elIc("p", "panel__text rk-block__h", "key", T.t("rk_title")));
    box.appendChild(el("p", "panel__text", T.t("rk_intro")));
    var row = el("div", "overlay__actions");
    if (S.hasRecovery()) {
      box.appendChild(elIc("p", "panel__text rk-ok", "check", T.t("rk_ready")));
      if (S.getRecoveryKey()) {
        var dl = el("button", "btn btn--ghost btn--sm", T.t("rk_download"));
        dl.addEventListener("click", recoveryDownload);
        row.appendChild(dl);
      }
      var rg = el("button", "btn btn--ghost btn--sm", T.t("rk_regen"));
      rg.addEventListener("click", recoveryRegen);
      row.appendChild(rg);
    } else {
      box.appendChild(el("p", "panel__text rk-none", T.t("rk_none")));
      var cr = el("button", "btn btn--primary btn--sm", T.t("rk_create"));
      cr.addEventListener("click", recoveryCreate);
      row.appendChild(cr);
    }
    box.appendChild(row);
    return box;
  }

  // ---- forgot master password (reset via recovery key) --------------------
  // Runs on the unlock screen: the user is Django-authenticated but locked out
  // of the vault. Recovery meta was already fetched by boot().
  function openForgot() {
    if (!S.hasServerRecovery()) { window.UI.toast(T.t("fp_noServer"), { kind: "error" }); return; }
    var ov = el("div", "overlay");
    var card = el("div", "overlay__card");
    card.appendChild(elIc("h2", "panel__title", "key", T.t("fp_title")));
    card.appendChild(el("p", "panel__text", T.t("fp_intro")));
    function field(labelKey, type) {
      var f = el("div", "field");
      var lb = el("label", null, T.t(labelKey));
      var inp = el("input"); inp.type = type; inp.autocomplete = "off"; inp.setAttribute("dir", "ltr");
      var id = "fp-" + Math.random().toString(36).slice(2, 7);
      lb.setAttribute("for", id); inp.id = id;
      f.appendChild(lb); f.appendChild(inp); card.appendChild(f);
      return inp;
    }
    var keyInp = field("fp_key", "text");
    var pwInp = field("newMaster", "password");
    var pw2Inp = field("repeatNew", "password");
    var row = el("div", "overlay__actions");
    var cancel = el("button", "btn btn--ghost btn--sm", T.t("cancel"));
    cancel.addEventListener("click", function () { ov.remove(); });
    var go = el("button", "btn btn--primary btn--sm", T.t("fp_reset"));
    go.addEventListener("click", async function () {
      var key = keyInp.value.trim(), pw = pwInp.value, pw2 = pw2Inp.value;
      if (!key) { shake(keyInp); return; }
      if (pw.length < MIN_LEN) { window.UI.toast(T.t("msg_shortMaster"), { kind: "error" }); return; }
      if (pw !== pw2) { window.UI.toast(T.t("msg_mismatch"), { kind: "error" }); return; }
      setBusy(go, true);
      try {
        await S.resetWithRecovery(key, pw);
      } catch (e) {
        setBusy(go, false);
        window.UI.toast(T.t(e.code === "no_recovery" ? "fp_noServer" : "fp_bad"), { kind: "error" });
        return;
      }
      ov.remove();
      window.UI.toast(T.t("fp_done"), { kind: "success" });
      enterApp();   // vault is unlocked under the new password
    });
    row.appendChild(cancel); row.appendChild(go);
    card.appendChild(row);
    ov.appendChild(card);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    keyInp.focus();
  }

  // ---- overlays & sidebar -------------------------------------------------
  function closeOverlay(id) {
    $(id).classList.add("hidden");
    if (id === "editor") {
      $(id).classList.remove("overlay--write");
      if (noteAuto) { clearTimeout(noteAuto); noteAuto = null; }
      editingNoteId = null;
    }
  }
  function toggleSidebar() { $("sidebar").classList.toggle("open"); $("scrim").classList.toggle("hidden"); }
  function closeSidebar() { $("sidebar").classList.remove("open"); $("scrim").classList.add("hidden"); }

  // ---- wiring -------------------------------------------------------------
  function wire() {
    $("setup-btn").addEventListener("click", doSetup);
    $("unlock-btn").addEventListener("click", doUnlock);
    initNetPill();
    initWhoami();
    // an explicit logout also forgets the local encrypted cache (v1.13.3)
    var lo = document.querySelector(".sidebar__logout");
    if (lo) lo.addEventListener("submit", function () {
      if (window.OffCache) window.OffCache.clear();
    });
    var fl = $("forgot-link"); if (fl) fl.addEventListener("click", openForgot);

    // ---- keyboard shortcuts (ignored while typing or in a dialog) ----------
    document.addEventListener("keydown", function (e) {
      if (!S.isUnlocked()) return;
      // Command palette: Ctrl/Cmd+K (works even from inputs)
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (window.CmdK.isOpen()) window.CmdK.close(); else window.CmdK.open();
        return;
      }
      var t2 = e.target;
      var typing = t2 && (t2.tagName === "INPUT" || t2.tagName === "TEXTAREA" ||
        t2.isContentEditable || t2.tagName === "SELECT");
      if (typing) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector(".overlay")) return; // a dialog is open
      var r = currentRoute();
      var k = e.key.toLowerCase();
      if (k === "n") { e.preventDefault(); window.TasksView.openNew(dateToJ(new Date())); return; }
      if (r === "calendar") {
        if (k === "t") { e.preventDefault(); cal.anchor = new Date(); cal.y = 0; renderRoute(); }
        else if (k === "d") { e.preventDefault(); cal.view = "day"; setPref("sp_calview", "day"); renderRoute(); }
        else if (k === "w") { e.preventDefault(); cal.view = "week"; setPref("sp_calview", "week"); renderRoute(); }
        else if (k === "m") { e.preventDefault(); cal.view = "month"; setPref("sp_calview", "month"); renderRoute(); }
        else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          var dir = e.key === "ArrowLeft" ? -1 : 1;
          var step = cal.view === "month" ? 0 : (cal.view === "week" ? 7 : (cal.view === "3day" ? 3 : 1));
          if (cal.view === "month") {
            cal.m += dir;
            if (cal.m > 12) { cal.m = 1; cal.y++; }
            if (cal.m < 1) { cal.m = 12; cal.y--; }
          } else {
            if (!cal.anchor) cal.anchor = new Date();
            cal.anchor.setDate(cal.anchor.getDate() + dir * step);
          }
          renderRoute();
        }
      }
    });

    $("unlock-pw").addEventListener("keydown", function (e) { if (e.key === "Enter") doUnlock(); });
    var qkBtn = $("qk-btn");
    if (qkBtn) {
      qkBtn.addEventListener("click", doQuickUnlock);
      var pkBtn = $("pk-btn");
      if (pkBtn) {
        pkBtn.classList.toggle("hidden", !pkEnabled());
        pkBtn.addEventListener("click", pkUnlock);
      }
      $("qk-pin").addEventListener("keydown", function (e) { if (e.key === "Enter") doQuickUnlock(); });
    }
    $("setup-pw2").addEventListener("keydown", function (e) { if (e.key === "Enter") doSetup(); });

    $("btn-lock").addEventListener("click", doLock);
    $("nav-toggle").addEventListener("click", toggleSidebar);
    $("scrim").addEventListener("click", closeSidebar);
    $("qt-search").addEventListener("click", function () { window.CmdK.open(); });
    var bell = $("nt-bell");
    if (bell) bell.addEventListener("click", function () { window.Notifs.toggle(); });
    $("qt-new").addEventListener("click", function () { window.TasksView.openNew(null); });
    // collapsible "More" group in the sidebar (state remembered per device)
    var moreBtn = $("nav-more"), moreGrp = $("nav-more-group");
    if (moreBtn && moreGrp) {
      var moreOpen = false;
      try { moreOpen = localStorage.getItem("sp_nav_more") === "1"; } catch (err) {}
      function applyMore() {
        moreGrp.classList.toggle("open", moreOpen);
        moreBtn.classList.toggle("open", moreOpen);
        // robust against stale CSS caches: drive height directly
        moreGrp.style.maxHeight = moreOpen ? (moreGrp.scrollHeight + 8) + "px" : "0px";
      }
      applyMore();
      moreBtn.addEventListener("click", function () {
        moreOpen = !moreOpen;
        try { localStorage.setItem("sp_nav_more", moreOpen ? "1" : "0"); } catch (err) {}
        applyMore();
      });
      // auto-open if the current route lives inside it
      window.addEventListener("hashchange", function () {
        var r = (location.hash || "").slice(2);
        if (["lists","tags","search","trash"].indexOf(r) >= 0 && !moreOpen) {
          moreOpen = true; applyMore();
        }
      });
    }
    // v6.6 — on a phone this goes to a real screen; the drawer stays for the
    // wider layouts where a persistent sidebar makes sense.
    $("bn-menu").addEventListener("click", function () {
      if (isPhone()) { location.hash = "#/more"; return; }
      toggleSidebar();
    });

    /* v6.4 — the centre button adds whatever the screen you are on is made of.
     *
     * A single "+" that always created a task would be a lie on the notes
     * screen. Adding is contextual because that is what the button appears to
     * promise, and an action that does something other than what it looks like
     * is worse than no action at all. Anywhere without an obvious thing to
     * add, it falls back to a task — the thing this app is mostly for. */
    var addBtn = $("bn-add");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        var r = currentRoute();
        if (window.FX && window.FX.haptic) window.FX.haptic("tick");
        if (r === "notes" && window.NotesView && window.NotesView.openNew) {
          window.NotesView.openNew(); return;
        }
        // habits and goals have no openNew() yet, so they intentionally fall
        // through to a task rather than doing nothing. Checked here rather
        // than assumed: a button that silently does nothing is the worst
        // outcome of the three.
        if (window.TasksView && window.TasksView.openNew) {
          window.TasksView.openNew(); return;
        }
        location.hash = "#/tasks";
      });
    }

    $("editor-save").addEventListener("click", saveEditor);
    $("editor-cancel").addEventListener("click", function () { closeOverlay("editor"); });
    $("rekey-save").addEventListener("click", saveRekey);
    $("rekey-cancel").addEventListener("click", function () { closeOverlay("rekey"); });
    $("file-import").addEventListener("change", function (e) {
      if (e.target.files && e.target.files[0]) importVault(e.target.files[0]);
      e.target.value = "";
    });

    window.addEventListener("hashchange", renderRoute);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && pref("sp_lockblur", "0") === "1" && S.isUnlocked()) doLock();
    });
    document.addEventListener("keydown", function (e) {
      if (!S.isUnlocked()) return;
      var tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); location.hash = "#/search"; }
      else if (e.key === "n") { e.preventDefault(); window.TasksView.openNew(null); }
      else if (e.key === "t") { location.hash = "#/tasks"; }
      else if (e.key === "c") { location.hash = "#/calendar"; }
      else if (e.key === "j") { location.hash = "#/notes"; }   /* v3.5: journal lives in notes */
      else if (e.key === "p") { location.hash = "#/focus"; }
    });
    ["click", "keydown", "mousemove"].forEach(function (ev) {
      document.addEventListener(ev, resetIdle, { passive: true });
    });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    T.set(pref("sp_lang", "fa"));
    var mctx = {
      S: S, T: T, J: J,
      el: el, num: num, status: status,
      icn: icn, elIc: elIc,
      persist: persist, persistBg: persistBg, rerender: renderRoute,
      UI: window.UI,
    };
    lazyCtx = function () { return mctx; };   // deferred views init with this
    window.TasksView.init(mctx);
    window.CmdK.init(mctx);
    window.Notifs.init(mctx);
    window.ICal.init(mctx);
    window.calBlockMenu = blockMenu;
    window.HabitsView.init(mctx);
    window.ReviewView.init(mctx);
    window.TagsView.init(mctx);
    window.SearchView.init(mctx);
    // kanban / reports / focus / goals / trash are initialised on first visit
    translatePage();
    wire();
    boot();

    // v1.8.1 — a small public surface so the command palette can *act*
    window.AppView = {
      gotoToday: function () {
        cal.anchor = new Date();
        cal.y = 0; cal.m = 0;
        location.hash = "#/calendar";
        renderRoute();
      },
      toggleLang: function () {
        var next = T.lang === "en" ? "fa" : "en";
        switchLang(next, function () {
          translatePage();
          renderRoute();
        });
      },
      cycleDensity: function () {
        var order = ["compact", "normal", "comfortable"];
        var cur = pref("sp_density", "normal");
        var next = order[(order.indexOf(cur) + 1) % order.length];
        setPref("sp_density", next);
        document.documentElement.setAttribute("data-density", next);
        window.UI.toast(T.t("density") + ": " + T.t(
          next === "compact" ? "dens_compact" : next === "comfortable" ? "dens_comfy" : "dens_normal"
        ), { kind: "success" });
      },
      lock: function () { doLock(); },
    };
  });
})();
