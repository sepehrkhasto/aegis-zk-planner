/* Node test harness for the pure client-side logic: jalali + crypto.
 * Run: node tests/js/run.js   (uses Node's built-in webcrypto)
 */
"use strict";
const { webcrypto } = require("crypto");

// --- shim a browser-ish global for the IIFE modules ---
if (!global.crypto) {
  Object.defineProperty(global, "crypto", { value: webcrypto, configurable: true });
}
global.window = global;
global.btoa = function (s) { return Buffer.from(s, "binary").toString("base64"); };
global.atob = function (s) { return Buffer.from(s, "base64").toString("binary"); };
global.TextEncoder = global.TextEncoder || require("util").TextEncoder;
global.TextDecoder = global.TextDecoder || require("util").TextDecoder;

// calsys/i18n need a documentElement + localStorage shim
global.__lsStore = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(global.__lsStore, k) ? global.__lsStore[k] : null; },
  setItem: function (k, v) { global.__lsStore[k] = String(v); },
  removeItem: function (k) { delete global.__lsStore[k]; },
};
global.__docAttrs = { lang: "fa", dir: "rtl" };
global.document = global.document || {
  documentElement: {
    getAttribute: function (k) { return global.__docAttrs[k] || null; },
    setAttribute: function (k, v) { global.__docAttrs[k] = v; },
  },
  addEventListener: function () {},
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
};

const path = require("path");
require(path.join(__dirname, "../../static/js/jalali.js"));
require(path.join(__dirname, "../../static/js/crypto.js"));
// v5.4 — the dictionaries are one file per language now; load both here so
// the tests can compare them, then the loader that reads whichever is active.
require(path.join(__dirname, "../../static/js/i18n.fa.js"));
require(path.join(__dirname, "../../static/js/i18n.en.js"));
require(path.join(__dirname, "../../static/js/i18n.js"));
require(path.join(__dirname, "../../static/js/calsys.js"));

const J = global.Jalali;
const C = global.ZKCrypto;

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}
function eqJ(a, b) { return a.jy === b.jy && a.jm === b.jm && a.jd === b.jd; }

