/* store.js — vault data layer. Holds the DEK + decrypted vault in memory and
 * syncs the encrypted blob with the server. Throws Error objects whose .code
 * the UI maps to a localized message. Never persists secrets to disk.
 */
(function (g) {
  "use strict";
  var C = g.ZKCrypto;
  var csrftoken = document.querySelector('meta[name="csrf-token"]').content;
  // v4.8 (فاز F): read-only mode after the subscription lapses. The vault still
  // decrypts and displays; only writes are frozen. The server enforces this
  // authoritatively (403 `read_only` on write endpoints) — this flag is the
  // client-side guard so an edit is blocked *before* it can be lost, and the
  // app can show a clear banner instead of a failed-save error.
  var readOnly =
    ((document.querySelector('meta[name="read-only"]') || {}).content === "1");
  function isReadOnly() { return readOnly; }

  var server = { initialized: false, meta: null, ciphertext: "", ciphertextIv: "", revision: 0, recovery: null };
  var session = { dek: null, dekRaw: null, vault: null };

  // ---- offline state (v1.13.3, فاز C مورد ۱۵) ----------------------------
  var net = { offline: false, pending: false, droppedPending: false };
  function announceNet(syncing, back) {
    try {
      document.dispatchEvent(new CustomEvent("sp:net", { detail: {
        offline: net.offline, pending: net.pending,
        syncing: !!syncing, back: !!back,
      } }));
    } catch (e) { /* very old browsers: the pill simply stays hidden */ }
  }
  function cacheSnapshot(pending) {
    if (!g.OffCache) return;
    g.OffCache.write({
      meta: server.meta, ciphertext: server.ciphertext,
      ciphertextIv: server.ciphertextIv, revision: server.revision,
      recovery: server.recovery, pending: pending || null,
    });
  }

  function err(code) { var e = new Error(code); e.code = code; return e; }

  function emptyVault() {
    return {
      version: 1,
      notes: [],
      tasks: [],
      journal: [],
      habits: [],
      lists: [],
      goals: [],
      templates: [],
      archive: [],
      wellness: { water: {}, sleep: {} },
      trash: [],
      settings: {},
    };
  }
  // v3.0.2 (ممیزی N10.2): this used to copy ONLY the keys emptyVault() knows,
  // which silently destroyed everything else. Two consequences, both real:
  //   • removing a feature (passwords, work) deleted that data on next save
  //     with no warning and no way back — in a zero-knowledge vault, that is
  //     unrecoverable;
  //   • worse, a device on an older build would erase any key a newer build
  //     had added, so two devices on different versions wiped each other.
  // Unknown keys are now preserved untouched. The known shape is still
  // guaranteed, so nothing downstream has to defend itself.
  function normalize(v) {
    var base = emptyVault();
    if (!v || typeof v !== "object") return base;
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = v[k]; });   // keep everything
    Object.keys(base).forEach(function (k) {
      if (out[k] === undefined) out[k] = base[k];              // guarantee shape
    });
    migrateJournal(out);
    migrateLists(out);
    purgeRetired(out);
    return out;
  }

  /* v3.9.0 — remove what the product no longer has.
   *
   * `passwords` lost its UI several versions ago but the array kept riding
   * along in every vault, and `plans` was declared in the schema and never
   * read by anything. Two different problems with the same fix:
   *
   *   • plans  — dead weight, encrypted and synced on every save for nothing.
   *   • passwords — a real liability. A privacy product should not keep a
   *     shadow copy of credentials the user can no longer see, review or
   *     rotate. Unreachable data you can't audit is worse than no data.
   *
   * This is deliberately unrecoverable: half-deleting credentials would be
   * the worst of both worlds. Users are told to export a backup before
   * upgrading, and the export still contains everything.
   * Idempotent: once the keys are gone, later runs do nothing. */
  function purgeRetired(v) {
    if (!v) return false;
    var changed = false;
    if (v.passwords !== undefined) { delete v.passwords; changed = true; }
    if (v.plans !== undefined) { delete v.plans; changed = true; }
    return changed;
  }

  /* v3.6.0 (فاز ۵): lists fold into notes too.
   *
   * Same contract as the journal migration: nothing is deleted, the content
   * just moves to where all writing now lives. A list becomes a note in the
   * «چک‌لیست» folder whose body is the items as a real checklist, so the
   * ticked/unticked state survives as readable text AND as HTML the rich
   * editor renders. Idempotent: after one run `v.lists` is empty. */
  var LIST_FOLDER = "چک‌لیست";
  function migrateLists(v) {
    if (!v || !Array.isArray(v.lists) || !v.lists.length) return false;
    if (!Array.isArray(v.notes)) v.notes = [];
    v.lists.forEach(function (L) {
      var items = Array.isArray(L.items) ? L.items : [];
      var text = items.map(function (i) {
        return (i.done ? "\u2611 " : "\u2610 ") + String(i.text || "");
      }).join("\n");
      var html = items.length
        ? "<ul>" + items.map(function (i) {
            var body = escapeHtml(String(i.text || ""));
            return "<li>" + (i.done ? "\u2611 <s>" + body + "</s>" : "\u2610 " + body) + "</li>";
          }).join("") + "</ul>"
        : "";
      v.notes.push({
        id: L.id || ("n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
        title: L.name || "",
        body: text,
        html: html,
        folder: LIST_FOLDER,
        mood: null,
        createdAt: L.createdAt || new Date().toISOString(),
        updatedAt: L.updatedAt || L.createdAt || new Date().toISOString(),
        pinned: false,
      });
    });
    v.lists = [];
    return true;
  }

  /* the migrated HTML goes through RT.sanitize() before it is ever rendered,
   * but escaping at the source means a list item can never even LOOK like
   * markup while it sits in the vault. */
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* v3.5.0 (فاز ۴): the journal merges into notes.
   *
   * Every old journal entry becomes a note in the «ژورنال» folder, keeping
   * its mood, its date (as `jdate`) and its text. Nothing is deleted — the
   * entries just live where all writing now lives. Runs inside normalize(),
   * which sits on EVERY decrypt path (password, passkey raw-DEK, recovery),
   * so no path can load a vault that still carries a populated journal.
   * Idempotent by construction: after one run `v.journal` is empty, so the
   * next run is a no-op. Exported on ZKStore for the test suite. */
  var JOURNAL_FOLDER = "ژورنال";
  function migrateJournal(v) {
    if (!v || !Array.isArray(v.journal) || !v.journal.length) return false;
    if (!Array.isArray(v.notes)) v.notes = [];
    v.journal.forEach(function (e) {
      v.notes.push({
        id: e.id || ("n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
        title: e.title || e.date || "",
        body: e.body || "",
        html: e.html || "",
        folder: JOURNAL_FOLDER,
        mood: (e.mood === undefined) ? null : e.mood,
        jdate: e.date || null,
        createdAt: e.createdAt || (e.date ? e.date + "T12:00:00.000Z" : new Date().toISOString()),
        updatedAt: e.updatedAt || e.createdAt || new Date().toISOString(),
        pinned: false,
      });
    });
    v.journal = [];
    return true;
  }

  async function getJSON(url) {
    var r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw err("server");
    return r.json();
  }
  async function postJSON(url, body) {
    var r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrftoken },
      body: JSON.stringify(body),
    });
    var data = await r.json().catch(function () { return {}; });
    return { ok: r.ok, status: r.status, data: data };
  }

  async function boot() {
    var s;
    try { s = await getJSON("/api/state/"); }
    catch (e) {
      // Only a NETWORK failure (fetch TypeError) may fall back to the local
      // encrypted cache; a reachable-but-unhappy server (500, expired session)
      // must not masquerade as offline mode (v1.13.3).
      var cached = (e instanceof TypeError) && g.OffCache ? g.OffCache.read() : null;
      if (cached && cached.meta) {
        server.initialized = true;
        server.meta = cached.meta;
        // if a save was queued offline, open the NEWEST local content
        server.ciphertext = (cached.pending && cached.pending.ciphertext) || cached.ciphertext;
        server.ciphertextIv = (cached.pending && cached.pending.ciphertextIv) || cached.ciphertextIv;
        server.revision = cached.revision;
        server.recovery = cached.recovery || null;
        net.offline = true; net.pending = !!cached.pending;
        announceNet();
        return "unlock";
      }
      throw err("server");
    }
    server.initialized = !!s.initialized;
    if (s.initialized) {
      server.meta = s.meta;
      server.ciphertext = s.ciphertext;
      server.ciphertextIv = s.ciphertextIv;
      server.revision = s.revision;
      server.recovery = s.recovery || null;
      // A save queued in an earlier offline session: push it now if the server
      // hasn't moved on; otherwise the newer server copy wins and we say so.
      var cached2 = g.OffCache && g.OffCache.read();
      if (cached2 && cached2.pending) {
        if (g.OffCache.shouldFlushPending(cached2.pending, s.revision)) {
          var fres = await postJSON("/api/save/", {
            ciphertext: cached2.pending.ciphertext,
            ciphertextIv: cached2.pending.ciphertextIv,
            revision: s.revision,
          }).catch(function () { return { ok: false }; });
          if (fres.ok && fres.data && typeof fres.data.revision === "number") {
            server.ciphertext = cached2.pending.ciphertext;
            server.ciphertextIv = cached2.pending.ciphertextIv;
            server.revision = fres.data.revision;
          }
        } else {
          net.droppedPending = true;   // surfaced as a toast by the app layer
        }
        g.OffCache.clearPending();
      }
      cacheSnapshot();
      return "unlock";
    }
    return "setup";
  }


  // Starter content for a brand-new vault: a few "learn by doing" tasks and a
  // welcome note (bilingual by current UI language), like Notion's onboarding.
  function seedStarter(vault) {
    var fa = (document.documentElement.getAttribute("lang") || "fa") !== "en";
    var now = new Date();
    var J = window.Jalali;
    var tj = J.toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());
    function tsk(title, pr) {
      return { id: "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title: title, notes: "", cat: "", pr: pr || "normal", hz: "", tags: [],
        rep: "none", link: "", color: "c0", goalId: "", subs: [],
        due: { jy: tj.jy, jm: tj.jm, jd: tj.jd }, done: false,
        createdAt: now.toISOString(), doneAt: null, timeFrom: "", timeTo: "", dueEnd: null };
    }
    vault.tasks = fa ? [
      tsk("👋 به Aegis خوش آمدی — این تسک را تیک بزن!", "high"),
      tsk("🗓️ برو به تقویم و با نگه‌داشتن روی یک ساعت خالی، یک تسک بساز"),
      tsk("🎨 از تنظیمات یک تم انتخاب کن و رنگ لهجه‌ات را بساز"),
      tsk("💾 از تنظیمات یک پشتیبان رمزشده بگیر"),
    ] : [
      tsk("👋 Welcome to Aegis — check this task off!", "high"),
      tsk("🗓️ Open the Calendar and long-press an empty hour to create a task"),
      tsk("🎨 Pick a theme in Settings and set your accent colour"),
      tsk("💾 Export an encrypted backup from Settings"),
    ];
    vault.notes = [{
      id: "n_" + Date.now().toString(36),
      title: fa ? "🌱 شروع کار با Aegis" : "🌱 Getting started with Aegis",
      body: fa
        ? "همه‌چیز اینجا قبل از خروج از مرورگرت رمز می‌شود — فقط خودت می‌توانی بخوانی.\n\n• تسک‌ها: با N یا دکمه‌ی + تسک بساز.\n• تقویم: بکش، جابه‌جا کن، اندازه بده.\n• Ctrl/⌘K: پرش سریع به همه‌جا.\n• راهنما: توضیح کامل هر بخش."
        : "Everything here is encrypted before it leaves your browser — only you can read it.\n\n• Tasks: press N or the + button.\n• Calendar: drag, move, resize.\n• Ctrl/⌘K: jump anywhere fast.\n• Help: full guide to every section.",
      pinned: true, createdAt: now.toISOString(),
    }];
  }

  async function setup(pw) {
    var km = await C.createKeyMaterial(pw);
    var vault = emptyVault();
    seedStarter(vault);
    var enc = await C.encryptVault(km.dek, vault);
    var res = await postJSON("/api/init/", {
      kdf: km.meta.kdf,
      iterations: km.meta.iterations,
      salt: km.meta.salt,
      wrappedKey: km.meta.wrappedKey,
      wrappedKeyIv: km.meta.wrappedKeyIv,
      ciphertext: enc.ciphertext,
      ciphertextIv: enc.ciphertextIv,
    });
    if (!res.ok) throw err("save");
    server.initialized = true;
    server.meta = km.meta;
    server.revision = res.data.revision;
    session.dek = km.dek;
    session.dekRaw = km.dekRaw;
    session.vault = vault;
  }

  async function unlock(pw) {
    var keys;
    try { keys = await C.unlock(pw, server.meta); } catch (e) { throw err("wrong"); }
    session.dek = keys.dek;
    session.dekRaw = keys.dekRaw;
    session.vault = server.ciphertext
      ? normalize(await C.decryptVault(session.dek, server.ciphertextIv, server.ciphertext))
      : emptyVault();
    trashPurge();
  }

  async function unlockWithRaw(dekRaw) {
    session.dekRaw = dekRaw;
    session.dek = await C.importDek(dekRaw);
    session.vault = server.ciphertext
      ? normalize(await C.decryptVault(session.dek, server.ciphertextIv, server.ciphertext))
      : emptyVault();
    trashPurge();
  }

  function lock() {
    if (session.dekRaw) session.dekRaw.fill(0);
    session = { dek: null, dekRaw: null, vault: null };
  }

  // ---- debounced, queued save -------------------------------------------
  // Rapid edits collapse into one request (~700ms quiet window). The promise
  // returned by save() resolves ONLY when the write actually lands, so callers
  // that show "saved"/"failed" tell the truth. A revision conflict (another
  // tab/device saved meanwhile) is healed once by refetching the latest
  // revision and retrying, since this is a single-user vault.
  var saveTimer = null;
  var savingNow = null;   // in-flight promise
  var dirtyAgain = false; // changed while a save was in flight
  var pendingWaiters = []; // resolve/reject callbacks awaiting the next flush

  async function pushSave(retriedConflict) {
    var enc = await C.encryptVault(session.dek, session.vault);
    var res;
    try {
      res = await postJSON("/api/save/", {
        ciphertext: enc.ciphertext,
        ciphertextIv: enc.ciphertextIv,
        revision: server.revision,
      });
    } catch (e) {
      // Network down (v1.13.3): the encrypted blob is kept locally and the
      // save RESOLVES — the edit is safe on this device and flushes as soon
      // as the connection returns. The pill in the header tells the truth.
      net.offline = true; net.pending = true;
      if (g.OffCache) g.OffCache.setPending(enc.ciphertext, enc.ciphertextIv, server.revision);
      announceNet();
      scheduleFlush();
      return;
    }
    if (res.ok) {
      if (!(res.data && typeof res.data.revision === "number")) {
        throw err("save");   // e.g. an expired session answered with HTML
      }
      server.revision = res.data.revision;
      server.ciphertext = enc.ciphertext;
      server.ciphertextIv = enc.ciphertextIv;
      var cameBack = net.offline || net.pending;
      net.offline = false; net.pending = false;
      if (g.OffCache) g.OffCache.clearPending();
      cacheSnapshot();
      announceNet(false, cameBack);
      return;
    }
    if (res.status === 409 && !retriedConflict) {
      // resync revision from the server and retry once
      if (res.data && typeof res.data.revision === "number") {
        server.revision = res.data.revision;
      } else {
        try { var st = await getJSON("/api/state/"); server.revision = st.revision; }
        catch (e) { /* fall through to error */ }
      }
      return pushSave(true);
    }
    // Defensive: the server is the authority. If it says read-only (e.g. the
    // subscription lapsed mid-session, before the page flag caught up), latch
    // the flag so subsequent edits are blocked locally too.
    if (res.status === 403 && res.data && res.data.error === "read_only") {
      readOnly = true;
      throw err("readonly");
    }
    throw err(res.status === 409 ? "conflict" : "save");
  }

  async function saveNow() {
    // Read-only: refuse the content write here, before anything is encrypted or
    // sent. Rejecting (rather than silently succeeding) means the UI tells the
    // truth and no edit is ever quietly dropped.
    if (readOnly) throw err("readonly");
    if (savingNow) { dirtyAgain = true; return savingNow; }
    savingNow = pushSave(false);
    try {
      await savingNow;
      // Reminder slots mirror the vault; refresh them (debounced) after any
      // successful write. No-op unless the user opted into push (v1.11).
      if (!net.offline && g.Push) g.Push.syncSoon();
    }
    finally {
      savingNow = null;
      if (dirtyAgain) { dirtyAgain = false; return saveNow(); }
    }
  }

  function save() {
    // Debounce rapid edits into one write, but resolve/reject with the REAL
    // outcome so the UI never claims success on a failed save.
    return new Promise(function (resolve, reject) {
      pendingWaiters.push({ resolve: resolve, reject: reject });
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        saveTimer = null;
        var waiters = pendingWaiters; pendingWaiters = [];
        saveNow().then(
          function () { waiters.forEach(function (w) { w.resolve(); }); },
          function (e) { waiters.forEach(function (w) { w.reject(e); }); }
        );
      }, 700);
    });
  }

  // Flush pending changes when leaving the page.
  window.addEventListener("beforeunload", function () {
    if (saveTimer) {
      clearTimeout(saveTimer); saveTimer = null;
      var waiters = pendingWaiters; pendingWaiters = [];
      saveNow().then(
        function () { waiters.forEach(function (w) { w.resolve(); }); },
        function (e) { waiters.forEach(function (w) { w.reject(e); }); }
      );
    }
  });

  async function exportBundle() {
    // Export must keep working in read-only mode (the user owns their data), so
    // only flush pending edits when we're actually allowed to write.
    if (!readOnly) await saveNow();
    var enc = await C.encryptVault(session.dek, session.vault);
    return {
      format: "securevault1",
      kdf: server.meta.kdf,
      iterations: server.meta.iterations,
      salt: server.meta.salt,
      wrappedKey: server.meta.wrappedKey,
      wrappedKeyIv: server.meta.wrappedKeyIv,
      ciphertext: enc.ciphertext,
      ciphertextIv: enc.ciphertextIv,
      exportedAt: new Date().toISOString(),
    };
  }

  function validBundle(b) {
    var req = ["kdf", "salt", "wrappedKey", "wrappedKeyIv", "ciphertext", "ciphertextIv"];
    return b && req.every(function (k) { return typeof b[k] === "string"; }) &&
      typeof b.iterations === "number";
  }

  async function restore(bundle) {
    if (readOnly) throw err("readonly");   // import replaces the vault: a write
    var res = await postJSON("/api/restore/", bundle);
    if (!res.ok) throw err("save");
  }

  async function rekey(newPw) {
    var wrap = await C.rewrap(session.dekRaw, newPw);
    var res = await postJSON("/api/rekey/", wrap);
    if (!res.ok) throw err("rekey");
    server.meta = {
      kdf: wrap.kdf,
      iterations: wrap.iterations,
      salt: wrap.salt,
      wrappedKey: wrap.wrappedKey,
      wrappedKeyIv: wrap.wrappedKeyIv,
    };
  }

  // ---- recovery key -------------------------------------------------------
  // Verify a master password without changing session state (the "confirm
  // before download" gate). Re-derives the KEK and tries to unwrap the DEK;
  // AES-GCM authentication fails on a wrong password.
  async function verifyPassword(pw) {
    try { await C.unlock(pw, server.meta); return true; }
    catch (e) { return false; }
  }

  // Server state is the source of truth for whether recovery actually works
  // (a wrapped DEK exists server-side). The printed key is cached inside the
  // vault so we can re-show it, but a stale cached key without a server wrap
  // (e.g. after importing a different vault) must NOT count as "enabled".
  function hasRecovery() { return !!server.recovery; }
  function getRecoveryKey() {
    return (session.vault && session.vault.settings && session.vault.settings.recovery)
      ? session.vault.settings.recovery.key : null;
  }

  // Generate a fresh recovery key, wrap the current DEK with it on the server,
  // and stash the printed key inside the (already-encrypted) vault so the user
  // can re-download it later. Returns the printed key.
  async function setupRecovery() {
    if (!session.dekRaw) throw err("locked");
    var key = C.newRecoveryKey();
    var wrap = await C.wrapWithRecovery(session.dekRaw, key);
    var res = await postJSON("/api/recovery/", wrap);
    if (!res.ok) throw err("save");
    server.recovery = { salt: wrap.salt, wrappedKey: wrap.wrappedKey, wrappedKeyIv: wrap.wrappedKeyIv };
    if (!session.vault.settings) session.vault.settings = {};
    session.vault.settings.recovery = { key: key, createdAt: new Date().toISOString() };
    // Setting up recovery is allowed in read-only mode (a security action, per
    // product decision). The server-side wrap above is what actually enables
    // recovery; stashing the printed key inside the vault is a convenience that
    // simply can't persist while writes are frozen — so tolerate that one case.
    try { await saveNow(); }
    catch (e) { if (e.code !== "readonly") throw e; }
    return key;
  }

  // Locked-out flow (on the unlock screen): unwrap the DEK with the printed
  // recovery key, open the vault, then immediately set a NEW master password.
  async function resetWithRecovery(recoveryKey, newPw) {
    if (!server.recovery) throw err("no_recovery");
    var dekRaw;
    try { dekRaw = await C.unwrapWithRecovery(recoveryKey, server.recovery); }
    catch (e) { throw err("bad_recovery"); }
    session.dekRaw = dekRaw;
    session.dek = await C.importDek(dekRaw);
    session.vault = server.ciphertext
      ? normalize(await C.decryptVault(session.dek, server.ciphertextIv, server.ciphertext))
      : emptyVault();
    await rekey(newPw);     // re-wrap DEK under the new master password
    trashPurge();
  }

  var TRASH_DAYS = 30;
  function trashPut(kind, item) {
    if (!session.vault.trash) session.vault.trash = [];
    session.vault.trash.push({ kind: kind, item: item, at: new Date().toISOString() });
  }
  function trashPurge() {
    if (!session.vault.trash) return;
    var cutoff = Date.now() - TRASH_DAYS * 86400000;
    session.vault.trash = session.vault.trash.filter(function (t) {
      return new Date(t.at).getTime() > cutoff;
    });
  }

  // Retry the queued save when the connection returns (v1.13.3).
  var flushTimer = null;
  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(function () { flushTimer = null; tryFlush(); }, 20000);
  }
  function tryFlush() {
    if (!net.pending || !session.dek) return;
    announceNet(true);
    saveNow().catch(function () { announceNet(); scheduleFlush(); });
  }
  window.addEventListener("online", tryFlush);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && net.pending) tryFlush();
  });

  g.ZKStore = {
    net: function () { return { offline: net.offline, pending: net.pending, dropped: net.droppedPending }; },
    isReadOnly: isReadOnly,
    clearDropped: function () { net.droppedPending = false; },
    trashPut: trashPut,
    trashPurge: trashPurge,
    boot: boot,
    setup: setup,
    unlock: unlock,
    csrf: function () { return csrftoken; },
    unlockWithRaw: unlockWithRaw,
    getDekRaw: function () { return session.dekRaw; },
    lock: lock,
    save: save,
    saveNow: saveNow,
    exportBundle: exportBundle,
    validBundle: validBundle,
    restore: restore,
    rekey: rekey,
    verifyPassword: verifyPassword,
    hasRecovery: hasRecovery,
    getRecoveryKey: getRecoveryKey,
    setupRecovery: setupRecovery,
    resetWithRecovery: resetWithRecovery,
    hasServerRecovery: function () { return !!server.recovery; },
    isUnlocked: function () { return !!session.dek; },
    get initialized() { return server.initialized; },
    get vault() { return session.vault; },
    migrateJournal: migrateJournal,   /* v3.5: exported for the test suite */
    migrateLists: migrateLists,       /* v3.6: idem */
    purgeRetired: purgeRetired,       /* v3.9: idem */
  };
})(window);