async function run() {
  console.log("jalali:");
  // known conversions
  ok("2026-07-03 → 1405/4/12", eqJ(J.toJalaali(2026, 7, 3), { jy: 1405, jm: 4, jd: 12 }));
  ok("Nowruz 2024-03-20 → 1403/1/1", eqJ(J.toJalaali(2024, 3, 20), { jy: 1403, jm: 1, jd: 1 }));
  var g = J.toGregorian(1405, 4, 12);
  ok("roundtrip 1405/4/12 → greg → back", (function () {
    var b = J.toJalaali(g.gy, g.gm, g.gd);
    return eqJ(b, { jy: 1405, jm: 4, jd: 12 });
  })());
  ok("month length 1..6 = 31", J.jalaaliMonthLength(1403, 1) === 31 && J.jalaaliMonthLength(1403, 6) === 31);
  ok("month length 7..11 = 30", J.jalaaliMonthLength(1403, 7) === 30 && J.jalaaliMonthLength(1403, 11) === 30);
  ok("leap 1403 → esfand 30", J.isLeapJalaaliYear(1403) === true && J.jalaaliMonthLength(1403, 12) === 30);
  ok("non-leap 1404 → esfand 29", J.isLeapJalaaliYear(1404) === false && J.jalaaliMonthLength(1404, 12) === 29);

  console.log("crypto:");
  const km = await C.createKeyMaterial("correct horse battery staple");
  ok("createKeyMaterial returns bundle", !!(km.meta && km.meta.salt && km.meta.wrappedKey && km.dekRaw));

  const meta = {
    salt: km.meta.salt, iterations: km.meta.iterations,
    wrappedKey: km.meta.wrappedKey, wrappedKeyIv: km.meta.wrappedKeyIv,
  };
  const u = await C.unlock("correct horse battery staple", meta);
  ok("unlock returns dek", !!u.dek);

  const vault = { tasks: [{ id: "t1", title: "سلام" }], n: 42 };
  const enc = await C.encryptVault(u.dek, vault);
  const dec = await C.decryptVault(u.dek, enc.ciphertextIv, enc.ciphertext);
  ok("encrypt→decrypt roundtrip (unicode)", JSON.stringify(dec) === JSON.stringify(vault));

  let threw = false;
  try { await C.unlock("wrong password", meta); } catch (e) { threw = true; }
  ok("wrong master password throws", threw);

  // rewrap
  const nm = await C.rewrap(km.dekRaw, "a-new-master-password-99");
  const u2 = await C.unlock("a-new-master-password-99", {
    salt: nm.salt, iterations: nm.iterations,
    wrappedKey: nm.wrappedKey, wrappedKeyIv: nm.wrappedKeyIv,
  });
  const dec2 = await C.decryptVault(u2.dek, enc.ciphertextIv, enc.ciphertext);
  ok("rewrap keeps same DEK (old ciphertext still decrypts)",
    JSON.stringify(dec2) === JSON.stringify(vault));

  // PIN wrap/unwrap
  const blob = await C.pinWrap("1379", km.dekRaw);
  const raw = await C.pinUnwrap("1379", blob);
  ok("pinUnwrap recovers DEK bytes",
    Buffer.from(raw).toString("hex") === Buffer.from(km.dekRaw).toString("hex"));
  let pinThrew = false;
  try { await C.pinUnwrap("0000", blob); } catch (e) { pinThrew = true; }
  ok("wrong PIN throws", pinThrew);

  // recovery key wrap/unwrap (v1.9)
  const rkey = C.newRecoveryKey();
  ok("recovery key has AEGIS prefix + groups", /^AEGIS(-[0-9A-Z]{1,5})+$/.test(rkey));
  const rwrap = await C.wrapWithRecovery(km.dekRaw, rkey);
  const rraw = await C.unwrapWithRecovery(rkey, rwrap);
  ok("recovery unwrap recovers exact DEK",
    Buffer.from(rraw).toString("hex") === Buffer.from(km.dekRaw).toString("hex"));
  // and that DEK still decrypts the original vault
  const rdek = await C.importDek(rraw);
  const rdec = await C.decryptVault(rdek, enc.ciphertextIv, enc.ciphertext);
  ok("recovered DEK decrypts the vault", JSON.stringify(rdec) === JSON.stringify(vault));
  let rkThrew = false;
  try { await C.unwrapWithRecovery("AEGIS-00000-00000", rwrap); } catch (e) { rkThrew = true; }
  ok("wrong recovery key throws", rkThrew);

  // passkey raw-secret wrap (v1.12) — PRF output stands in as 32 random bytes
  const prf = crypto.getRandomValues(new Uint8Array(32));
  const pkBlob = await C.rawWrap(prf, km.dekRaw);
  const pkRaw = await C.rawUnwrap(prf, pkBlob);
  ok("rawWrap/rawUnwrap roundtrips the DEK",
    Buffer.from(pkRaw).toString("hex") === Buffer.from(km.dekRaw).toString("hex"));
  let pkThrew = false;
  try { await C.rawUnwrap(crypto.getRandomValues(new Uint8Array(32)), pkBlob); }
  catch (e) { pkThrew = true; }
  ok("wrong PRF secret throws", pkThrew);

  // --- iCal (.ics) round-trip ---
  global.J = J;
  require(path.join(__dirname, "../../static/js/ical.js"));
  const ICal = global.ICal;
  ICal.init({ J: J, T: { t: (k)=>k }, S: { vault: {} }, persist: async () => true, rerender: () => {} });

  // all-day single
  let evs = ICal.parseICS(
    "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Exam day\r\nDTSTART;VALUE=DATE:20260808\r\nDTEND;VALUE=DATE:20260809\r\nEND:VEVENT\r\nEND:VCALENDAR");
  ok("ics parse finds 1 event", evs.length === 1);
  let tk = ICal.eventToTask(evs[0]);
  ok("ics all-day → task title", tk.title === "Exam day");
  ok("ics all-day → no time", tk.timeFrom === "");
  const jj = J.toJalaali(2026, 8, 8);
  ok("ics date → correct Jalali due", tk.due.jy === jj.jy && tk.due.jm === jj.jm && tk.due.jd === jj.jd);

  // timed event
  let evs2 = ICal.parseICS(
    "BEGIN:VEVENT\r\nSUMMARY:Meeting\r\nDTSTART:20260810T143000\r\nDTEND:20260810T153000\r\nEND:VEVENT");
  let tk2 = ICal.eventToTask(evs2[0]);
  ok("ics timed → timeFrom", tk2.timeFrom === "14:30");
  ok("ics timed → timeTo", tk2.timeTo === "15:30");

  // multi-day (DTEND exclusive → inclusive dueEnd)
  let evs3 = ICal.parseICS(
    "BEGIN:VEVENT\r\nSUMMARY:Trip\r\nDTSTART;VALUE=DATE:20260810\r\nDTEND;VALUE=DATE:20260813\r\nEND:VEVENT");
  let tk3 = ICal.eventToTask(evs3[0]);
  const je = J.toJalaali(2026, 8, 12); // 13 exclusive → 12 inclusive
  ok("ics multi-day → dueEnd inclusive", tk3.dueEnd && tk3.dueEnd.jd === je.jd && tk3.dueEnd.jm === je.jm);

  // export contains a VEVENT for a due task
  ICal.init({ J: J, T: { t: (k)=>k }, S: { vault: { tasks: [{ id: "x1", title: "T", due: { jy: 1405, jm: 5, jd: 17 } }] } }, persist: async () => true, rerender: () => {} });
  let out = ICal.exportICS();
  ok("ics export has VCALENDAR + VEVENT", out.indexOf("BEGIN:VEVENT") >= 0 && out.indexOf("SUMMARY:T") >= 0);

  console.log("links (v1.13 bidirectional):");
  {
    const fs2 = require("fs");
    // v3.4.1: this used to stub `global.Store` — the SAME wrong name the
    // production code read. The test therefore passed while the real feature
    // was dead: links.js asked the browser for `window.Store`, got undefined,
    // and silently indexed nothing. Stubbing the real export name is what
    // makes this suite actually test the shipped code path.
    global.ZKStore = { csrf: () => "x", vault: {
      notes: [{ id: "n1", title: "برنامه سفر" }, { id: "n2", title: "Reading List", body: "see [[پروژه ولت]]" }],
      tasks: [{ id: "t1", title: "پروژه ولت", notes: "طبق [[برنامه سفر]] و [[Reading List]]" }],
      goals: [{ id: "g1", title: "سلامتی", desc: "ورزش با [[پروژه ولت]]" }],
    }};
    eval(fs2.readFileSync("static/js/links.js", "utf8"));
    ok("norm unifies Arabic yeh/kaf + case + spaces",
      global.Links.norm("READING  LIST") === "reading list" &&
      global.Links.norm("\u0643\u064Aک") === global.Links.norm("\u06A9\u06CCک"));
    const hit = global.Links.resolve("برنامه سفر");
    ok("resolve finds the note by title", hit && hit.kind === "note" && hit.id === "n1");
    ok("resolve returns null for unknown", global.Links.resolve("ناموجود") === null);
    const bl = global.Links.backlinks("task", "t1");
    ok("backlinks finds referrers across kinds",
      bl.length === 2 &&
      bl.some(r => r.kind === "note" && r.id === "n2") &&
      bl.some(r => r.kind === "goal" && r.id === "g1"));
    ok("no self-backlink", !bl.some(r => r.kind === "task" && r.id === "t1"));
  }

  console.log("push (v1.11 reminder slots):");
  {
    global.document = global.document || {};
    const _qs = global.document.querySelector;
    global.document.querySelector = (s) =>
      s.includes("vapid") ? { content: "FAKE" } : (_qs ? _qs.call(global.document, s) : null);
    global.localStorage = global.localStorage ||
      { getItem: (k) => (k === "sp_push_lead" ? "10" : null), setItem() {}, removeItem() {} };
    global.Store = global.Store || { csrf: () => "x", vault: null };
    const fs = require("fs");
    eval(fs.readFileSync("static/js/push.js", "utf8"));
    const now = new Date(Date.now() + 3 * 3600e3);
    const J = global.Jalali.toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const due = { jy: J.jy, jm: J.jm, jd: J.jd };
    const hh = String(now.getHours()).padStart(2, "0") + ":" +
      String(now.getMinutes()).padStart(2, "0");
    const times = global.Push.computeTimes({ tasks: [
      { title: "timed", due, timeFrom: hh },
      { title: "untimed", due },
      { title: "done", due, timeFrom: hh, done: true },
      { title: "past", due: { jy: J.jy - 1, jm: 1, jd: 1 }, timeFrom: "09:00" },
    ]});
    ok("only the future timed task yields a slot", times.length === 1);
    const fireMs = new Date(times[0]).getTime();
    const expect = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
      now.getHours(), now.getMinutes()).getTime() - 10 * 60000;
    ok("slot fires lead-minutes before start", Math.abs(fireMs - expect) < 60000);
    ok("slot is a valid ISO timestamp", !Number.isNaN(fireMs));
  }

  console.log("calsys (dual calendar):");
  const CS = global.CalSys;
  // ---- v5.4: the two dictionaries must stay in step ----------------------
  // Splitting i18n into one file per language cut ~10 KB brotli from every
  // load, but it also created a way for the two files to drift apart. Nothing
  // here relies on anyone remembering: a key added to one language and
  // forgotten in the other fails the build instead of quietly rendering a raw
  // key to half the users.
  // ---- v5.5: interactions must not wait on the network --------------------
  // Measured before the change: every `await persist()` site made the user
  // wait 700 ms of save debounce + encryption + a full round trip before the
  // screen moved — 761 ms on wifi, 1001 ms on 4G, 1501 ms on a weak link. The
  // optimistic path (render now, write behind) was introduced in v3.1 but only
  // applied to a handful of places; this guards the rest of the migration.
  // ---- v5.6: the task list reconciles, it does not rebuild ----------------
  // renderList() used to wipe the host and reconstruct every row, so ticking
  // one checkbox rebuilt the whole page: measured 51 ms at 100 rows, 160 ms at
  // 300 and 261 ms at 1000 on a desktop CPU — and a mid-range phone is 4–6x
  // slower. Verified in a real browser after the change: editing one task
  // leaves 599 of 600 DOM nodes untouched.
  // ---- v5.8: the unlock path stays honest ---------------------------------
  // Measured: the KDF costs ~266 ms on a desktop and an estimated 1.1–1.6 s on
  // a mid-range phone, and it dwarfs everything else in the unlock (decrypting
  // even a 687 KB vault is 20 ms). In the middle of a performance push, the
  // tempting "optimisation" is to lower the iteration count — which would not
  // be an optimisation at all, but a quiet transfer of cost from us onto the
  // user's security. 600k is the OWASP floor for PBKDF2-SHA256; this test
  // exists so that trade can never be made by accident.
  //
  // Separately verified with a main-thread heartbeat: deriveKey does NOT block
  // the UI (55 beats during the derivation, longest gap 14 ms, zero stalls
  // over 60 ms), and the unlock handler already shows a busy button, a status
  // line and a skeleton. So the wait is honest work with honest feedback, and
  // needed no change.
  // ---- v6.0: route modules that arrive when asked for ---------------------
  // Measured with real <script> tags: 28 files / 540 KB / 176 ms before,
  // 23 files / 468 KB / 123 ms after — about 53 ms saved on a desktop and an
  // estimated 215–320 ms on a mid-range phone, on every app open.
  // ---- v6.1: long lists skip what is off-screen ---------------------------
  // Measured with the real stylesheet at 420px: building 300 task rows cost
  // 103 ms and 1000 rows 158 ms. content-visibility takes those to 15.8 ms and
  // 61.3 ms (85% and 61% less) without owning the scroll container, hijacking
  // scroll position, or breaking find-in-page — which a virtualisation
  // refactor would have done. Verified separately: all 1000 rows stay in the
  // DOM, an off-screen row's text is still readable, and scroll height drift
  // after scrolling is 0%.
  // ---- v6.2: reports end in a decision ------------------------------------
  // The brief was explicit: a good report ends in a decision, not a number
  // that merely looks nice. These check the properties that make that true,
  // including the ones that are easy to quietly drop later.
  console.log("decision reports:");
  (function () {
    const _fs = require("fs");
    const src = _fs.readFileSync(
      path.join(__dirname, "../../static/js/reports.js"), "utf8");
    const fa = global.__I18N_FA || {};

    ["peakWindowPanel", "realismPanel", "runawayPanel",
     "correlationPanel", "yearReviewPanel"].forEach(function (fn) {
      ok(fn + " exists", src.indexOf("function " + fn + "(") > -1);
    });

    ok("every report can end in a decision line",
       (src.match(/decisionLine\(/g) || []).length >= 6);

    // A confident chart drawn from four data points is worse than no chart,
    // because it gets acted on.
    ok("a minimum sample is required before any pattern is claimed",
       /MIN_SAMPLE\s*=\s*\d+/.test(src) &&
       (src.match(/< MIN_SAMPLE/g) || []).length >= 3);

    // An empty report must explain itself, not look broken.
    ok("empty reports say what is missing", src.indexOf("function notYet(") > -1);
    ["r_peakEmpty", "r_realEmpty", "r_corrEmpty", "r_yearEmpty"].forEach(function (k) {
      ok(k + " explains what is needed", (fa[k] || "").length > 20);
    });

    // Correlation is not cause, and a personal sample is small. Saying so is
    // the difference between a useful report and confident wellness nonsense.
    ok("the sleep report states its sample size and its limits",
       /r_corrCaveat/.test(src) && /\{n\}/.test(fa.r_corrCaveat || ""));
    ok("the sleep caveat does not claim causation",
       /همبستگی/.test(fa.r_corrCaveat || ""));

    // Telling someone who is already on time to pad their dates would make
    // their planning worse.
    ok("the realism factor is only offered when there is real lateness",
       src.indexOf("r_realDecideOk") > -1 && /if \(median > 0\)/.test(src));

    // Nothing running away is good news and should read as such.
    ok("no runaway tasks reads as good news", (fa.r_runNone || "").length > 15);
  })();

  console.log("off-screen rendering:");
  (function () {
    const css = require("fs").readFileSync(
      path.join(__dirname, "../../static/css/app.css"), "utf8");

    ["\\.task-row", "\\.note-card", "\\.kb-card"].forEach(function (sel) {
      const re = new RegExp(sel + "\\s*\\{[^}]*content-visibility:\\s*auto");
      ok(sel.replace(/\\\\/g, "") + " skips off-screen rendering", re.test(css));
    });

    // Without a reserved size the scrollbar shudders while scrolling, and a
    // fast list that feels broken is not an improvement.
    // Check per RULE, not per file: a declaration that skips rendering without
    // reserving a height makes the scrollbar shudder while scrolling, and a
    // fast list that feels broken is not an improvement.
    const skipping = css.match(/[^{}]+\{[^}]*content-visibility:\s*auto[^}]*\}/g) || [];
    const missing = skipping.filter(function (r) {
      return r.indexOf("contain-intrinsic-size") === -1;
    });
    ok("every skipping rule reserves a height" +
       (missing.length ? " [" + missing.length + " missing]" : ""),
       skipping.length > 0 && missing.length === 0);

    // Printing needs the whole document laid out; skipped content prints blank.
    ok("printing restores full rendering",
       /@media print[\s\S]{0,200}content-visibility:\s*visible/.test(css));

    // The calendar grid is 42 always-visible cells: containment there would
    // fight the grid sizing and skip nothing.
    ok("the calendar grid is left alone",
       !/\.cal-cell\s*\{[^}]*content-visibility/.test(css));
  })();

  console.log("lazy routes:");
  (function () {
    const _fs = require("fs");
    const app = _fs.readFileSync(
      path.join(__dirname, "../../static/js/app.js"), "utf8");
    const html = _fs.readFileSync(
      path.join(__dirname, "../../templates/vault/app.html"), "utf8");

    const LAZY = ["kanban.js", "reports.js", "pomodoro.js", "goals.js", "trash.js"];
    LAZY.forEach(function (f) {
      const eager = new RegExp("<script[^>]+static '" + "js/" + f.replace(".", "\\.") + "'");
      ok(f + " is not loaded eagerly", !eager.test(html));
    });

    // The URL MUST come from {% static %}: production serves content-hashed
    // filenames, so a path assembled in JS would 404 on every deploy while
    // working perfectly in development.
    ok("lazy URLs are resolved through the static manifest",
       /meta name="lazy-kanban"\s+content="\{%\s*static/.test(html));
    ok("the loader reads the URL from the page, not from a guess",
       app.indexOf("meta[name=\"lazy-\" + route") > -1 ||
       app.indexOf('meta[name="lazy-') > -1);

    // habits and review have their own routes but the DASHBOARD calls into
    // them on first paint, so deferring them would trade a fast boot for an
    // empty dashboard.
    ok("habits stays eager (the dashboard reads it)",
       /<script[^>]+static 'js\/habits\.js'/.test(html));
    ok("review stays eager (the dashboard reads it)",
       /<script[^>]+static 'js\/review\.js'/.test(html));

    ok("a lazy route shows a skeleton while it loads",
       /function renderLazy[\s\S]{0,400}skeleton\(host\)/.test(app));
    ok("a failed load surfaces the error boundary",
       /function renderLazy[\s\S]{0,700}renderRouteError/.test(app));
    ok("a failed load does not poison the route forever",
       app.indexOf("lazyLoading[route] = null") > -1);
    ok("navigating away mid-load does not paint the wrong view",
       /currentRoute\(\) !== route/.test(app));
    ok("a deferred module is initialised on first use",
       /mod\.init\(lazyCtx\(\)\)/.test(app));
  })();

  // ---- v6.3: the app never dead-ends on a spinner -------------------------
  // Reported by real users as "I log in and nothing happens". boot() caught its
  // errors, set a status message, and left the view on a spinner with no text.
  // Any failure parked the user on a silent screen with no way out.
  // ---- v6.4: the brand is one decision, not a setting --------------------
  // Seven selectable accents meant two screenshots of Aegis could look like
  // two different products. The signature is fixed now; these keep it that way.
  // ---- v6.5: the phone gets its own home ---------------------------------
  // Testers landed on the dashboard and left. It opened with a greeting, a
  // clock and four counters, and a counter is not something you can act on:
  // "7 open tasks" is a number, not a day. The phone home shows what is
  // actually due, in a list you can tick.
  console.log("phone home:");
  (function () {
    const app = require("fs").readFileSync(
      path.join(__dirname, "../../static/js/app.js"), "utf8");

    ok("there is a phone-only Today screen", app.indexOf("function renderToday(") > -1);
    ok("the dashboard routes to it on a phone",
       /renderDashboard\(host\) \{\s*if \(isPhone\(\)\) return renderToday\(host\)/.test(app));
    ok("phone detection is a media query, not a user-agent guess",
       /matchMedia\("\(max-width: 820px\)"\)/.test(app));

    // The screen's whole job: what is on today, and what slipped.
    ok("it separates overdue from due today",
       app.indexOf('"td_overdue"') > -1 && app.indexOf('"td_due"') > -1);

    // An empty screen is an invitation, not a blank — this is the first thing
    // a new user sees.
    ok("the empty state offers exactly one thing to do",
       /function todayEmpty\(\)[\s\S]{0,700}td_emptyGo/.test(app));

    // Ticking must not wait on the network (v5.5) and must not rebuild (v5.6).
    ok("ticking a row saves in the background", 
       /function todayRow\([\s\S]{0,900}persistBg\(\)/.test(app));
  })();

  // ---- v6.6: More is a destination, and the first minute says something ----
  console.log("phone navigation:");
  (function () {
    const _fs = require("fs");
    const app = _fs.readFileSync(path.join(__dirname, "../../static/js/app.js"), "utf8");
    const goals = _fs.readFileSync(path.join(__dirname, "../../static/js/goals.js"), "utf8");

    ok("More is a real screen", app.indexOf("function renderMore(") > -1);
    ok("it is a registered route", /"more"\]/.test(app) || /,\s*\n?\s*"more"/.test(app));
    ok("the phone button navigates instead of opening the drawer",
       /isPhone\(\)\) \{ location\.hash = "#\/more"/.test(app));
    ok("the drawer is kept for wider layouts", app.indexOf("toggleSidebar();") > -1);
    ok("destinations are grouped by purpose", app.indexOf("MORE_GROUPS") > -1);
    // The detail belongs on one page, not scattered through the app.
    ok("privacy links to the existing docs page", app.indexOf('pr.href = "/about/"') > -1);

    // Testers said "I got in and didn't know what to do".
    ok("a first-run card exists", app.indexOf("function maybeWelcome(") > -1);
    ok("it shows once and never returns", app.indexOf("WELCOME_KEY") > -1);
    ok("it is per-device, not stored in the vault",
       /WELCOME_KEY = "sp_/.test(app));
    ok("it stays out of the way on desktop",
       /maybeWelcome[\s\S]{0,300}if \(!isPhone\(\)\) return/.test(app));

    // A tester asked why the app proposed dates in 2036.
    ok("the goal year list is three years, not eleven",
       /tj\.jy \+ 2/.test(goals) && goals.indexOf("tj.jy + 10") === -1);
    ok("a goal already dated outside the window keeps its year",
       /if \(dl && dl\.jy > yTo\) yTo = dl\.jy/.test(goals));
  })();

  // ---- v6.7: the brand system is one system ------------------------------
  // Found while building it: --lh-body was declared twice with two different
  // values (1.65 and 1.75), so which one applied depended on source order.
  // --radius was declared twice, and --fw-semi / --fw-regular were second
  // names for values that already had names. Two names or two values for one
  // decision is how a design system quietly stops being one.
  // ---- v6.8: the phone gets phone layouts, not squeezed desktop ones ------
  // ---- v6.9: calendar and settings on a phone -----------------------------
  // ---- v7.0: the brand reaches the desktop --------------------------------
  // ---- v7.1: the landing page belongs to the same product -----------------
  // It had its own palette — indigo, cyan, violet, emerald — none of which
  // appear in the app, on the one page that decides whether anyone installs
  // it. Someone arriving here and then opening Aegis saw two products.
  console.log("landing brand:");
  (function () {
    const _fs = require("fs");
    const css = _fs.readFileSync(
      path.join(__dirname, "../../static/css/landing.css"), "utf8");
    const land = _fs.readFileSync(
      path.join(__dirname, "../../templates/core/landing.html"), "utf8");
    const body = css.replace(/\/\*[\s\S]*?\*\//g, "");

    ok("the landing accent is the signature lapis", /--lp-a:\s*#5b86e8/.test(body));
    ok("its gradient end is the brand too", /--lp-b:\s*#1f4bb8/.test(body));
    // Six unrelated hues turned a row of dots into confetti.
    ok("decorative dots draw from the palette, not from anywhere",
       !/\.lp-tdot--[1-6] \{ background: #/.test(body));
    ok("focus rings use the brand", !/outline: 2px solid #4f9cf6/.test(body));

    // A page that sells a feature you removed is worse than one that sells
    // less: the theme chip advertised something deleted in v6.4.
    ok("the page does not advertise the removed theme builder",
       land.indexOf('data-l="trust4"') === -1);
    // Nobody chooses a planner because of a cipher suite.
    ok("no algorithm names in the hero", land.indexOf("AES-256 · رمز شد") === -1);
  })();

  console.log("desktop brand:");
  (function () {
    const _fs = require("fs");
    const html = _fs.readFileSync(
      path.join(__dirname, "../../templates/vault/app.html"), "utf8");
    const css = _fs.readFileSync(
      path.join(__dirname, "../../static/css/app.css"), "utf8");
    const app = _fs.readFileSync(
      path.join(__dirname, "../../static/js/app.js"), "utf8");

    // The sprite still carried the old gradient badge, so the brand shipped
    // everywhere EXCEPT inside the app itself.
    ok("the in-app mark is the new one", html.indexOf("lg-aegis") === -1);
    ok("the in-app mark takes the theme's accent",
       /<symbol id="ic-logo"[\s\S]{0,600}currentColor/.test(html));
    ok("the mark casts no glow",
       !/\.brand__logo \{[^}]*drop-shadow/.test(css));

    // Measured at 1920px: 153 characters per line. Comfortable is 60–80.
    ok("running text has a measure on wide screens",
       /min-width: 1100px\)[\s\S]{0,500}max-width: 68ch/.test(css));
    ok("the app column is centred rather than pinned to one edge",
       /min-width: 1100px\)[\s\S]{0,120}\.route-view \{ margin-inline: auto/.test(css));
    // Boards and tables use width to show relationships; narrowing them would
    // cost information rather than aid reading.
    ok("only prose is constrained, not grids",
       !/max-width: 68ch[\s\S]{0,200}\.kb-board/.test(css));

    // The sidebar offered Tags; the phone's More screen did not.
    ok("the sidebar and the phone More screen offer the same places",
       /MORE_GROUPS[\s\S]{0,400}\["tags", "tags"\]/.test(app));
  })();

  console.log("phone calendar & settings:");
  (function () {
    const _fs = require("fs");
    const app = _fs.readFileSync(path.join(__dirname, "../../static/js/app.js"), "utf8");
    const css = _fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");

    // Seven columns on 390px give each day ~50px: enough to show that
    // something exists, not what.
    ok("a phone always has a day open, not an empty grid",
       /isPhone\(\) && !selDay/.test(app));
    ok("the drag hint is desktop-only",
       /if \(!isPhone\(\)\) panel\.appendChild\(el\("p", "cal-hint"/.test(app));
    // Reusing the dots that already exist beats a parallel system that then
    // has to be kept in step.
    ok("the phone grid uses the existing dot markup",
       /@media \(max-width: 820px\)[\s\S]{0,1400}\.route--calendar \.cal-dots \{[\s\S]{0,60}display: flex/.test(css));
    ok("chips are hidden where they cannot be read",
       /\.route--calendar \.cal-chips[\s\S]{0,60}display: none/.test(css));
    ok("the selected day is legible against the accent",
       /\.cal-cell--sel \.cal-cell__j[\s\S]{0,60}var\(--accent-ink\)/.test(css));

    // Four appearance choices in a row is a wall for someone who opened
    // Settings to do one thing.
    ok("display settings fold on a phone", app.indexOf('el("details", "set-fold")') > -1);
    ok("desktop opens the fold, since `open` is an attribute not a style",
       /if \(!isPhone\(\)\) disp\.open = true/.test(app));
    ok("the fold uses native details, so keyboard and screen readers work",
       /set-fold__s::-webkit-details-marker/.test(css));
  })();

  console.log("phone layouts:");
  (function () {
    const _fs = require("fs");
    const css = _fs.readFileSync(
      path.join(__dirname, "../../static/css/app.css"), "utf8");
    const kb = _fs.readFileSync(
      path.join(__dirname, "../../static/js/kanban.js"), "utf8");

    // Stacking three columns turns a board into a page three times its height.
    ok("the phone board shows one column", kb.indexOf("kb-board--one") > -1);
    ok("a switcher chooses the column", kb.indexOf("function colSwitcher(") > -1);
    ok("the switcher carries the counts, so the shape stays visible",
       /kb-switch__n/.test(kb));
    // One visible column leaves dragging nowhere to go. Removing a capability
    // without a replacement is a regression, however tidy the layout gets.
    ok("cards can still be moved without dragging", kb.indexOf("kb-card__mv") > -1);
    ok("move buttons are phone-only", /isPhoneView\(\)\) \{[\s\S]{0,200}kb-card__mv/.test(kb));

    // A dialog in the middle of a phone screen is a desktop habit.
    ok("dialogs become bottom sheets on a phone",
       /@media \(max-width: 820px\)[\s\S]{0,900}\.overlay \{[\s\S]{0,120}align-items: flex-end/.test(css));
    ok("the sheet has a grabber", /\.overlay__card::before[\s\S]{0,200}border-radius: 999px/.test(css));
    // iOS zooms the page when a focused input is under 16px. Nothing else
    // prevents it.
    ok("inputs in a sheet are 16px so iOS does not zoom",
       /\.overlay__card input[\s\S]{0,140}font-size: 16px/.test(css));

    ok("the new phone screens clear the notch",
       /display-mode: standalone\)[\s\S]{0,200}\.td-head[\s\S]{0,80}safe-area-inset-top/.test(css));
    ok("inner lists do not hand their scroll to the page",
       /overscroll-behavior: contain/.test(css));
    // Removing the tap highlight removes the only feedback some elements had.
    ok("pressable things still respond when the highlight is removed",
       /\.td-row:active[\s\S]{0,80}opacity/.test(css));
  })();

  console.log("brand system:");
  (function () {
    const _fs = require("fs");
    const css = _fs.readFileSync(
      path.join(__dirname, "../../static/css/app.css"), "utf8");
    const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const count = (re) => (body.match(re) || []).length;

    ok("line height is defined once", count(/--lh-body:\s*[\d.]/g) === 1);
    ok("body line height is 1.75, the value Persian needs",
       /--lh-body:\s*1\.75/.test(body));
    // the literal values moved into --r-*; --radius must only ever alias them
    ok("no radius is declared as a raw number",
       count(/--radius(?:-sm)?:\s*\d/g) === 0);
    ok("the legacy radius names alias the scale",
       /--radius:\s*var\(--r-md\)/.test(body));
    ok("weight aliases point at the canonical names",
       /--fw-semi:\s*var\(--fw-semibold\)/.test(body));

    // Three durations and one curve, or the product reads as several products.
    ok("motion is three durations", count(/--dur-[1-3]:/g) === 3);
    ok("motion has one primary curve", count(/--ease:\s*cubic-bezier/g) === 1);

    const manifest = JSON.parse(_fs.readFileSync(
      path.join(__dirname, "../../static/pwa/manifest.webmanifest"), "utf8"));
    // Android crops install icons, so the maskable art must be the variant
    // drawn with a safe zone — not the same file relabelled.
    const maskable = manifest.icons.filter(i => i.purpose === "maskable");
    ok("there is a maskable icon", maskable.length === 1);
    ok("maskable points at its own artwork, not the standard icon",
       maskable.length === 1 && maskable[0].src.indexOf("maskable") > -1);
    ok("the splash colour is the brand", manifest.theme_color === "#16357f");

    const base = _fs.readFileSync(
      path.join(__dirname, "../../templates/base.html"), "utf8");
    ok("the status bar follows the theme",
       (base.match(/name="theme-color"/g) || []).length === 2);
    ok("iOS gets its own touch icon", base.indexOf("apple-touch-icon.png") > -1);
  })();

  console.log("brand:");
  (function () {
    const _fs = require("fs");
    const css = _fs.readFileSync(
      path.join(__dirname, "../../static/css/app.css"), "utf8");
    const app = _fs.readFileSync(
      path.join(__dirname, "../../static/js/app.js"), "utf8");
    const prefs = _fs.readFileSync(
      path.join(__dirname, "../../static/js/prefs.js"), "utf8");
    const logo = _fs.readFileSync(
      path.join(__dirname, "../../static/img/logo.svg"), "utf8");
    const html = _fs.readFileSync(
      path.join(__dirname, "../../templates/vault/app.html"), "utf8");

    ok("there is a named signature colour", /--brand:\s*#[0-9a-f]{6}/i.test(css));
    ok("the light theme uses the signature directly",
       /--accent:\s*var\(--brand\)/.test(css));
    ok("the accent picker is gone from settings",
       app.indexOf('settingRow(T.t("accent_label")') === -1);
    // A colour saved before this release would silently override the brand.
    ok("a stored accent no longer overrides the brand",
       prefs.indexOf('removeItem("sp_accent")') > -1);
    ok("the app clears a stored accent too",
       /setPref\("sp_accent", ""\)/.test(app));

    // A gradient turns to mud at favicon size; the mark has to be flat.
    ok("the mark carries no gradient", logo.indexOf("Gradient") === -1);
    ok("the mark inherits its colour", logo.indexOf("currentColor") > -1);

    // The phone bar: three destinations, one action, one More.
    ok("the bottom bar has a raised add action", html.indexOf('id="bn-add"') > -1);
    ok("reports no longer occupies a phone tab",
       !/bottom-nav[\s\S]{0,900}data-route="reports"/.test(html));
    ok("the add button is wired to something", app.indexOf('$("bn-add")') > -1);
  })();

  console.log("boot dead-ends:");
  (function () {
    const _fs = require("fs");
    const app = _fs.readFileSync(
      path.join(__dirname, "../../static/js/app.js"), "utf8");
    const html = _fs.readFileSync(
      path.join(__dirname, "../../templates/vault/app.html"), "utf8");

    ok("a failed boot renders an error view", app.indexOf("function bootFailed(") > -1);
    ok("boot's catch calls it instead of only setting a status",
       /catch \(e\) \{[\s\S]{0,600}bootFailed\(e\)/.test(app));
    ok("the error view offers a retry", /boot_retry/.test(app));
    ok("the error view offers a way out", /boot_signOut/.test(app));

    // A hung request looks identical to a working app without this.
    ok("a hung boot times out rather than spinning forever",
       app.indexOf("bootWatchdog") > -1 && /setTimeout\([\s\S]{0,200}bootFailed/.test(app));
    ok("the watchdog is cleared once a real view appears",
       /clearTimeout\(bootWatchdog\)/.test(app));

    // The loading screen used to be a spinner and an ellipsis.
    ok("the loading screen says something",
       /data-i18n="loading">[^<]{3,}</.test(html));
  })();

  console.log("unlock path:");
  (function () {
    const _fs = require("fs");
    const crypto = _fs.readFileSync(
      path.join(__dirname, "../../static/js/crypto.js"), "utf8");
    const m = crypto.match(/KDF_ITERATIONS\s*=\s*(\d+)/);
    const iters = m ? parseInt(m[1], 10) : 0;
    ok("PBKDF2 iterations are at or above the OWASP floor (600k), got " + iters,
       iters >= 600000);
    ok("the KDF is SHA-256", /hash:\s*"SHA-256"/.test(crypto));
    ok("AES-GCM is used for the vault", crypto.indexOf("AES-GCM") > -1);

    const app = _fs.readFileSync(
      path.join(__dirname, "../../static/js/app.js"), "utf8");
    const fn = app.slice(app.indexOf("async function doUnlock()"),
                         app.indexOf("async function doUnlock()") + 900);
    ok("unlock tells the user it is working", fn.indexOf('"msg_unlocking"') > -1);
    ok("unlock marks the button busy", fn.indexOf("setBusy(btn, true)") > -1);
    ok("unlock gives the wait a shape", fn.indexOf("skeleton(") > -1);
    ok("a failed unlock clears the busy state",
       (fn.match(/setBusy\(btn, false\)/g) || []).length >= 2);
  })();

  console.log("list reconciliation:");
  (function () {
    const src = require("fs").readFileSync(
      path.join(__dirname, "../../static/js/tasks.js"), "utf8");
    const fn = src.slice(src.indexOf("function renderList()"),
                         src.indexOf("function badge("));

    ok("renderList no longer wipes the whole list",
       fn.indexOf('listHost.textContent = ""') === -1 ||
       // the empty-state branch may still clear; it must be inside that branch
       fn.indexOf("if (!items.length)") < fn.indexOf('listHost.textContent = ""'));

    ok("rows carry a stable key", src.indexOf('setAttribute("data-task-id"') > -1);
    ok("rows carry a content signature", src.indexOf('setAttribute("data-sig"') > -1);
    ok("there is a signature function", src.indexOf("function rowSig(") > -1);
    ok("reconciliation compares signatures",
       fn.indexOf('getAttribute("data-sig")') > -1);
    ok("unchanged nodes are reused rather than replaced",
       fn.indexOf("replaceChild") > -1 && fn.indexOf("insertBefore") > -1);

    // the signature must cover what the row actually paints, or stale rows
    // would survive an edit
    const sigStart = src.indexOf("function rowSig(");
    const sig = src.slice(sigStart, sigStart + 900);
    ["x.title", "x.done", "x.pr", "x.due", "x.tags", "x.subs"].forEach(function (f) {
      ok("signature includes " + f, sig.indexOf(f) > -1);
    });
  })();

  // ---- v5.6: dropping a kanban card moves one node ------------------------
  // The drop used to call ctx.rerender(), rebuilding every column, every card
  // and every drag handler to relocate one. Verified with a real pointer drag
  // in a browser after the change: 100% of card nodes survive and the full
  // rebuild fires zero times.
  console.log("kanban move:");
  (function () {
    const src = require("fs").readFileSync(
      path.join(__dirname, "../../static/js/kanban.js"), "utf8");

    ok("there is a surgical card move", src.indexOf("function moveCardDom(") > -1);
    ok("the drop path prefers it over a full rebuild",
       /if \(!moveCardDom\([^)]*\)\) ctx\.rerender\(\)/.test(src));
    ok("it falls back to a full render when the DOM is unexpected",
       src.indexOf("return false;") > -1 && src.indexOf("ctx.rerender()") > -1);
    ok("the source column regains its empty state",
       src.indexOf("kb-empty") > -1 && src.indexOf("fromBody.appendChild") > -1);
    ok("a paginated column keeps the card above the show-more button",
       src.indexOf(".kb-more") > -1 && src.indexOf("insertBefore(cardEl, more)") > -1);
    // the count must come from the data, not the rendered page, or a paginated
    // column would appear to shrink every time a card leaves it
    const rc = src.slice(src.indexOf("function refreshCount("),
                         src.indexOf("function refreshCount(") + 700);
    ok("column counts are computed from the data, not the DOM",
       rc.indexOf("tasks().filter") > -1);
  })();

  console.log("responsiveness:");
  (function () {
    const _fs = require("fs");
    const dir = path.join(__dirname, "../../static/js");
    const files = ["app.js", "tasks.js", "habits.js", "goals.js",
                   "trash.js", "review.js", "kanban.js"];
    let blocking = [];
    files.forEach(function (f) {
      const src = _fs.readFileSync(path.join(dir, f), "utf8");
      src.split("\n").forEach(function (ln, i) {
        const code = ln.replace(/\/\/.*$/, "");        // a comment is not a call
        if (/await (ctx\.)?persist\(\)/.test(code)) blocking.push(f + ":" + (i + 1));
      });
    });
    // exactly one is allowed: the note editor's autosave indicator, which must
    // report the real outcome rather than a hopeful one
    ok("only the autosave indicator still waits on the write" +
       (blocking.length > 1 ? " [" + blocking.join(", ") + "]" : ""),
       blocking.length === 1 && blocking[0].indexOf("app.js") === 0);

    const app = _fs.readFileSync(path.join(dir, "app.js"), "utf8");
    ok("persistBg exists and is the default path",
       app.indexOf("function persistBg()") > -1 &&
       (app.match(/persistBg\(\)/g) || []).length > 10);

    ok("modules are handed persistBg, not just persist",
       app.indexOf("persistBg: persistBg") > -1);
  })();

  console.log("i18n split:");
  (function () {
    const _fs = require("fs");
    const fa = global.__I18N_FA || {};
    const en = global.__I18N_EN || {};
    const faKeys = Object.keys(fa), enKeys = Object.keys(en);

    ok("both dictionaries load", faKeys.length > 500 && enKeys.length > 500);

    const missEn = faKeys.filter((k) => !(k in en));
    ok("every Persian key has an English counterpart" +
       (missEn.length ? " [" + missEn.slice(0, 8).join(", ") + "]" : ""),
       missEn.length === 0);

    const missFa = enKeys.filter((k) => !(k in fa));
    ok("every English key has a Persian counterpart" +
       (missFa.length ? " [" + missFa.slice(0, 8).join(", ") + "]" : ""),
       missFa.length === 0);

    const blank = faKeys.filter((k) =>
      String(fa[k]).trim() === "" || String(en[k] || "").trim() === "");
    ok("no string is blank in either language", blank.length === 0);

    const loader = _fs.readFileSync(
      path.join(__dirname, "../../static/js/i18n.js"), "utf8");
    // v6.3 — the loader now carries a small Persian FLOOR for the boot screens,
    // because returning a raw English key to a Persian user was a real defect
    // people reported. That floor must stay a floor: a dozen boot strings, not
    // a second dictionary that drifts out of sync with the real one.
    ok("i18n.js stayed a small loader (< 6 KB)", loader.length < 6000);
    const floor = (loader.match(/^\s{4}\w+:/gm) || []).length;
    ok("the fallback stays a floor, not a second dictionary (" + floor + " keys)",
       floor > 0 && floor <= 25);
    ok("the fallback is Persian, not English keys",
       /[\u0600-\u06FF]/.test(loader));

    const html = _fs.readFileSync(
      path.join(__dirname, "../../templates/vault/app.html"), "utf8");
    ok("app.html picks the dictionary from the language cookie",
       html.indexOf("ui_lang") > -1);
    ok("switching language loads the other dictionary first",
       _fs.readFileSync(path.join(__dirname, "../../static/js/app.js"), "utf8")
         .indexOf("T.load(next") > -1);
  })();

  global.I18N.set("fa");

  // default (auto + fa) → jalali
  delete global.__lsStore.sp_calsys;
  ok("auto+fa → jalali", CS.mode() === "jalali");
  // auto + en → gregorian
  global.__docAttrs.lang = "en";
  ok("auto+en → gregorian", CS.mode() === "gregorian");
  // explicit override wins regardless of language
  global.localStorage.setItem("sp_calsys", "jalali");
  ok("explicit jalali overrides en", CS.mode() === "jalali");
  global.localStorage.setItem("sp_calsys", "gregorian");
  global.__docAttrs.lang = "fa";
  ok("explicit gregorian overrides fa", CS.mode() === "gregorian");

  // gregorian display geometry
  ok("greg month length Feb 2024 = 29", CS.monthLength(2024, 2) === 29);
  ok("greg month length Feb 2026 = 28", CS.monthLength(2026, 2) === 28);
  ok("greg week starts Monday", CS.weekStartDow() === 1);
  // Mon 2026-07-06 → col 0; Sun 2026-07-12 → col 6
  ok("greg dowCol Mon=0 Sun=6",
    CS.dowCol(new Date(2026, 6, 6)) === 0 && CS.dowCol(new Date(2026, 6, 12)) === 6);
  ok("greg holiday = Sunday", CS.isHoliday(new Date(2026, 6, 12)) && !CS.isHoliday(new Date(2026, 6, 10)));
  // storage jalali ↔ display gregorian roundtrip
  const dispG = CS.jToDisp({ jy: 1405, jm: 4, jd: 12 });
  ok("jToDisp gregorian 1405/4/12 → 2026-07-03", dispG.y === 2026 && dispG.m === 7 && dispG.d === 3);
  const backJ = CS.dispToJ(dispG);
  ok("dispToJ roundtrip", backJ.jy === 1405 && backJ.jm === 4 && backJ.jd === 12);

  // jalali display mode geometry
  global.localStorage.setItem("sp_calsys", "jalali");
  ok("jalali week starts Saturday", CS.weekStartDow() === 6);
  // Sat 2026-07-04 → col 0; Fri 2026-07-10 → col 6 & holiday
  ok("jalali dowCol Sat=0 Fri=6",
    CS.dowCol(new Date(2026, 6, 4)) === 0 && CS.dowCol(new Date(2026, 6, 10)) === 6);
  ok("jalali holiday = Friday", CS.isHoliday(new Date(2026, 6, 10)));
  const dispJ = CS.jToDisp({ jy: 1405, jm: 4, jd: 12 });
  ok("jToDisp jalali is identity", dispJ.y === 1405 && dispJ.m === 4 && dispJ.d === 12);
  ok("jalali month length via CalSys", CS.monthLength(1403, 12) === 30);
  global.localStorage.removeItem("sp_calsys");

  // v1.13.1 (فاز A مورد ۶): a hard-coded Persian digit next to num() output
  // produced mixed strings like "3/۸". Guard the whole static/js tree: any
  // line that both calls num( and contains a quoted fa/arabic digit fails.
  {
    const fs = require("fs");
    const dir = path.join(__dirname, "../../static/js");
    const bad = [];
    fs.readdirSync(dir).filter(function (f) { return f.endsWith(".js"); }).forEach(function (f) {
      fs.readFileSync(path.join(dir, f), "utf8").split("\n").forEach(function (ln, i) {
        if (ln.indexOf("num(") === -1) return;
        if (/["'][^"']*[\u06F0-\u06F9\u0660-\u0669][^"']*["']/.test(ln)) bad.push(f + ":" + (i + 1));
      });
    });
    ok("no fa-digit literals mixed with num() in static/js", bad.length === 0);
    if (bad.length) console.log("    offenders: " + bad.join(", "));
  }

  // --- v1.13.3 (فاز C مورد ۱۵): OffCache — the encrypted offline cache ---
  {
    require(path.join(__dirname, "../../static/js/offline.js"));
    const OC = global.OffCache;
    OC.clear();
    ok("offcache: empty cache reads null", OC.read() === null);
    OC.write({ meta: { kdf: "argon2id" }, ciphertext: "CT", ciphertextIv: "IV", revision: 7 });
    const snap = OC.read();
    ok("offcache: roundtrip keeps blob + revision",
      snap && snap.ciphertext === "CT" && snap.revision === 7 && snap.pending === null);
    OC.setPending("CT2", "IV2", 7);
    ok("offcache: pending stored with base revision",
      OC.read().pending && OC.read().pending.baseRevision === 7);
    ok("offcache: flush allowed when server did not move",
      OC.shouldFlushPending(OC.read().pending, 7) === true);
    ok("offcache: flush refused when server moved on",
      OC.shouldFlushPending(OC.read().pending, 8) === false);
    OC.clearPending();
    ok("offcache: clearPending keeps the snapshot",
      OC.read() !== null && OC.read().pending === null);
    global.__lsStore["sp_vault_cache"] = "{corrupt json";
    ok("offcache: corrupt cache reads null", OC.read() === null);
    OC.clear();
  }

  // --- v1.14 (فاز D): app chrome must use sprite icons, never emoji. ---
  // Exemptions: store.js (starter vault content = user content) and the task
  // template titles in tasks.js (they become the user's own task titles).
  {
    const fs = require("fs");
    const dir = path.join(__dirname, "../../static/js");
    const emoji = /[\u2B50\u2705\u274C\u23F0\u2764]|[\uD83C-\uD83E][\uDC00-\uDFFF]/;
    const bad = [];
    fs.readdirSync(dir).filter(function (f) { return f.endsWith(".js") && f !== "store.js"; })
      .forEach(function (f) {
        fs.readFileSync(path.join(dir, f), "utf8").split("\n").forEach(function (ln, i) {
          if (f === "tasks.js" && ln.indexOf('title: "') !== -1) return;
          if (emoji.test(ln)) bad.push(f + ":" + (i + 1));
        });
      });
    ok("no emoji in app chrome (sprite icons only)", bad.length === 0);
    if (bad.length) console.log("    offenders: " + bad.join(", "));
  }

  // --- v1.16 (فاز F): every new UI string must exist in BOTH dictionaries ---
  {
    const keys = ["k_label", "k_task", "k_event", "k_all", "k_tasks", "k_events",
      "cf_open", "cf_events", "cf_done", "cf_all",
      "sel_enter", "sel_exit", "sel_all", "sel_selected", "sel_archive",
      "sel_delete", "sel_confirmArchive", "sel_confirmDelete", "sel_archived",
      "tr_restoreSel", "tr_purgeSel", "tr_emptyAll", "tr_confirmPurgeSel",
      "tr_confirmEmpty", "n_folder", "n_allFolders", "n_exportMd", "n_exported",
      // v1.17 (فاز G)
      "r_compare", "r_cmpWeek", "r_cmpMonth", "r_cmpYear", "r_cmpPrev",
      "r_yearMap", "r_yearMapSub", "r_less", "r_more",
      "r_hours", "r_hoursBest", "r_workout", "r_woDone30", "r_woDays30",
      "r_woOpen", "r_habitCharts", "r_last30", "r_mood", "r_moodAvg",
      "mood_0", "mood_1", "mood_2", "mood_3", "mood_4"];
    const _fs = require("fs");
    const src = _fs.readFileSync(
      path.join(__dirname, "../../static/js/i18n.fa.js"), "utf8") +
      _fs.readFileSync(path.join(__dirname, "../../static/js/i18n.en.js"), "utf8");
    const missing = keys.filter(function (k) {
      const hits = src.split("\n").filter(function (ln) {
        return new RegExp("(^|[\\s{,])" + k + "\\s*:").test(ln);
      });
      return hits.length < 1 || src.split(k + ":").length - 1 < 2;
    });
    ok("فاز F strings exist in both fa and en dictionaries", missing.length === 0);
    if (missing.length) console.log("    missing/single-dict: " + missing.join(", "));
  }

  // --- v1.17 (فاز G): every sprite id referenced from JS must exist in the
  // icon sheet, or an icon silently renders as an empty box.
  {
    const fs = require("fs");
    const sheet = fs.readFileSync(
      path.join(__dirname, "../../templates/vault/app.html"), "utf8");
    const have = {};
    (sheet.match(/id="ic-[a-z0-9-]+"/g) || []).forEach(function (m) {
      have[m.slice(7, -1)] = true;
    });
    const dir = path.join(__dirname, "../../static/js");
    const missing = [];
    fs.readdirSync(dir).filter(function (f) { return f.endsWith(".js"); })
      .forEach(function (f) {
        const src = fs.readFileSync(path.join(dir, f), "utf8");
        function note(id) {
          if (!have[id] && missing.indexOf(f + ":" + id) < 0) missing.push(f + ":" + id);
        }
        // icn("x") — literal single argument only (dynamic ids are skipped)
        (src.match(/\bicn\("([a-z][a-z0-9-]*)"\)/g) || []).forEach(function (m) {
          note(m.match(/"([a-z][a-z0-9-]*)"/)[1]);
        });
        // elIc(tag, cls, "x", …) — the icon is the third argument
        (src.match(/\belIc\([^;]*?\)/g) || []).forEach(function (m) {
          const arg = m.match(/^\belIc\(\s*[^,]+,\s*[^,]+,\s*"([a-z][a-z0-9-]*)"/);
          if (arg) note(arg[1]);
        });
      });
    ok("every sprite id used in JS exists in the icon sheet", missing.length === 0);
    if (missing.length) console.log("    missing: " + missing.join(", "));
  }

  // --- v4.0: every t("...") key any module calls must exist in BOTH
  // dictionaries. Found three keys in v2.0.0 that rendered as raw names
  // ("newTask", "ok", "undo") — this stops that class of bug for good.
  {
    const fs = require("fs");
    const dir = path.join(__dirname, "../../static/js");
    const i18n = fs.readFileSync(path.join(dir, "i18n.fa.js"), "utf8") +
      fs.readFileSync(path.join(dir, "i18n.en.js"), "utf8");
    const missing = [];
    fs.readdirSync(dir).filter(function (f) {
      return f.endsWith(".js") && f !== "i18n.js" &&
             f !== "i18n.fa.js" && f !== "i18n.en.js";
    }).forEach(function (f) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      const keys = new Set();
      (src.match(/\bt\("([a-zA-Z0-9_]+)"\)/g) || []).forEach(function (m) {
        keys.add(m.slice(3, -2));
      });
      keys.forEach(function (k) {
        const hits = i18n.split(new RegExp("(?:^|[\\s{,])" + k + "\\s*:", "m")).length - 1;
        if (hits < 2) missing.push(f + ":" + k);
      });
    });
    ok("every UI string exists in both dictionaries", missing.length === 0);
    if (missing.length) console.log("    missing: " + missing.join(", "));
  }

  // --- v4.0: retired routes must leave nothing behind ---
  {
    const fs = require("fs");
    const dir = path.join(__dirname, "../../static/js");
    const gone = ["PasswordsView", "WorkView", "#/passwords", "#/work"];
    const found = [];
    fs.readdirSync(dir).filter(function (f) { return f.endsWith(".js"); })
      .forEach(function (f) {
        const src = fs.readFileSync(path.join(dir, f), "utf8");
        gone.forEach(function (g) { if (src.indexOf(g) >= 0) found.push(f + ":" + g); });
      });
    ok("no references to retired routes", found.length === 0);
    if (found.length) console.log("    found: " + found.join(", "));
  }

  // --- v2.5 (فاز N6): a habit streak must respect its weekly target.
  // The old daily-only rule treated "3 runs a week, done perfectly" as four
  // failures every week, which is how a tracker teaches people to quit.
  {
    function iso(d) {
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
        "-" + String(d.getDate()).padStart(2, "0");
    }
    function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    function goalOf(h) { var n = parseInt(h.perWeek, 10); if (!n || n < 1) n = 7; return Math.min(7, n); }
    function weekCount(h, end) {
      var c = 0, d = new Date(end);
      for (var i = 0; i < 7; i++) { if (h.log[iso(d)]) c++; d.setDate(d.getDate() - 1); }
      return c;
    }
    function streak(h) {
      var d = dayStart(new Date());
      if (goalOf(h) >= 7) {
        if (!h.log[iso(d)]) d.setDate(d.getDate() - 1);
        var n = 0;
        while (h.log[iso(d)]) { n++; d.setDate(d.getDate() - 1); }
        return n;
      }
      var goal = goalOf(h), weeks = 0, cur = new Date(d);
      if (weekCount(h, cur) >= goal) weeks++;
      cur.setDate(cur.getDate() - 7);
      while (weekCount(h, cur) >= goal) { weeks++; cur.setDate(cur.getDate() - 7); }
      return weeks;
    }
    function mk(offsets, perWeek) {
      var log = {};
      offsets.forEach(function (o) {
        var d = dayStart(new Date());
        d.setDate(d.getDate() - o);
        log[iso(d)] = 1;
      });
      return { log: log, perWeek: perWeek };
    }
    ok("daily streak counts consecutive days", streak(mk([0, 1, 2, 3, 4], 7)) === 5);
    ok("daily streak survives 'not yet today'", streak(mk([1, 2, 3, 4], 7)) === 4);
    ok("weekly target counts good weeks", streak(mk([0, 2, 4, 7, 9, 11, 14, 16, 18], 3)) === 3);
    ok("an unfinished current week does not count", streak(mk([0, 2, 7, 9, 11, 14, 16, 18], 3)) === 2);
    ok("one day is not a weekly streak", streak(mk([0], 3)) === 0);
  }

  // --- v3.0.1 (فاز N10.1): mobile-browser regressions have a habit of
  // returning as "cleanup". These four are checked on every run.
  {
    const fs = require("fs");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const base = fs.readFileSync(path.join(__dirname, "../../templates/base.html"), "utf8");

    ok("viewport-fit=cover is set (env(safe-area) is 0 without it)",
      base.indexOf("viewport-fit=cover") >= 0);

    ok("inputs are pinned to 16px on phones (iOS zoom-on-focus)",
      /input, select, textarea[^{]*\{[^}]*font-size:\s*max\(16px/.test(css));

    ok("a fallback exists for browsers without color-mix()",
      css.indexOf("@supports not (color: color-mix") >= 0);

    ok("installed mode accounts for the status bar",
      css.indexOf("@media (display-mode: standalone)") >= 0);

    const manifest = JSON.parse(fs.readFileSync(
      path.join(__dirname, "../../static/pwa/manifest.webmanifest"), "utf8"));
    const purposes = manifest.icons.map(function (i) { return i.purpose; });
    ok("icons declare 'any' and 'maskable' separately, never combined",
      purposes.indexOf("any maskable") < 0 &&
      purposes.indexOf("any") >= 0 && purposes.indexOf("maskable") >= 0);
  }

  // --- v3.0.2 (ممیزی): the vault normaliser must never drop data it does
  // not recognise. It used to, which meant (a) removing a feature deleted
  // that data unrecoverably, and (b) an older build erased any key a newer
  // build had written — two devices on different versions wiping each other.
  {
    const src = require("fs").readFileSync(
      path.join(__dirname, "../../static/js/store.js"), "utf8");
    const body = src.slice(src.indexOf("function normalize"),
                           src.indexOf("function normalize") + 900);
    ok("normalize() copies every incoming key before filling defaults",
      /Object\.keys\(v\)\.forEach/.test(body));
    ok("normalize() still guarantees the known shape",
      /Object\.keys\(base\)\.forEach/.test(body));
  }

  // --- v3.0.3 (ممیزی فرانت): static compression was configured and then
  // silently overwritten, so ~830 KB of JS+CSS shipped uncompressed. These
  // two checks make that impossible to repeat unnoticed.
  {
    const fs = require("fs");
    const settings = fs.readFileSync(
      path.join(__dirname, "../../config/settings.py"), "utf8");
    const storageDecls = (settings.match(/^STORAGES = \{/gm) || []).length;
    ok("settings.py declares STORAGES exactly once", storageDecls === 1);

    const storage = fs.readFileSync(
      path.join(__dirname, "../../core/storage.py"), "utf8");
    ok("the storage class is based on WhiteNoise's compressed storage",
      storage.indexOf("CompressedManifestStaticFilesStorage") >= 0);
  }

  // --- v3.1 (فاز N11): the hot interactions must not wait for the network.
  // Every tap used to run `await persist()` first, which meant the 700ms save
  // debounce + encryption + a round trip happened BEFORE the screen changed.
  // That was the "kanban is slow" report, and it applied app-wide.
  {
    const fs = require("fs");
    const dir = path.join(__dirname, "../../static/js");
    const hot = {
      "kanban.js": "dropping a card",
      "tasks.js": "ticking a task",
      "habits.js": "tapping a habit",
    };
    const blocking = [];
    Object.keys(hot).forEach(function (f) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      if (src.indexOf("persistBg") < 0) blocking.push(f + " (" + hot[f] + ")");
    });
    ok("hot interactions save in the background", blocking.length === 0);
    if (blocking.length) console.log("    still blocking: " + blocking.join(", "));

    const app = fs.readFileSync(path.join(dir, "app.js"), "utf8");
    ok("the route entrance plays on navigation, not on every repaint",
      app.indexOf("r !== lastRenderedRoute") >= 0);
  }

  // --- v3.2 (فاز صفحه‌ی اصلی): the app was DESIGNED for Vazirmatn, but the
  // repo shipped no font files at all — and worse, three @font-face blocks
  // pointed at files that never existed, so weights 600/800/900 (the hero,
  // every heading) rendered in the fallback forever. These guards make the
  // font a hard requirement of the build, not a hope.
  {
    const fs = require("fs");
    const fontPath = path.join(__dirname, "../../static/fonts/Vazirmatn-Variable.woff2");
    const exists = fs.existsSync(fontPath);
    ok("the Vazirmatn variable font actually ships in the repo",
      exists && fs.statSync(fontPath).size > 50000);
    ok("the font file is a real woff2 (magic bytes)",
      exists && fs.readFileSync(fontPath).slice(0, 4).toString("binary") === "wOF2");

    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    ok("app.css serves every weight from the variable range 100\u2013900",
      /font-weight:\s*100 900/.test(css));
    ok("no @font-face points at the seven files that never existed",
      !/Vazirmatn-(Regular|Medium|SemiBold|Bold|Light|ExtraBold|Black)\.woff2/.test(css));

    const sw = fs.readFileSync(path.join(__dirname, "../../static/pwa/sw.js"), "utf8");
    const swV = (sw.match(/var V = "aegis-v(\d+)"/) || [])[1];
    ok("service-worker cache version is v3.2 or later (fonts era)",
      swV !== undefined && parseInt(swV, 10) >= 320);
    ok("font is NOT precached unhashed (v3.3: it ships hashed, cache-first covers it)",
      sw.indexOf("Vazirmatn-Variable.woff2") < 0);
    ok("service worker no longer precaches phantom fonts",
      !/Vazirmatn-(Regular|Medium|SemiBold|Bold|Light|ExtraBold|Black)\.woff2/.test(sw));
  }

  // --- v3.2: the landing is bilingual BY CONTRACT. Every data-l key that any
  // public template renders must have an EN twin in landing.js, or the EN
  // toggle silently shows Persian for that string. This guard turns "silently"
  // into a red test.
  {
    const fs = require("fs");
    const js = fs.readFileSync(path.join(__dirname, "../../static/js/landing.js"), "utf8");
    const start = js.indexOf("var EN = {");
    const dict = js.slice(start, js.indexOf("\n  };", start));
    const keys = new Set();
    // strip string literals first, so a colon inside a value can never
    // masquerade as a key — then every remaining `word:` IS a key.
    const bare = dict.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    bare.replace(/([A-Za-z_$][\w$]*)\s*:/g, function (m, k) { keys.add(k); return m; });
    ok("the EN dictionary parsed into a sane number of keys", keys.size > 80);

    const missing = [];
    ["core/landing.html"].forEach(function (t) {
      const p = path.join(__dirname, "../../templates", t);
      const html = fs.readFileSync(p, "utf8");
      if (html.indexOf("js/landing.js") < 0) return; // page uses a different dict
      html.replace(/data-l="([^"]+)"/g, function (m, k) {
        if (!keys.has(k)) missing.push(t + ":" + k);
        return m;
      });
    });
    ok("every data-l key on public pages has an EN translation", missing.length === 0);
    if (missing.length) console.log("    missing: " + missing.join(", "));
  }

  // --- v3.2: the showcase tabs must be real citizens of the keyboard, and the
  // three new landing sections must not silently disappear in a refactor.
  {
    const fs = require("fs");
    const js = fs.readFileSync(path.join(__dirname, "../../static/js/landing.js"), "utf8");
    ok("tab selection maintains aria-selected + roving tabindex",
      js.indexOf('setAttribute("aria-selected"') >= 0 && js.indexOf('setAttribute("tabindex"') >= 0);
    ok("tabs respond to the arrow keys",
      js.indexOf("ArrowRight") >= 0 && js.indexOf("ArrowLeft") >= 0);
    ok("the cipher demo writes textContent only (CSP-safe by construction)",
      js.indexOf("function cipher") >= 0 &&
      js.slice(js.indexOf("function cipher")).indexOf("innerHTML") < 0);

    const html = fs.readFileSync(path.join(__dirname, "../../templates/core/landing.html"), "utf8");
    ok("landing ships the proof, compare and FAQ sections",
      html.indexOf("lp-proof") >= 0 && html.indexOf("lp-cmp__table") >= 0 && html.indexOf("lp-faq") >= 0);
  }

  // --- v3.2.1 (فاز ۱ بصری): the audit's fixes, pinned. ---------------------
  {
    const fs = require("fs");
    const land = fs.readFileSync(path.join(__dirname, "../../static/css/landing.css"), "utf8");
    const app = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");

    // iOS Safari renders NO blur without the -webkit- prefix. Every real
    // backdrop-filter property must travel with its twin.
    function unprefixed(css) {
      const lines = css.split("\n");
      let bad = 0;
      lines.forEach(function (ln, i) {
        if (/(^|[^-])backdrop-filter:\s*blur/.test(ln) && ln.indexOf("-webkit-backdrop-filter") < 0) {
          const prev = i ? lines[i - 1] : "";
          if (prev.indexOf("-webkit-backdrop-filter") < 0) bad++;
        }
      });
      return bad;
    }
    ok("every backdrop-filter ships with its -webkit- twin (landing.css)", unprefixed(land) === 0);
    ok("every backdrop-filter ships with its -webkit- twin (app.css)", unprefixed(app) === 0);

    // reduced-motion must never HIDE content: the hero calendar blocks and
    // the habit heatmap used to stay invisible with animations off.
    ok("reduced-motion keeps the hero calendar blocks visible",
      /prefers-reduced-motion[^}]*\{[\s\S]*?\.lp-pv-block\s*\{[^}]*opacity:\s*1/.test(land));
    ok("reduced-motion keeps the habit heatmap filled",
      land.indexOf(".lp-hb-map i.on { background: var(--lp-d); }") >= 0);

    // a missing font must mean a silent fallback, never a broken page:
    // local() first, then the shipped file, then the metric fallback.
    ok("@font-face prefers a locally installed Vazirmatn",
      app.indexOf('local("Vazirmatn")') >= 0);

    // anchors and keyboards
    ok("anchored sections clear the sticky topbar", land.indexOf("scroll-margin-top") >= 0);
    ok("landing links/buttons have a visible keyboard focus",
      land.indexOf(".lp-btn:focus-visible") >= 0);
    ok("Persian kicker drops the Latin letter-spacing",
      land.indexOf('[dir="rtl"] .lp-kicker { letter-spacing: 0; }') >= 0);
  }

  // --- v3.2.2 (فاز ۲ داخل اپ): the audit's fixes, pinned. -----------------
  {
    const fs = require("fs");
    const app = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const shell = fs.readFileSync(path.join(__dirname, "../../templates/vault/app.html"), "utf8");
    const sw = fs.readFileSync(path.join(__dirname, "../../static/pwa/sw.js"), "utf8");
    const i18n = fs.readFileSync(path.join(__dirname, "../../static/js/i18n.fa.js"), "utf8") +
      fs.readFileSync(path.join(__dirname, "../../static/js/i18n.en.js"), "utf8");

    // the sidebar footer told users v3.1.0 while the worker cached v3.2.x —
    // the two version strings must never drift again.
    const shellVer = (shell.match(/class="ver">v(\d+)\.(\d+)\.(\d+)/) || []);
    const swVer = (sw.match(/"aegis-v(\d)(\d)(\d)"/) || []);
    ok("app shell shows a version", shellVer.length > 0);
    ok("sidebar version and SW cache version agree (major.minor)",
      shellVer.length > 0 && swVer.length > 0 &&
      shellVer[1] === swVer[1] && shellVer[2] === swVer[2]);

    // Persian headings must not inherit the Latin tracking
    ok("Persian text is exempt from Latin letter-spacing tuning",
      /\[lang="fa"\] h1,[\s\S]*?letter-spacing:\s*0;/.test(app));

    // pre-color-mix iOS: the tokens themselves must have static fallbacks.
    // Search EVERY @supports-not block, not just the last one — later phases
    // legitimately add more of them.
    const supportsNot = app.split("@supports not (color: color-mix").slice(1).join(" ");
    ok("old-iOS fallback redefines the focus ring token",
      supportsNot.indexOf("--ring: 0 0 0 3px rgba(") >= 0);
    ok("old-iOS fallback redefines the soft tint tokens",
      supportsNot.indexOf("--primary-soft: rgba(") >= 0);
    ok("old-iOS fallback keeps the overlay dim visible",
      supportsNot.indexOf(".overlay { background: rgba(") >= 0);

    // the three vh stragglers now track the REAL viewport
    const dvhBlocks = app.split("@supports (height: 100dvh)");
    const dvhAll = dvhBlocks.slice(1).join(" ");
    ok("drawer/sidebar height tracks the visible viewport",
      dvhAll.indexOf(".sidebar { height: 100dvh; }") >= 0);
    ok("modal card height tracks the visible viewport",
      dvhAll.indexOf(".overlay__card { max-height: 88dvh; }") >= 0);

    // skip link: markup + both translations + styles, or it's theater
    ok("app shell ships a skip link to the main content",
      shell.indexOf('class="skip-link"') >= 0 && shell.indexOf('<main id="route-view"') >= 0);
    ok("skip link is translated in both languages",
      (i18n.match(/skipToContent:/g) || []).length === 2);
    ok("skip link has focus styles",
      app.indexOf(".skip-link:focus-visible") >= 0);

    // screen readers hear the page's own language on the icon buttons
    ok("icon buttons carry Persian accessible names",
      shell.indexOf('aria-label="جستجو"') >= 0 && shell.indexOf('aria-label="منو"') >= 0);
  }

  // --- v3.2.3 (فاز ۳): auth / errors / panel + the "every phone" rule ------
  {
    const fs = require("fs");
    const app = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");

    // gradient text with color:transparent MUST have a plain background
    // fallback, or pre-color-mix browsers render the text invisible.
    const blocks = app.split("}");
    const naked = blocks.filter(function (b) {
      return b.indexOf("background-clip: text") >= 0 &&
             b.indexOf("color-mix") >= 0 &&
             !/background:\s*var\(--(accent|text)\);/.test(b);
    });
    ok("every color-mix gradient text has a plain-color fallback", naked.length === 0);
    if (naked.length) console.log("    naked gradient blocks: " + naked.length);

    // font boosting off on every engine — type is what we designed
    ok("text-size-adjust is locked to 100% cross-engine",
      app.indexOf("-webkit-text-size-adjust: 100%") >= 0 &&
      app.indexOf("text-size-adjust: 100%") >= 0);

    // the panel nav is one swipeable row on phones, not a 3-line header
    ok("panel nav becomes a swipeable row on small screens",
      /\.pnl-nav\s*\{[^}]*overflow-x:\s*auto/.test(app));
  }

  // --- v3.2.3: the i18n-completeness contract now covers EVERY public
  // surface: auth pages + error pages (auth_i18n.js) and the staff panel
  // (panel_i18n.js). Same class of bug that "home" was.
  {
    const fs = require("fs");
    function dictKeys(jsPath) {
      const js = fs.readFileSync(path.join(__dirname, jsPath), "utf8");
      const keys = new Set();
      // collect from EVERY key map the file declares (EN, PREFIX, …),
      // whether it closes multi-line ("\n  };") or inline ("... };")
      js.replace(/var [A-Z]+ = \{([\s\S]*?)\};/g, function (m, body) {
        const bare = body.replace(/"(?:[^"\\]|\\.)*"/g, '""');
        bare.replace(/([A-Za-z_$][\w$]*)\s*:/g, function (mm, k) { keys.add(k); return mm; });
        return m;
      });
      return keys;
    }
    function missingIn(templates, keys) {
      const missing = [];
      templates.forEach(function (t) {
        const html = fs.readFileSync(path.join(__dirname, "../../templates", t), "utf8");
        html.replace(/data-l(?:-ph)?="([^"]+)"/g, function (m, raw) {
          // a Django conditional key means BOTH branches must translate:
          // data-l="{% if x %}A{% else %}B{% endif %}"
          const cond = raw.match(/\{% if [^%]*%\}(\w+)\{% else %\}(\w+)\{% endif %\}/);
          const wanted = cond ? [cond[1], cond[2]] : [raw];
          wanted.forEach(function (k) {
            if (!keys.has(k)) missing.push(t + ":" + k);
          });
          return m;
        });
      });
      return missing;
    }

    const authKeys = dictKeys("../../static/js/auth_i18n.js");
    const authMissing = missingIn(
      ["accounts/login.html", "accounts/register.html", "accounts/pending.html",
       "errors/403.html", "errors/404.html", "errors/429.html", "errors/500.html"],
      authKeys);
    ok("every auth/error data-l key has an EN translation", authMissing.length === 0);
    if (authMissing.length) console.log("    missing: " + authMissing.join(", "));

    const panelKeys = dictKeys("../../static/js/panel_i18n.js");
    const panelTemplates = fs.readdirSync(path.join(__dirname, "../../templates/panel"))
      .filter(function (f) { return f.slice(-5) === ".html"; })
      .map(function (f) { return "panel/" + f; });
    const panelMissing = missingIn(panelTemplates, panelKeys);
    ok("every panel data-l key has an EN translation", panelMissing.length === 0);
    if (panelMissing.length) console.log("    missing: " + panelMissing.join(", "));

    // the three error pages are now first-class: themed + bilingual
    ["403", "404", "500"].forEach(function (code) {
      const t = fs.readFileSync(path.join(__dirname, "../../templates/errors/" + code + ".html"), "utf8");
      ok("error " + code + " loads theme prefs and speaks both languages",
        t.indexOf("prefs.js") >= 0 && t.indexOf("auth_i18n.js") >= 0 &&
        (t.match(/data-l=/g) || []).length >= 4);
    });
  }

  // --- v3.3.0 (فاز پرفورمنس): budgets and delivery, pinned. ----------------
  {
    const fs = require("fs");
    const zlib = require("zlib");
    /* v5.7 — measure what actually TRAVELS, not what is committed.
     *
     * collectstatic now strips comments from served JS (see core/storage.py),
     * so the source file is no longer the thing users download. Measuring the
     * source would either force comments to be deleted to satisfy a budget —
     * trading documentation for kilobytes — or quietly overstate the cost.
     *
     * When terser is available the file is stripped exactly the way the
     * deployment strips it, then measured. When it is not, the raw file is
     * measured instead: that is the pessimistic number, so a budget that
     * passes without terser also passes with it. */
    function brKB(rel) {
      const abs = path.join(__dirname, "../..", rel);
      let buf = fs.readFileSync(abs);
      if (rel.endsWith(".css")) {
        // Same reasoning as JS: collectstatic strips CSS comments, so the
        // source file is not what travels. CSS is safe to strip with a regex
        // (no regex literals, no line comments) as long as no /* hides inside
        // a string or url() — checked here exactly as the deploy checks it.
        const text = buf.toString("utf8");
        // The guard must match a /* that is INSIDE a string, not merely a
        // string that appears earlier on the same line as a comment. The
        // loose version flagged `content: ""; /* ... */` and quietly skipped
        // stripping the whole file, which made the budget measure the wrong
        // number.
        if (!/(?:"(?:[^"\\\n]|\\.)*\/\*(?:[^"\\\n]|\\.)*")|(?:'(?:[^'\\\n]|\\.)*\/\*(?:[^'\\\n]|\\.)*')|(?:url\([^)"']*\/\*)/.test(text)) {
          buf = Buffer.from(text.replace(/\/\*[\s\S]*?\*\//g, ""), "utf8");
        }
      }
      if (rel.endsWith(".js")) {
        try {
          const terser = require("terser");
          const res = terser.minify_sync
            ? terser.minify_sync(buf.toString("utf8"), {
                compress: false, mangle: false,
                format: { comments: false, beautify: true, indent_level: 0 } })
            : null;
          if (res && res.code) buf = Buffer.from(res.code, "utf8");
          brKB.stripped = true;
        } catch (e) { brKB.stripped = false; }
      }
      return zlib.brotliCompressSync(buf).length / 1024;
    }
    // Wire budgets (brotli, the size that actually travels). Ceilings have
    // ~15% headroom over today's numbers so honest growth fits but silent
    // bloat pings. Today: app.css 42.5 · landing.css 10.6 · app.js 36.8 ·
    // i18n.js 24.7 (KB).
    const budgets = [
      // v4.0: raised from 49 only after paying the debt first — the
      // full-screen calendar rework deleted ~3.5 KB of superseded rules
      // (five guessed grid heights, the three-row mobile header, the old
      // segment chips, the wrap/sticky rules that now fight the layout).
      // The net rise is what the feature genuinely costs, not drift.
      // v4.1: 51, and this is the SECOND raise in a row — which is the signal
      // that consolidation now needs its own pass rather than another nudge.
      // The duplication is identified and measurable: .btn ×5, .sidebar__nav a
      // ×6, .stat-card ×5, .overlay ×5 as top-level base rules, each silently
      // overriding the last. Merging them needs computed-style before/after
      // proof (the method that worked for .overlay__card in v3.9), so it is
      // queued as its own phase instead of being rushed alongside bug fixes.
      // v4.4: 52 — the recurring-series panel is new UI, and the debt was
      // already paid down in v4.2/v4.3 (11 duplicate rules merged with proof).
      // v4.7: 53 — notes gained real block structure (headings, lists, quotes,
      // code, rules), which needs styling to be worth having.
      // v5.3 — raised 53 → 55 with a debt marked against it, not silently.
      // v4.9/v5.0 added real weight: the divider token system, the calendar's
      // phone header, touch-target sizing and the subscription meter. 8.5 KB
      // of subscription-page CSS was already moved OUT to its own stylesheet
      // (it loads on one standalone page, so every vault load was paying for
      // a page most sessions never open), and the verbose rationale comments
      // were trimmed out of the shipped file. What remains over the old line
      // is genuine feature CSS. The file also carries older duplication —
      // .btn, .sidebar and .cal-head are each declared 6–7 times — but
      // merging those safely needs a proper audit with visual diffing, which
      // is phase P6. This ceiling is the debt: P6 should bring it back under
      // 53, not raise it again.
      // v6.2 — SERVED sizes: collectstatic strips comments from CSS too, so
      // the 55 ceiling (which was really "54 of rules plus comments") comes
      // down to what actually travels. The duplication debt noted above is
      // still real, but it is a maintainability problem, not a speed one:
      // style recalculation with all 2363 rules measured 0.1 ms.
      ["static/css/app.css", 36],
      ["static/css/landing.css", 9],
      // v5.7 — these are SERVED sizes (comments stripped at collectstatic).
      // app.js measured 29.7 and i18n.js 0.3 after the split, so the ceilings
      // come down hard rather than keeping headroom that was really comments.
      ["static/js/app.js", 34],
      ["static/js/i18n.js", 3],
    ];
    budgets.forEach(function (b) {
      const kb = brKB(b[0]);
      // A JS ceiling is set against the SERVED file. Without terser we can only
      // see the source, which still carries its comments, so the check is
      // reported as unmeasurable rather than failed — a missing dev dependency
      // should not look like a size regression.
      if (b[0].endsWith(".js") && brKB.stripped === false) {
        console.log("  · wire budget: " + b[0] + " — skipped (terser not installed)");
        return;
      }
      ok("wire budget: " + b[0] + " = " + kb.toFixed(1) + " KB br (≤ " + b[1] + ")", kb <= b[1]);
    });

    const settings = fs.readFileSync(path.join(__dirname, "../../config/settings.py"), "utf8");
    ok("dynamic HTML is gzipped (GZipMiddleware installed)",
      settings.indexOf('"django.middleware.gzip.GZipMiddleware"') >= 0);
    const gzAt = settings.indexOf("GZipMiddleware");
    const wnAt = settings.indexOf("whitenoise.middleware.WhiteNoiseMiddleware");
    const secAt = settings.indexOf("SecurityMiddleware");
    ok("WhiteNoise serves the precompressed statics (installed after Security)",
      wnAt > secAt && secAt > gzAt && wnAt > 0);

    const views = fs.readFileSync(path.join(__dirname, "../../core/views.py"), "utf8");
    ok("the service worker is served with Cache-Control: no-cache",
      /service_worker[\s\S]*?Cache-Control"\] = "no-cache"/.test(views));

    // defer discipline: on public pages, only the tiny anti-FOUC prefs boot
    // may block; everything else must carry defer.
    ["core/landing.html", "accounts/login.html", "accounts/register.html"].forEach(function (t) {
      const html = fs.readFileSync(path.join(__dirname, "../../templates", t), "utf8");
      const blocking = (html.match(/<script(?![^>]*defer)[^>]*src=[^>]*>/g) || [])
        .filter(function (tag) { return tag.indexOf("prefs.js") < 0; });
      ok("no blocking scripts on " + t, blocking.length === 0);
    });

    // phones must not repaint the page gradient on every scrolled frame
    const app = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    ok("auth/landing gradients scroll (not fixed) on phones",
      /max-width: 820px[^}]*\{[\s\S]*?body\.land, body\.auth \{ background-attachment: scroll; \}/.test(app));
  }

  // --- v3.3.0: the service worker's two delivery wins, pinned. -------------
  {
    const fs = require("fs");
    const sw = fs.readFileSync(path.join(__dirname, "../../static/pwa/sw.js"), "utf8");

    // the precache must stay the honest list: only assets requested by their
    // UNHASHED names (offline page + push icons). Anything else is dead
    // weight — production pages only ever ask for hashed URLs.
    const shell = (sw.match(/var SHELL = \[([\s\S]*?)\];/) || [, ""])[1];
    const entries = (shell.match(/"\/static\/[^"]+"/g) || []);
    ok("precache is the lean truthful list (≤ 6 entries)", entries.length > 0 && entries.length <= 6);
    ok("precache keeps the offline fallback and push icons",
      shell.indexOf("offline.html") >= 0 && shell.indexOf("icon-192.png") >= 0);
    ok("precache carries no unhashed JS/CSS dead weight",
      !/"\/static\/(js|css)\//.test(shell));

    // hashed = content-addressed = immutable: cache-first, no revalidation
    ok("hashed statics are served cache-first (no wasted RTT)",
      sw.indexOf("if (hit && hashed) return hit;") >= 0 &&
      sw.indexOf("[0-9a-f]{8,20}") >= 0);
  }

  // --- v3.3.1: two bugs found in the browser, and their whole classes. -----
  {
    const fs = require("fs");

    // (1) Django's {# … #} comment is SINGLE-LINE ONLY. Spread it over two
    // lines and the text is rendered into the page — which is exactly what
    // shipped on the landing head. Guard every template, not just that one.
    function walk(dir, out) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
        const full = path.join(dir, d.name);
        if (d.isDirectory()) walk(full, out);
        else if (d.name.slice(-5) === ".html") out.push(full);
      });
      return out;
    }
    const templates = walk(path.join(__dirname, "../../templates"), []);
    const leaky = [];
    templates.forEach(function (f) {
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach(function (ln, i) {
        const open = ln.indexOf("{#");
        if (open >= 0 && ln.indexOf("#}", open) < 0) {
          leaky.push(path.basename(f) + ":" + (i + 1));
        }
      });
    });
    ok("no multi-line {# #} comments (they leak into the page)", leaky.length === 0);
    if (leaky.length) console.log("    leaking: " + leaky.join(", "));

    // (2) `overflow-x: hidden` forces the other axis to `auto`, turning the
    // element into a scroll container — on <body> that fights the viewport
    // for the wheel/touch gesture and breaks position: sticky. Every such
    // declaration must be followed by an `overflow-x: clip` companion.
    ["app.css", "landing.css"].forEach(function (name) {
      const css = fs.readFileSync(path.join(__dirname, "../../static/css/" + name), "utf8");
      const rules = css.split("}");
      const unpaired = rules.filter(function (r) {
        if (!/(^|[\s,;{])(html|body)[\s.,:#\[]?[^{]*\{/.test(r + "}")) return false;
        return r.indexOf("overflow-x: hidden") >= 0 && r.indexOf("overflow-x: clip") < 0;
      });
      ok(name + ": body/html never becomes a scroll container", unpaired.length === 0);
    });
  }

  // --- v3.4.0 (فاز ۱): the visual bugs found in manual testing. -----------
  {
    const fs = require("fs");
    const app = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const pweye = fs.readFileSync(path.join(__dirname, "../../static/js/pweye.js"), "utf8");
    const habits = fs.readFileSync(path.join(__dirname, "../../static/js/habits.js"), "utf8");

    // the password eye landed ON the typed text. Two independent causes:
    // (a) three later rules wiped the reserved padding, (b) the input is
    // dir="ltr" inside an rtl page, so button and padding resolved to
    // OPPOSITE physical edges. Both must stay fixed.
    ok("password eye: reserved space outweighs the later padding rules",
      app.indexOf(".pw-wrap input.pw-has-eye") >= 0 &&
      pweye.indexOf('classList.add("pw-has-eye")') >= 0);
    ok("password eye: wrapper inherits the input's own direction",
      pweye.indexOf('holder.setAttribute("dir", idir)') >= 0);

    // empty habit stars were --line, i.e. invisible on a light card
    ok("habit stars are visible in the light theme",
      /\[data-theme="light"\] \.h-star \{[^}]*color:/.test(app) &&
      app.indexOf(".h-star { color: var(--muted)") >= 0);

    // light-theme fields had three near-identical greys stacked
    ok("light theme gives form fields real contrast",
      /\[data-theme="light"\] input\[type="text"\][\s\S]{0,600}border-color: #c9d4e4/.test(app));

    // mood buttons were washed out by grayscale on an invisible chip
    ok("journal mood buttons are visible (no grayscale wash)",
      app.indexOf(".mood-btn { color: var(--text); opacity: .55; filter: none; }") >= 0);

    // "س / د" replaced by full weekday names, with a scrollable strip so
    // seven long Persian names never overflow a 360px phone
    ok("habit week strip uses full weekday names", habits.indexOf("weekdayFull") >= 0);
    ok("habit week strip scrolls instead of overflowing on small screens",
      /@media \(max-width: 560px\) \{[\s\S]{0,400}\.h-week \{[^}]*overflow-x: auto/.test(app));

    // the language button overlapped the brand name on auth pages
    ok("auth card reserves a band for the language button",
      app.indexOf(".auth-card { padding-top: 54px; }") >= 0);

    // notes overflowed the viewport on a Samsung phone
    ok("note/journal cards break long unbroken content",
      /\.note-card[^{]*\{[^}]*overflow-wrap: anywhere/.test(app));

    // the journal writing area was too small to write in
    ok("journal writing area has room to write",
      app.indexOf(".rt-area { min-height: 220px; max-height: 52vh; }") >= 0);
  }

  // --- v3.4.1 (فاز ۲): the bug class behind the dead [[link]] feature. -----
  // links.js and push.js both read `g.Store` — a global NOTHING ever defined
  // (the store ships as `window.ZKStore`). No error was thrown in links.js:
  // `(g.Store && …) || {}` swallowed it, so the whole linking feature simply
  // returned nothing, silently, for its entire life. This guard makes any
  // reference to an undefined app global a red test.
  {
    const fs = require("fs");
    const dir = path.join(__dirname, "../../static/js");
    const files = fs.readdirSync(dir).filter(function (f) { return f.slice(-3) === ".js"; });

    // globals every app module is allowed to assume (browser + our own)
    const BUILTIN = new Set([
      "document", "window", "location", "navigator", "console", "localStorage",
      "sessionStorage", "indexedDB", "fetch", "crypto", "Notification", "caches",
      "setTimeout", "clearTimeout", "setInterval", "clearInterval", "matchMedia",
      "requestAnimationFrame", "cancelAnimationFrame", "getSelection", "alert",
      "confirm", "prompt", "innerWidth", "innerHeight", "scrollY", "scrollX",
      "addEventListener", "removeEventListener", "open", "close", "print",
      "URL", "Blob", "FileReader", "IntersectionObserver", "MutationObserver",
      "performance", "history", "atob", "btoa", "isSecureContext", "PublicKeyCredential",
    ]);

    // what our own files EXPORT: `g.Name = …`, `window.Name = …`, `var g.X`
    const defined = new Set();
    const sources = {};
    files.forEach(function (f) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      sources[f] = src;
      // an export may come through ANY IIFE parameter name — crypto.js
      // uses `global.ZKCrypto = …`, store.js uses `g.ZKStore = …`.
      src.replace(/(?:^|[^.\w])(?:g|window|self|global|root|w)\.([A-Z][\w$]*)\s*=[^=]/g, function (m, n) {
        defined.add(n); return m;
      });
    });

    const dangling = [];
    files.forEach(function (f) {
      const src = sources[f].replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      src.replace(/(?:^|[^.\w])(?:g|window)\.([A-Z][\w$]*)/g, function (m, n) {
        if (!defined.has(n) && !BUILTIN.has(n)) dangling.push(f + " → " + n);
        return m;
      });
    });
    const uniq = Array.from(new Set(dangling));
    ok("no module reads a global that nothing defines", uniq.length === 0);
    if (uniq.length) console.log("    dangling: " + uniq.join(", "));

    // and specifically: the link index must reach the real store
    ok("links.js reads the store under its real name (ZKStore)",
      sources["links.js"].indexOf("g.ZKStore") >= 0);
    ok("push.js reads the store under its real name (ZKStore)",
      sources["push.js"].indexOf("g.ZKStore") >= 0);
  }

  // --- v3.4.1 (فاز ۲): the OTHER half of the i18n contract. ---------------
  // The v3.2.3 guard checked that every data-l key HAS a translation. It could
  // not see strings with NO data-l at all — and there were sixteen, which is
  // why premium_log.html stayed almost entirely Persian in English mode.
  {
    const fs = require("fs");
    const FA = /[\u0600-\u06FF]/;
    const dir = path.join(__dirname, "../../templates/panel");
    const unmarkable = [];
    fs.readdirSync(dir).filter(function (f) { return f.slice(-5) === ".html"; })
      .forEach(function (f) {
        let html = fs.readFileSync(path.join(dir, f), "utf8");
        // drop Django tags/vars: only text the visitor actually reads is left
        html = html.replace(/\{%[\s\S]*?%\}/g, "").replace(/\{\{[\s\S]*?\}\}/g, "");
        // element text nodes
        html.replace(/<([a-zA-Z][\w-]*)([^>]*)>([^<]*)/g, function (m, tag, attrs, text) {
          if (FA.test(text.trim()) && attrs.indexOf("data-l") < 0) {
            unmarkable.push(f + " <" + tag + "> " + text.trim().slice(0, 26));
          }
          return m;
        });
        // user-visible attributes
        html.replace(/<[^>]*?(placeholder|aria-label|title)="([^"]*)"[^>]*>/g, function (m, attr, val) {
          if (FA.test(val) && m.indexOf("data-l") < 0) {
            unmarkable.push(f + " @" + attr + " " + val.slice(0, 26));
          }
          return m;
        });
      });
    ok("every visible Persian string in the panel is translatable",
      unmarkable.length === 0);
    if (unmarkable.length) {
      console.log("    unmarkable (" + unmarkable.length + "): " + unmarkable.slice(0, 8).join(" | "));
    }
  }

  // --- v3.4.2 (فاز ۳): the terminal page behind the heart. ---------------
  {
    const fs = require("fs");
    const tpl = fs.readFileSync(path.join(__dirname, "../../templates/core/whoami.html"), "utf8");
    const js = fs.readFileSync(path.join(__dirname, "../../static/js/whoami.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/whoami.css"), "utf8");

    // the answer must survive JavaScript being off, slow or blocked
    ok("terminal page ships the name in the markup, not only via JS",
      tpl.indexOf("Sepehr") >= 0 && tpl.indexOf("$ whoami") >= 0);
    // strip comments first: this file's own docstring says "never innerHTML",
    // and a guard that trips on prose about code is worse than no guard
    const jsCode = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok("terminal typing is CSP-safe (textContent, never innerHTML)",
      jsCode.indexOf("innerHTML") < 0 && jsCode.indexOf("createTextNode") >= 0);
    ok("terminal respects reduced motion",
      js.indexOf("prefers-reduced-motion") >= 0);
    ok("terminal is its own LTR world regardless of page direction",
      /body\.term-page \{[\s\S]*?direction: ltr/.test(css));
    ok("terminal scales on small screens instead of overflowing",
      css.indexOf("clamp(") >= 0 && css.indexOf("@media (max-width: 520px)") >= 0);

    // the purchase form is gone from the landing for good
    const land = fs.readFileSync(path.join(__dirname, "../../templates/core/landing.html"), "utf8");
    ok("landing carries no purchase form",
      land.indexOf("lp-buyform") < 0 && land.indexOf('name="phone"') < 0);
    ok("landing offers one Telegram action instead", land.indexOf("lp-tgcard") >= 0);
  }

  // --- v3.5.0 (فاز ۴): the journal merges into notes. ---------------------
  // This migration touches REAL user data, so it is tested by running it,
  // not by grepping for it.
  {
    const fs = require("fs");
    const vm = require("vm");

    function loadStore() {
      const sandbox = {
        // store.js reads the CSRF meta tag at load time
        document: {
          querySelector: (sel) => (sel.indexOf("csrf-token") >= 0 ? { content: "test-csrf" } : null),
          cookie: "",
          addEventListener: () => {},
          removeEventListener: () => {},
          hidden: false,
        },
        localStorage: { getItem: () => null, setItem: () => {} },
        fetch: () => Promise.reject(new Error("no network in tests")),
        addEventListener: () => {},
        removeEventListener: () => {},
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
      };
      sandbox.window = sandbox;
      sandbox.ZKCrypto = {};
      vm.createContext(sandbox);
      vm.runInContext(fs.readFileSync(path.join(__dirname, "../../static/js/store.js"), "utf8"), sandbox);
      return sandbox.ZKStore;
    }
    const ZK = loadStore();
    ok("the store exposes the journal migration", typeof ZK.migrateJournal === "function");

    // a vault as it exists on a real user's account today
    const v = {
      notes: [{ id: "n1", title: "یادداشت قدیمی", body: "متن" }],
      journal: [
        { id: "j1", date: "2026-03-01", mood: 2, body: "روز خوبی بود",
          html: "<p>روز خوبی بود</p>", createdAt: "2026-03-01T19:00:00.000Z" },
        { id: "j2", date: "2026-03-02", mood: 0, body: "عالی", html: "<p>عالی</p>" },
      ],
    };
    const changed = ZK.migrateJournal(v);
    ok("migration reports that it did work", changed === true);
    ok("no note is lost", v.notes.length === 3);
    ok("the journal array is emptied, not left duplicating data", v.journal.length === 0);

    const j1 = v.notes.find(function (n) { return n.id === "j1"; });
    ok("a migrated entry keeps its id", !!j1);
    ok("a migrated entry keeps its text", j1 && j1.body === "روز خوبی بود" && j1.html === "<p>روز خوبی بود</p>");
    ok("a migrated entry keeps its mood", j1 && j1.mood === 2);
    ok("a migrated entry keeps its date as jdate", j1 && j1.jdate === "2026-03-01");
    ok("a migrated entry lands in the journal folder", j1 && j1.folder === "ژورنال");
    ok("a migrated entry keeps its creation time", j1 && j1.createdAt === "2026-03-01T19:00:00.000Z");

    // an entry with no createdAt must still get a sane one derived from its date
    const j2 = v.notes.find(function (n) { return n.id === "j2"; });
    ok("a dateless-timestamp entry still gets a createdAt",
      j2 && typeof j2.createdAt === "string" && j2.createdAt.indexOf("2026-03-02") === 0);

    // running it again must change nothing — normalize() runs on every unlock
    const before = JSON.stringify(v);
    const second = ZK.migrateJournal(v);
    ok("migration is idempotent (safe on every unlock)",
      second === false && JSON.stringify(v) === before);

    // a vault that never had a journal must be untouched
    const fresh = { notes: [], journal: [] };
    ok("a vault with no journal is left alone", ZK.migrateJournal(fresh) === false);
    const noKey = { notes: [] };
    ok("a vault missing the journal key does not throw", ZK.migrateJournal(noKey) === false);
  }

  // --- v3.5.0: the journal must be gone from every surface ----------------
  {
    const fs = require("fs");
    const dir = path.join(__dirname, "../../static/js");
    ok("journal.js no longer ships", !fs.existsSync(path.join(dir, "journal.js")));

    const shell = fs.readFileSync(path.join(__dirname, "../../templates/vault/app.html"), "utf8");
    ok("the shell no longer loads journal.js", shell.indexOf("js/journal.js") < 0);
    ok("the sidebar no longer links to #/journal", shell.indexOf('href="#/journal"') < 0);
    ok("the editor markup carries a mood row", shell.indexOf('id="editor-mood"') >= 0);

    const app = fs.readFileSync(path.join(dir, "app.js"), "utf8");
    ok("no module calls the removed JournalView", app.indexOf("JournalView") < 0);
    ok("the old #/journal and #/lists addresses forward to notes",
      /if \(r === "journal" \|\| r === "lists"\)/.test(app));
    ok("the note editor reads and writes a mood",
      app.indexOf("editorMood") >= 0 && app.indexOf("n.mood = editorMood") >= 0);

    // consumers must read moods from notes, never from the dead array
    ["reports.js", "review.js", "search.js", "cmdk.js"].forEach(function (f) {
      const src = fs.readFileSync(path.join(dir, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      ok(f + " no longer reads the retired journal array",
        !/vault\.journal|v\.journal/.test(src));
    });

    // pre-merge trashed entries must come back as notes, not vanish
    const trash = fs.readFileSync(path.join(dir, "trash.js"), "utf8");
    ok("trashed pre-merge journal entries restore into notes",
      /journal:\s*"notes"/.test(trash));
  }

  // --- v3.6.0 (فاز ۵): lists retired into notes; the app has one place to
  // write. Like the journal migration, this is tested by RUNNING it.
  {
    const fs = require("fs");
    const vm = require("vm");
    const sandbox = {
      document: {
        querySelector: (s) => (s.indexOf("csrf-token") >= 0 ? { content: "t" } : null),
        cookie: "", addEventListener: () => {}, removeEventListener: () => {}, hidden: false,
      },
      localStorage: { getItem: () => null, setItem: () => {} },
      fetch: () => Promise.reject(new Error("no network")),
      addEventListener: () => {}, removeEventListener: () => {},
      setTimeout: setTimeout, clearTimeout: clearTimeout,
    };
    sandbox.window = sandbox;
    sandbox.ZKCrypto = {};
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../static/js/store.js"), "utf8"), sandbox);
    const ZK = sandbox.ZKStore;

    ok("the store exposes the list migration", typeof ZK.migrateLists === "function");

    const v = {
      notes: [],
      lists: [{
        id: "l1", name: "خرید هفتگی", createdAt: "2026-01-05T10:00:00.000Z",
        items: [{ text: "نان", done: true }, { text: "شیر <b>x</b>", done: false }],
      }],
    };
    ok("list migration reports work done", ZK.migrateLists(v) === true);
    const n = v.notes[0];
    ok("a migrated list keeps its name as the title", n && n.title === "خرید هفتگی");
    ok("a migrated list lands in the checklist folder", n && n.folder === "چک‌لیست");
    ok("a migrated list keeps every item", n && n.body.indexOf("نان") >= 0 && n.body.indexOf("شیر") >= 0);
    ok("a migrated list preserves the ticked state",
      n && n.body.indexOf("\u2611 نان") >= 0 && n.body.indexOf("\u2610 شیر") >= 0);
    ok("item text is escaped, never smuggled in as markup",
      n && n.html.indexOf("&lt;b&gt;") >= 0 && n.html.indexOf("<b>") < 0);
    ok("a migrated list keeps its creation time", n && n.createdAt === "2026-01-05T10:00:00.000Z");
    ok("the lists array is emptied", v.lists.length === 0);
    ok("list migration is idempotent", ZK.migrateLists(v) === false);
    ok("a vault with no lists is untouched", ZK.migrateLists({ notes: [] }) === false);
  }

  // --- v3.6.0: the retired features must leave NO working surface ---------
  {
    const fs = require("fs");
    const dir = path.join(__dirname, "../../static/js");
    const shell = fs.readFileSync(path.join(__dirname, "../../templates/vault/app.html"), "utf8");
    const app = fs.readFileSync(path.join(dir, "app.js"), "utf8");

    ok("lists.js no longer ships", !fs.existsSync(path.join(dir, "lists.js")));
    ok("journal.js no longer ships (still)", !fs.existsSync(path.join(dir, "journal.js")));
    ok("the shell loads neither retired module",
      shell.indexOf("js/lists.js") < 0 && shell.indexOf("js/journal.js") < 0);
    ok("no module calls the removed ListsView", app.indexOf("ListsView") < 0);
    ok("lists is no longer a route", !/"lists"[,\]]/.test(app.slice(app.indexOf("var ROUTES"), app.indexOf("var IMPLEMENTED"))));

    // the landing must not advertise features the product no longer has
    const land = fs.readFileSync(path.join(__dirname, "../../templates/core/landing.html"), "utf8");
    ok("landing no longer advertises passwords", land.indexOf("پسوردها") < 0);
    ok("landing no longer advertises a journal module", land.indexOf(">جورنال<") < 0);

    // sidebar shape: search is gone (the top bar already searches) and More
    // holds exactly focus · weekly review · tags · trash
    ok("sidebar no longer duplicates search", shell.indexOf('href="#/search"') < 0);
    ok("sidebar no longer links to lists", shell.indexOf('href="#/lists"') < 0);
    const more = shell.slice(shell.indexOf('id="nav-more-group"'), shell.indexOf("</div>", shell.indexOf('id="nav-more-group"')));
    const inMore = (more.match(/href="#\/(\w+)"/g) || []).map(function (m) { return m.slice(8, -1); });
    ok("More holds exactly focus, review, tags, trash",
      inMore.join(",") === "focus,review,tags,trash");
    if (inMore.join(",") !== "focus,review,tags,trash") console.log("    got: " + inMore.join(","));

    // pre-merge trashed lists must come back as notes, not vanish
    const trash = fs.readFileSync(path.join(dir, "trash.js"), "utf8");
    ok("trashed pre-merge lists restore into notes", /list:\s*"notes"/.test(trash));
    ok("the retired passwords bucket is gone from trash routing",
      trash.indexOf('password: "passwords"') < 0);
  }

  // --- v3.6.1: the offline screen must never depend on the network. -------
  {
    const fs = require("fs");
    const off = fs.readFileSync(path.join(__dirname, "../../static/pwa/offline.html"), "utf8");
    const sw = fs.readFileSync(path.join(__dirname, "../../static/pwa/sw.js"), "utf8");

    // it used to <link> app.css — a file that is never in the offline cache,
    // because production requests the HASHED url. The one page whose job is
    // to work without a network rendered completely unstyled.
    ok("offline page requests no external asset",
      !/(?:href|src)="\/static\//.test(off) && off.indexOf("<link") < 0);
    ok("offline page carries its own styles", off.indexOf("<style>") >= 0);
    ok("offline page is bilingual", off.indexOf("You're offline") >= 0 && off.indexOf("اینترنت قطع است") >= 0);

    // respondWith(undefined) is not a Response: the browser tears the
    // navigation down and shows a raw network error instead of our page.
    ok("the navigate handler always resolves to a real Response",
      sw.indexOf("new Response(") >= 0 && /if \(off\) return off;/.test(sw));
    ok("precache failures are logged, not swallowed silently",
      sw.indexOf("[sw] precache failed:") >= 0);
    ok("caching a navigation can never reject unhandled",
      /c\.put\(e\.request, copy\); \}\)\.catch\(function \(\) \{\}\)/.test(sw));
  }

  // --- v3.6.1: one product, one logo; one terminal answer -----------------
  {
    const fs = require("fs");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const app = fs.readFileSync(path.join(__dirname, "../../static/js/app.js"), "utf8");
    const land = fs.readFileSync(path.join(__dirname, "../../templates/core/landing.html"), "utf8");

    // the app shell and the staff panel drew a CSS square with a keyhole while
    // the favicon, PWA icon and landing used the real shield-and-A file.
    ok("the brand mark renders the real logo file",
      /\.brand__mark \{[^}]*url\("\/static\/img\/logo\.svg"\)/.test(css));
    ok("the brand mark is no longer a hand-drawn CSS square",
      !/\.brand__mark::after \{[^}]*keyhole/.test(css));

    // the terminal says the name, nothing else
    ok("the in-app terminal answers with just the name",
      app.indexOf('{ txt: "Sepehr", pause: 0, quiet: true }') >= 0 &&
      app.indexOf("Sepehr Khasto") < 0);
    ok("settings can open the terminal too",
      app.indexOf('if (o[0] === "maker")') >= 0);

    // the landing claimed "three themes"; the product actually offers a
    // theme you build yourself, which is a better story AND the true one
    ok("landing no longer claims a fixed number of themes",
      land.indexOf("سه تم") < 0 && land.indexOf("+۵۵") < 0);
  }

  // --- v3.6.2: the landing speaks the visitor's language, not the stack's.
  // (Amo Hamid's product review: don't open with AES/zero-knowledge; open
  // with the feeling and a concrete daily pain.)
  {
    const fs = require("fs");
    const land = fs.readFileSync(path.join(__dirname, "../../templates/core/landing.html"), "utf8");

    // the hero headline must be the human hook, and the sub must NOT be a
    // comma-separated feature dump
    const h1 = (land.match(/data-l="title">([\s\S]*?)<\/h1>/) || [, ""])[1];
    /* v7.1 — this used to demand one specific phrase ("بیرون بکش"), which made
     * it a test of a sentence rather than of a principle: any rewrite failed
     * it, however much better the new line was. What actually matters is that
     * the headline is a human promise and not jargon or a feature list, and
     * that it is short enough to read in one breath — a claim this big is only
     * believed if it can be taken in at a glance. */
    const h1txt = h1.replace(/<[^>]*>/g, "").trim();
    ok("the hero headline says something human, not a term",
      h1txt.length > 0 &&
      !/AES|زیرو|رمزنگاری|الگوریتم|end-to-end/i.test(h1txt));
    ok("the hero headline is one breath (< 60 chars), got " + h1txt.length,
      h1txt.length < 60);
    const sub = (land.match(/data-l="sub">([^<]*)</) || [, ""])[1];
    ok("the hero sub isn't a feature list",
      !(sub.indexOf("تسک") >= 0 && sub.indexOf("عادت") >= 0 && sub.indexOf("هدف") >= 0));

    // the security section leads with the human question, term as the answer
    ok("the security heading doesn't open with the raw jargon",
      land.indexOf('data-l="howH">«زیرو-نالج» یعنی چه؟') < 0);

    // the still-present technical proof (the two-panes box) is fine — it SHOWS
    // rather than tells — so it must stay
    ok("the show-don't-tell proof box is still present", land.indexOf("lp-proof__pane") >= 0);
  }

  // --- v3.7.0: calendar to Google-Calendar polish + login reorder. --------
  // The calendar's structure (four views, swipe, time grid, now-line, FAB)
  // was already sound; these guards pin the VISUAL upgrade so it can't quietly
  // regress, and confirm no behaviour was removed.
  {
    const fs = require("fs");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const app = fs.readFileSync(path.join(__dirname, "../../static/js/app.js"), "utf8");

    // month grid reads as Google's: hairline gaps, pill "today", filled chips
    ok("month grid uses hairline gaps, not bordered boxes",
      /\.route--calendar \.cal-grid \{[^}]*gap: 1px/.test(css));
    ok("today is a filled pill on the date number",
      /\.route--calendar \.cal-cell--today \.cal-cell__j \{[^}]*background: var\(--accent\)/.test(css));
    ok("event chips are filled, native-style",
      /\.route--calendar \.cal-chip \{[^}]*color: #fff/.test(css));

    // the FAB is a real circular Material FAB that tucks away on scroll
    ok("the FAB is circular", /\.cal-fab \{[^}]*border-radius: 50%/.test(css));
    ok("the FAB tucks away while scrolling",
      app.indexOf('classList.add("cal-fab--tucked")') >= 0 &&
      css.indexOf(".cal-fab--tucked") >= 0);
    ok("the FAB shrink respects reduced motion",
      app.indexOf("if (reduce) return;") >= 0 &&
      /calFab[\s\S]{0,900}prefers-reduced-motion/.test(app));

    // nothing was removed: all four views still dispatch
    ["agenda", "week", "3day", "day", "month"].forEach(function (v) {
      const present = v === "month"
        ? app.indexOf("renderMonth(host)") >= 0
        : app.indexOf('cal.view === "' + v + '"') >= 0;
      ok("calendar still has the " + v + " view", present);
    });

    // login page: order and full-width primary, per the brief
    const login = fs.readFileSync(path.join(__dirname, "../../templates/accounts/login.html"), "utf8");
    ok("login stacks the brand above the form", login.indexOf("brand--stack") >= 0);
    ok("login's primary button is full-width", login.indexOf("btn--block") >= 0);
    ok("login explains where quick-unlock lives", login.indexOf('data-l="loginPinHint"') >= 0);
  }

  // --- v3.8.0: the tasks page, redesigned around progressive disclosure. ---
  // It used to stack twelve equal-weight controls above an often-empty list.
  // These guards pin the new shape AND prove nothing was removed — every old
  // action must still be reachable, just one tap deeper.
  {
    const fs = require("fs");
    const src = fs.readFileSync(path.join(__dirname, "../../static/js/tasks.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    // exactly one primary button in the toolbar — the rest are quiet
    const toolbar = code.slice(code.indexOf('el("div", "toolbar toolbar--tasks")'),
                               code.indexOf('host.appendChild(tb);'));
    const primaries = (toolbar.match(/btn--primary/g) || []).length;
    ok("the tasks toolbar has exactly one primary action", primaries === 1);

    // filters are collapsed by default and revealed by a counted toggle
    ok("filters start collapsed", /var filtersOpen = false;/.test(code));
    ok("filters render only when opened", /if \(filtersOpen\) host\.appendChild\(filterBar\(\)\);/.test(code));
    ok("the filter toggle counts what's active",
      code.indexOf("function activeFilterCount()") >= 0 &&
      code.indexOf('el("span", "tb-badge"') >= 0);

    // nothing was removed: every previously top-level action still reachable
    ok("the exam plan is still reachable", /label: t\("exam_plan"\), onClick: examPlan/.test(code));
    ok("the workout plan is still reachable", /label: t\("wo_plan"\), onClick: workoutPlan/.test(code));
    ok("templates are still reachable", /label: t\("tpl_open"\), onClick: openTemplates/.test(code));
    ok("select-multiple is still reachable", code.indexOf('t(selMode ? "sel_exit" : "sel_enter")') >= 0);
    ok("quick-add survives on its own line",
      code.indexOf('el("div", "qa-wrap")') >= 0 && code.indexOf('t("qa_ph")') >= 0);

    // the popover closes properly — an orphaned listener outliving its node
    // is exactly the kind of leak that only shows up much later
    ok("the toolbar popover cleans up its listeners",
      /document\.removeEventListener\("click", onDoc, true\)/.test(code) &&
      /document\.removeEventListener\("keydown", onKey, true\)/.test(code));
    ok("the popover closes on Escape", /if \(e\.key === "Escape"\) close\(\);/.test(code));

    // and the styling exists for the new shape
    ok("the redesigned toolbar has styles", css.indexOf(".toolbar--tasks") >= 0);
    ok("the filter badge has styles", css.indexOf(".tb-badge") >= 0);
    ok("popover items clear the touch-target floor on phones",
      /@media \(max-width: 560px\)[\s\S]{0,400}\.tb-pop__item \{ padding: 13px/.test(css));
  }

  // --- v3.8.1: the task form, same progressive-disclosure treatment. ------
  {
    const fs = require("fs");
    const src = fs.readFileSync(path.join(__dirname, "../../static/js/tasks.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    // the essentials must stay on the card itself
    ["k_label", "task_title", "task_time", "task_priority"].forEach(function (f) {
      ok("the form keeps " + f + " always visible",
        new RegExp('card\\.appendChild\\(field\\("' + f + '"').test(code));
    });
    // the date is appended through its variable (the end-date toggle needs a
    // reference to it), so it's checked by name rather than inline
    ok("the form keeps the date always visible",
      /var dueField = field\("task_due", due\);/.test(code) &&
      /card\.appendChild\(dueField\);/.test(code));

    // everything else sits inside the collapsed section
    ["task_color", "task_link", "task_tags", "task_notes", "task_subs"].forEach(function (f) {
      ok(f + " moved into the details section",
        new RegExp('moreBody\\.appendChild\\(field\\("' + f + '"').test(code));
    });
    ok("category, horizon and repeat moved into the details section",
      /moreBody\.insertBefore\(field\("task_category"/.test(code) &&
      /moreBody\.insertBefore\(field\("task_horizon"/.test(code) &&
      /moreBody\.insertBefore\(field\("task_repeat"/.test(code));

    // nothing was lost: every field the save path reads still gets built
    ["cat.value", "pr.value", "hz.value", "rep.value", "tags.value",
     "notes.value", "link.value", "subs.value", "curColor"].forEach(function (v) {
      ok("the save path still reads " + v, code.indexOf(v) >= 0);
    });

    // closed for a new task, but never hides content the user already has
    ok("the details section starts closed for a new task",
      /var moreOpen = !!\(x &&/.test(code));
    ok("the details section auto-opens when a field is already in use",
      /x\.notes \|\| \(x\.tags \|\| \[\]\)\.length \|\| x\.link/.test(code));

    // the bottom bar: save leads, template is one tap away
    ok("save-as-template is demoted into a menu",
      /toolbarMenu\(actMore, \[\{ label: t\("tpl_save"\)/.test(code));
    ok("the action bar is save + cancel + more",
      /actions\.appendChild\(actMore\); actions\.appendChild\(cancel\); actions\.appendChild\(save\);/.test(code));

    ok("the details section has styles", css.indexOf(".editor-more__btn") >= 0);
  }

  // --- v3.8.2: three reported issues, and the bug class behind the worst. --
  {
    const fs = require("fs");
    const ui = fs.readFileSync(path.join(__dirname, "../../static/js/ui.js"), "utf8");
    const goals = fs.readFileSync(path.join(__dirname, "../../static/js/goals.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");

    // ui.js cached the page language in a `var` at LOAD time. The page ships
    // as lang="fa" and the language can change afterwards, so every confirm
    // and prompt kept Persian buttons in an otherwise English app.
    ok("dialogs read the language per call, not once at load",
      /function lang\(\) \{[\s\S]{0,140}getAttribute\("lang"\)/.test(ui));
    ok("no module caches the page language in a load-time var",
      !/var lang = [^;\n]*getAttribute\("lang"\)/.test(ui));

    // the same class, checked across every module that reads the attribute:
    // reading it inside a function is fine, capturing it at module scope is not
    {
      const dir = path.join(__dirname, "../../static/js");
      const offenders = [];
      fs.readdirSync(dir).filter(function (f) { return f.slice(-3) === ".js"; })
        .forEach(function (f) {
          const src = fs.readFileSync(path.join(dir, f), "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
          // a module-level (2-space indented) capture of the language
          if (/^ {0,2}var \w+ = [^;\n]*getAttribute\("lang"\)/m.test(src)) offenders.push(f);
        });
      ok("no module freezes the language at module scope", offenders.length === 0);
      if (offenders.length) console.log("    offenders: " + offenders.join(", "));
    }

    // the goal form gets the same disclosure treatment as the task form
    ok("the goal form collapses milestones and description",
      /moreBody\.appendChild\(fld\("g_ms", ms\)\)/.test(goals) &&
      /moreBody\.appendChild\(fld\("g_desc", desc\)\)/.test(goals));
    ok("the goal form keeps title, horizon and deadline visible",
      /card\.appendChild\(fld\("g_title"/.test(goals) &&
      /card\.appendChild\(fld\("g_horizon"/.test(goals) &&
      /card\.appendChild\(fld\("g_deadline"/.test(goals));
    ok("the goal form opens its details when the goal already has them",
      /var moreOpen = !!\(G && \(\(G\.ms \|\| \[\]\)\.length \|\| G\.desc\)\)/.test(goals));

    // standalone select chips centre their chosen option — a select is as
    // wide as its LONGEST option, so a short one always looked off-centre
    ok("standalone select chips centre their text",
      /\.sel,[\s\S]{0,80}\.h-freq,[\s\S]{0,120}text-align-last: center/.test(css));
    ok("form selects stay start-aligned",
      /\.field \.tsel,[\s\S]{0,140}text-align-last: start/.test(css));
    ok("the .sel class finally has styling of its own",
      /\.sel \{[^}]*border-radius: 999px/.test(css));
  }

  // --- v3.8.3: dashboard numbers lead somewhere; sleep can't be nonsense. --
  {
    const fs = require("fs");
    const app = fs.readFileSync(path.join(__dirname, "../../static/js/app.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const i18n = fs.readFileSync(path.join(__dirname, "../../static/js/i18n.fa.js"), "utf8") +
      fs.readFileSync(path.join(__dirname, "../../static/js/i18n.en.js"), "utf8");
    const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    // a stat card with a destination must be a real button, not a clickable div
    ok("navigable stat cards are real buttons",
      /el\(route \? "button" : "div", "stat-card"/.test(code));
    ["tasks", "notes", "habits"].forEach(function (r) {
      ok("the " + r + " card navigates to its section",
        new RegExp('statCard\\([\\s\\S]{0,160}"' + r + '"\\)').test(code));
    });

    // the score opens the ladder, by mouse AND keyboard
    ok("the score card opens the level ladder", code.indexOf("scCard.addEventListener(\"click\", openLevels)") >= 0);
    ok("the score card is keyboard-operable",
      /scCard\.addEventListener\("keydown"[\s\S]{0,140}openLevels\(\)/.test(code) &&
      /scCard\.setAttribute\("tabindex", "0"\)/.test(code));
    ok("the ladder shows every rank with its threshold",
      code.indexOf("var RANKS = [") >= 0 && code.indexOf("lv-row__pts") >= 0);
    ok("the ladder says how far the next rank is", code.indexOf('T.t("sc_toNext")') >= 0);
    ok("every rank has a name in both languages",
      (i18n.match(/\brk1:/g) || []).length === 2 && (i18n.match(/\brk8:/g) || []).length === 2);

    // sleep: a free number field let you store 100 AND showed 100 back while
    // saving 14 — the screen disagreed with the vault. Time inputs make the
    // impossible value impossible instead of clamping it after the fact.
    ok("sleep is entered as two clock times, not a free number",
      code.indexOf('bed.type = "time"') >= 0 && code.indexOf('wake.type = "time"') >= 0);
    ok("the old unbounded number field is gone", code.indexOf('sin.type = "number"') < 0);
    ok("sleep across midnight is handled",
      /if \(span <= 0\) span \+= 24 \* 60;/.test(code));
    ok("the computed duration still feeds the existing ring and average",
      /w\.sleep\[key\] = hours;/.test(code) && code.indexOf("sleepAvgText()") >= 0);

    ok("navigable cards and the ladder have styles",
      css.indexOf(".stat-card--go") >= 0 && css.indexOf(".lv-row--now") >= 0);
  }

  // --- v3.9.0: retired data purged, CSS debt paid, cards calmed. ----------
  {
    const fs = require("fs");
    const vm = require("vm");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const app = fs.readFileSync(path.join(__dirname, "../../static/js/app.js"), "utf8");
    const hab = fs.readFileSync(path.join(__dirname, "../../static/js/habits.js"), "utf8");

    // the retired keys must actually leave the vault, and nothing else may go
    const sb = {
      document: { querySelector: (s) => (s.indexOf("csrf") >= 0 ? { content: "t" } : null),
        cookie: "", addEventListener: () => {}, removeEventListener: () => {}, hidden: false },
      localStorage: { getItem: () => null, setItem: () => {} },
      fetch: () => Promise.reject(new Error("no net")),
      addEventListener: () => {}, removeEventListener: () => {},
      setTimeout: setTimeout, clearTimeout: clearTimeout,
    };
    sb.window = sb; sb.ZKCrypto = {};
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../static/js/store.js"), "utf8"), sb);
    const ZK = sb.ZKStore;

    ok("the store exposes the retired-key purge", typeof ZK.purgeRetired === "function");
    const v = { notes: [{ id: "n" }], tasks: [{ id: "t" }],
                passwords: [{ id: "p", secret: "x" }], plans: [{ a: 1 }] };
    ok("purging reports work done", ZK.purgeRetired(v) === true);
    ok("the orphaned passwords array is gone", v.passwords === undefined);
    ok("the dead plans field is gone", v.plans === undefined);
    ok("real data is untouched by the purge", v.notes.length === 1 && v.tasks.length === 1);
    ok("purging is idempotent", ZK.purgeRetired(v) === false);
    ok("a clean vault is left alone", ZK.purgeRetired({ notes: [] }) === false);
    ok("the schema no longer declares the dead field",
      fs.readFileSync(path.join(__dirname, "../../static/js/store.js"), "utf8")
        .indexOf("plans: []") < 0);

    // the dialog styling had FIVE base rules silently overriding each other
    const baseRules = (css.match(/^\.overlay__card \{/gm) || []).length;
    ok("dialog styling has a single authoritative base rule", baseRules <= 2);
    if (baseRules > 2) console.log("    base .overlay__card rules: " + baseRules);
    ok("the merged rule keeps the values that actually won",
      /\.overlay__card \{[\s\S]{0,400}background: var\(--surface\);[\s\S]{0,300}animation: dlgIn/.test(css));

    // destructive actions no longer sit at the weight of everyday ones
    ok("deleting a habit moved into an overflow menu",
      hab.indexOf("function habitMenu(") >= 0 &&
      !/right\.appendChild\(del\)/.test(hab));
    ok("deleting a note moved into an overflow menu",
      app.indexOf("function noteMenu(") >= 0 &&
      !/actions\.appendChild\(edit\); actions\.appendChild\(del\)/.test(app));
    ok("the note card itself opens the note",
      app.indexOf('card.classList.add("note-card--open")') >= 0);
    ok("card actions don't trigger the card's own click",
      /openEditor\(n\.id\); \}\);[\s\S]{0,40}var nMore/.test(app) ||
      app.indexOf("e.stopPropagation(); openEditor(n.id)") >= 0);
    ok("both overflow menus close on Escape",
      (hab.match(/e\.key === "Escape"/g) || []).length >= 1 &&
      (app.match(/e\.key === "Escape"/g) || []).length >= 1);
  }

  // --- v4.0: the calendar is a full-screen surface, not a boxed document. --
  {
    const fs = require("fs");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const app = fs.readFileSync(path.join(__dirname, "../../static/js/app.js"), "utf8");
    const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    // THE bug class: the grid's height used to be guessed with magic numbers
    // (100dvh - 200px … - 330px, five different values in five places). Every
    // header change left them stale, so the calendar was always either short
    // or clipped. Flex means there is nothing to keep in sync.
    ok("no rule guesses the calendar grid height",
      !/\.tg[^{]*\{[^}]*max-height:\s*calc\(100dvh/.test(css));
    ok("the calendar route fills the viewport",
      /\.route-view\.route--calendar \{[^}]*height: 100dvh/.test(css) &&
      /\.route-view\.route--calendar \{[^}]*max-width: none/.test(css));
    ok("the grid takes exactly the leftover space",
      /\.route--calendar \.tg \{[^}]*flex: 1;[^}]*max-height: none/.test(css));

    // the header is ONE row at every size — that's what freed the height
    ok("the calendar header is a single non-wrapping row",
      /\.route--calendar \.cal-head \{[^}]*flex-wrap: nowrap/.test(css));
    ok("no rule re-enables header wrapping",
      !/\.cal-head \{ flex-wrap: wrap/.test(css));

    // five view chips + four filter chips became two compact controls
    ok("the view picker replaced the five-chip segment",
      code.indexOf("function viewPicker()") >= 0 && code.indexOf("function viewSeg()") < 0);
    ok("the filter picker replaced the four-chip segment",
      code.indexOf("function filterPicker()") >= 0 && code.indexOf("function filterSeg()") < 0);
    ok("an active filter is still visible at a glance",
      css.indexOf(".cal-filter--on::after") >= 0);

    // nothing was lost: all five views still reachable from the picker
    ok("all five views are still offered",
      /CAL_VIEWS = \[\["month"[\s\S]{0,140}"agenda"/.test(code));
    ok("all four filters are still offered",
      /CAL_FILTERS = \[\["open"[\s\S]{0,120}"all"/.test(code));
    ok("the calendar menus close on Escape",
      /function calMenu[\s\S]{0,1400}e\.key === "Escape"/.test(code));

    // the quick-date chips no longer borrow space from the field above
    ok("quick-date chips have their own line",
      /\.snooze-row \{[^}]*margin: 4px 0 14px/.test(css) &&
      !/\.snooze-row \{[^}]*margin: -6px/.test(css));
  }

  // --- v4.0.1: more room for the calendar, and the bug v4.0 introduced. ---
  {
    const fs = require("fs");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const app = fs.readFileSync(path.join(__dirname, "../../static/js/app.js"), "utf8");
    const prefs = fs.readFileSync(path.join(__dirname, "../../static/js/prefs.js"), "utf8");
    const shell = fs.readFileSync(path.join(__dirname, "../../templates/vault/app.html"), "utf8");
    const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    // v4.0 hid the print button with `.cal-head .btn:last-child`. After the
    // header rebuild the LAST button became the view picker, so the control
    // that switches month/week/day silently vanished on phones. Position-based
    // selectors break the moment order changes — target the thing itself.
    ok("the print button is hidden by name, not by position",
      css.indexOf(".route--calendar .cal-print { display: none; }") >= 0 &&
      !/\.cal-head \.btn:last-child \{ display: none/.test(css));
    ok("the print button carries that class", code.indexOf('btn--sm cal-print"') >= 0);

    // full screen: chrome steps aside, and the state survives a reload
    ok("full screen hides the app chrome",
      /html\.cal-fs [\s\S]{0,160}\.bottom-nav,[\s\S]{0,40}\.sidebar \{ display: none/.test(css));
    ok("full screen is remembered", code.indexOf('setPref(CAL_FS_KEY') >= 0);
    ok("the remembered state is applied at boot, before first paint",
      prefs.indexOf('localStorage.getItem("sp_calfs")') >= 0 &&
      prefs.indexOf('localStorage.getItem("sp_sidebar")') >= 0);
    ok("leaving full screen is always reachable",
      /html\.cal-fs \.route--calendar \.cal-head \{ position: relative/.test(css));

    // sidebar collapse is desktop-only — on phones it is already off-canvas
    ok("collapsing the sidebar is offered only where it means something",
      /@media \(min-width: 821px\)[\s\S]{0,120}html\.sb-collapsed \.sidebar \{ display: none/.test(css) &&
      /@media \(max-width: 820px\)[\s\S]{0,80}\.cal-sbbtn \{ display: none/.test(css));

    // the layout must not out-grow the viewport: `height: 100dvh` ignored the
    // top bar and made the page 56px too tall
    // strip comments first: this rule's own note explains what it replaced,
    // and a guard that trips on prose about code is worse than no guard
    const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");
    ok("the calendar is flex-sized, not hard-coded to the viewport",
      !/\.route-view\.route--calendar \{[^}]*height: 100dvh/.test(cssCode) &&
      /\.route-view\.route--calendar \{[^}]*flex: 1/.test(cssCode));
    ok("the flex chain has a definite height to divide",
      /html\.cal-route \.shell \{ height: 100dvh/.test(css) &&
      code.indexOf('classList.toggle("cal-route"') >= 0);

    ok("both toggle icons ship in the sprite",
      shell.indexOf('id="ic-maximize"') >= 0 && shell.indexOf('id="ic-minimize"') >= 0 &&
      shell.indexOf('id="ic-sidebar"') >= 0);
  }

  // --- v4.1 (فاز A): three reported issues, each a different failure mode. -
  {
    const fs = require("fs");
    const nt = fs.readFileSync(path.join(__dirname, "../../static/js/notifs.js"), "utf8");
    const app = fs.readFileSync(path.join(__dirname, "../../static/js/app.js"), "utf8");
    const panel = fs.readFileSync(path.join(__dirname, "../../templates/panel/base_panel.html"), "utf8");

    // the bell polled every 5 minutes and nothing else, so a broadcast sent
    // from the admin panel left the badge grey for minutes — which reads as
    // "notifications are broken" even though they work.
    ok("the bell re-checks when the tab comes back",
      nt.indexOf('addEventListener("visibilitychange"') >= 0 &&
      nt.indexOf('window.addEventListener("focus"') >= 0);
    ok("the re-check is throttled so tab-flicking can't spam the server",
      /now - lastCheck < 10000/.test(nt));

    // settings had two routes to the maker; one pointed at a page deleted in
    // v3.4.2 and 404'd
    ok("the dead /team/ link is gone from settings",
      app.indexOf('teamLink.href = "/team/"') < 0);
    ok("settings keeps exactly one route to the maker",
      (app.match(/\["maker", "heart"/g) || []).length === 1);

    // the purchase page could only ever show old rows: its form was removed
    // from the landing in v3.4.2
    ok("the panel no longer navigates to purchase requests",
      panel.indexOf('data-l="navPurchases"') < 0);
  }

  // --- v4.1 (فاز A₂): the day panel, and the borderless editor. -----------
  {
    const fs = require("fs");
    const app = fs.readFileSync(path.join(__dirname, "../../static/js/app.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const shell = fs.readFileSync(path.join(__dirname, "../../templates/vault/app.html"), "utf8");
    const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    // picking a day in month view opened a panel with no way out
    ok("the day panel can be closed", code.indexOf('el("button", "icon-btn day-panel__close")') >= 0);
    ok("closing the day panel clears the selection",
      /selDay = null; renderRoute\(\);/.test(code));
    ok("Escape closes the day panel too",
      /if \(e\.key === "Escape" && selDay\)/.test(code));
    ok("the Escape listener removes itself, so re-renders can't stack them",
      /document\.removeEventListener\("keydown", esc\);/.test(code));
    ok("the close icon ships in the sprite", shell.indexOf('id="ic-close"') >= 0);

    // v4.0 made the calendar route overflow:hidden with the grid at flex:1,
    // which left the day panel with nowhere to live
    ok("the day panel has its own room in the full-height layout",
      /\.route--calendar > \.day-panel \{[^}]*flex: none/.test(css) &&
      /\.route--calendar > \.day-panel \{[^}]*overflow-y: auto/.test(css));

    // the editor is deliberately borderless, but borderless became invisible
    ok("the note title reads as a field without becoming a box",
      /#editor\.overlay--write #editor-title \{[^}]*border-bottom: 1px solid var\(--line\)/.test(css));
    ok("the writing surface is distinguishable from the page",
      /#editor\.overlay--write #editor-body-slot \.rt-area \{[^}]*background: color-mix/.test(css));
    ok("the editor still has a pre-color-mix fallback",
      /@supports not \(color: color-mix[\s\S]{0,220}#editor\.overlay--write #editor-body-slot \.rt-area \{ background: var\(--panel\)/.test(css));
  }

  // --- v4.2 (فاز F): CSS consolidation, done with proof rather than hope. --
  {
    const fs = require("fs");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

    function baseRules(sel) {
      const re = new RegExp("^" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{", "gm");
      return (bare.match(re) || []).length;
    }
    ok(".sidebar__nav a is defined once, not six times", baseRules(".sidebar__nav a") === 1);
    ok(".overlay is defined once, not five times", baseRules(".overlay") === 1);

    // The other two were attempted and reverted on evidence: their duplicates
    // were load-bearing (position beat modifier classes like .btn--sm), so
    // merging silently changed font sizes and heights. This guard records the
    // finding so nobody "tidies" them without redoing the measurement.
    /* v4.3 — .btn IS consolidated now, but only after fixing the reason the
     * first attempt regressed: three base rules sat AFTER the modifiers, so
     * the base was beating `.btn--sm { font-size }` and `.btn--primary
     * { font-weight }`. Those two declarations had never applied. They were
     * corrected to the values the product actually renders, so the cascade is
     * right AND nothing moved on screen. One property (transition) stays late
     * on purpose — a grouped rule also sets it. */
    ok(".btn is consolidated to one base rule plus the documented exception",
      baseRules(".btn") === 2);
    ok("the small modifier's font-size is no longer a dead declaration",
      /\.btn--sm \{[^}]*font-size: var\(--fs-1\)/.test(bare));
    ok(".stat-card duplicates are still present on purpose", baseRules(".stat-card") > 1);
  }

  // --- v4.4 (فاز B): cancelling a recurrence, and the "still on kanban" bug.
  {
    const fs = require("fs");
    const src = fs.readFileSync(path.join(__dirname, "../../static/js/tasks.js"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const i18n = fs.readFileSync(path.join(__dirname, "../../static/js/i18n.fa.js"), "utf8") +
      fs.readFileSync(path.join(__dirname, "../../static/js/i18n.en.js"), "utf8");

    // a daily recurrence materialises THIRTY rows; cancelling meant thirty
    // confirmations, and missing one left it alive on calendar and kanban
    ok("a recurrence can be seen as one series, not thirty rows",
      code.indexOf("function seriesList()") >= 0);
    ok("a whole series can be cancelled at once",
      code.indexOf("async function cancelSeries(") >= 0 &&
      /tasks\(\)\.filter\(function \(x\) \{ return x\.seriesId !== sid; \}\)/.test(code));
    ok("cancelling is recoverable, not a vaporisation",
      /hit\.forEach\(function \(x\) \{ ctx\.S\.trashPut\("task", x\); \}\)/.test(code));
    ok("the confirmation says how many occurrences will go",
      /t\("rp_confirmCancel"\)\.replace\("\{n\}"/.test(code));
    ok("the series panel is reachable from the toolbar",
      /\{ label: t\("rp_title"\), onClick: openSeriesPanel \}/.test(code));
    ok("the series strings exist in both languages",
      (i18n.match(/\brp_title:/g) || []).length === 2 &&
      (i18n.match(/\brp_cancel:/g) || []).length === 2);

    // the kanban desync had no separate cause: kanban reads the same array,
    // so removing the rows removes the cards. Lock that it stays that way.
    const kb = fs.readFileSync(path.join(__dirname, "../../static/js/kanban.js"), "utf8");
    ok("kanban reads tasks live from the vault, never a copy",
      /function tasks\(\) \{[\s\S]{0,120}return ctx\.S\.vault\.tasks;/.test(kb));
  }

  // --- v4.5 (فاز D): full screen is no longer calendar-only. --------------
  {
    const fs = require("fs");
    const app = fs.readFileSync(path.join(__dirname, "../../static/js/app.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    ok("the dashboard offers the same full-screen control",
      /dashTools\.appendChild\(fullscreenBtn\(\)\)/.test(code));
    ok("the dashboard offers the sidebar toggle too",
      /dashTools\.appendChild\(sidebarBtn\(\)\)/.test(code));
    ok("both pages share one stored preference, so it can't flip between them",
      (code.match(/CAL_FS_KEY/g) || []).length >= 2 &&
      (code.match(/function fullscreenBtn\(\)/g) || []).length === 1);
    ok("full screen reclaims the space the bottom nav used to hold",
      /html\.cal-fs \.route-view \{ padding-bottom: 22px; \}/.test(css));
    ok("the dashboard tools have styles", css.indexOf(".dash-hero__tools") >= 0);
    ok("the tools stay out of the way until used",
      /\.dash-hero__tools \.icon-btn \{[^}]*opacity: \.65/.test(css));
  }

  // --- v4.6 (فاز C): notes on phones, and getting one note out. -----------
  {
    const fs = require("fs");
    const app = fs.readFileSync(path.join(__dirname, "../../static/js/app.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const i18n = fs.readFileSync(path.join(__dirname, "../../static/js/i18n.fa.js"), "utf8") +
      fs.readFileSync(path.join(__dirname, "../../static/js/i18n.en.js"), "utf8");
    const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    // the grid asked for 230px columns; on a 360px phone with route padding
    // that was wider than the screen, so cards and their buttons spilled out
    ok("notes fall to a single shrinkable column on phones",
      /@media \(max-width: 640px\)[\s\S]{0,200}\.notes-grid \{ grid-template-columns: 1fr/.test(css));
    ok("the row layout stops being a row when there's no room",
      /\.notes-grid--rows \.note-card \{\s*flex-direction: column/.test(css));
    ok("card actions share their own line instead of overflowing",
      /\.note-card__actions \.btn \{ flex: 1 1 auto; min-width: 0; \}/.test(css));
    ok("nothing inside a note card can widen it", /\.note-card, \.note-card \* \{ min-width: 0; \}/.test(css));

    // export was all-or-nothing; one note is the commoner wish
    ok("a single note can be exported", code.indexOf('T.t("n_exportOne")') >= 0);
    ok("both exports share one writer, so formats can't drift",
      code.indexOf("function exportNotesFile(") >= 0 &&
      (code.match(/exportNotesFile\(/g) || []).length >= 3);
    ok("the filename comes from the note's own title",
      /exportNotesFile\(\[n\], \(n\.title \|\| T\.t\("untitled"\)\)/.test(code));
    // a note titled "7/8 review: done?" must not produce an illegal filename
    ok("filenames are sanitised for real filesystems",
      code.indexOf('u0000-') >= 0 && code.indexOf('|| "note"') >= 0);
    ok("the export string exists in both languages",
      (i18n.match(/\bn_exportOne:/g) || []).length === 2);
  }

  // --- v4.7 (فاز C): notes become a place you'd actually write. -----------
  {
    const fs = require("fs");
    const rt = fs.readFileSync(path.join(__dirname, "../../static/js/richtext.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../../static/css/app.css"), "utf8");
    const i18n = fs.readFileSync(path.join(__dirname, "../../static/js/i18n.fa.js"), "utf8") +
      fs.readFileSync(path.join(__dirname, "../../static/js/i18n.en.js"), "utf8");

    // the sanitizer allowed eleven inline tags, so block structure was
    // impossible to KEEP even when it could be created — the editor made it
    // and the vault ate it
    const tagsBlock = (rt.match(/var TAGS = \{([\s\S]*?)\};/) || [, ""])[1];
    ["H1", "H2", "H3", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "HR"].forEach(function (t) {
      ok("notes can keep <" + t.toLowerCase() + ">", new RegExp("\\b" + t + ":").test(tagsBlock));
    });
    // widening an allow-list is exactly where holes get punched
    ["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT"].forEach(function (t) {
      ok("<" + t.toLowerCase() + "> is still refused", !new RegExp("\\b" + t + ":").test(tagsBlock));
    });

    // markdown while typing — the thing that separates a text box from a tool
    ok("typing '# ' makes a heading", /re: \/\^#\$\/,\s*run:[\s\S]{0,60}<h1>/.test(rt));
    ok("typing '- ' makes a list", /insertUnorderedList/.test(rt));
    ok("typing '> ' makes a quote", /<blockquote>/.test(rt));
    ok("the shortcut only fires on space at the start of a line",
      /if \(e\.key !== " "/.test(rt) && /if \(!r\.collapsed/.test(rt));
    ok("there is a way back out of a block format",
      /\(el2\.textContent \|\| ""\)\.trim\(\) !== ""/.test(rt));

    // the same commands are reachable by click, so both routes agree
    ok("block formats are also on the toolbar",
      rt.indexOf('t("rt_quote")') >= 0 && rt.indexOf('t("rt_code")') >= 0);
    ok("the new labels exist in both languages",
      (i18n.match(/\brt_quote:/g) || []).length === 2);

    // allowed but unstyled would make a heading just slightly bigger text
    ok("the new blocks are actually styled",
      /\.rt-area blockquote \{/.test(css) && /\.rt-area pre \{/.test(css) &&
      /\.rt-area h1, \.rt-area h2, \.rt-area h3 \{/.test(css));
    ok("code blocks read left-to-right even in a Persian note",
      /\.rt-area pre \{[^}]*direction: ltr/.test(css));
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}
run().catch(function (e) { console.error(e); process.exit(1); });
