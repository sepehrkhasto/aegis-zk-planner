/* push.js — Web Push client (v1.11), zero-knowledge style.
 *
 * What leaves the device: the push subscription itself and a list of bare
 * reminder TIMESTAMPS for the next 7 days. No titles, no ids, no kinds.
 * The pushes that come back are EMPTY; the visible notification text is
 * written here into IndexedDB (in the user's language) and read by the
 * service worker when a tickle arrives.
 */
(function (g) {
  "use strict";

  var LEAD_KEY = "sp_push_lead";       // minutes before a timed task
  var ON_KEY = "sp_push_on";           // this device opted in

  function meta(name) {
    var m = document.querySelector('meta[name="' + name + '"]');
    return m ? m.content : "";
  }
  /* v3.4.1: `g.Store` never existed (the store is `window.ZKStore`), so this
   * threw a TypeError the moment push was used. */
  function store() { return g.ZKStore; }
  function csrf() { return store().csrf(); }
  function lead() { return parseInt(localStorage.getItem(LEAD_KEY) || "10", 10); }
  function setLead(min) { localStorage.setItem(LEAD_KEY, String(min)); }
  function available() {
    return !!(meta("vapid-public") && "serviceWorker" in navigator && "PushManager" in g);
  }
  function enabled() { return localStorage.getItem(ON_KEY) === "1"; }

  function b64uToBytes(s) {
    var pad = "=".repeat((4 - (s.length % 4)) % 4);
    var raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function post(url, body) {
    var r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
      body: JSON.stringify(body),
    });
    return r.ok;
  }

  // The SW cannot read localStorage; IndexedDB is the shared shelf. We store
  // the localized notification text at enable-time (and on language change).
  function putSwText(title, body) {
    return new Promise(function (res) {
      var open = indexedDB.open("aegis-push", 1);
      open.onupgradeneeded = function () { open.result.createObjectStore("kv"); };
      open.onsuccess = function () {
        var db = open.result;
        var tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put({ title: title, body: body }, "text");
        tx.oncomplete = function () { db.close(); res(true); };
        tx.onerror = function () { db.close(); res(false); };
      };
      open.onerror = function () { res(false); };
    });
  }
  function syncSwText() {
    var T = g.I18N;
    return putSwText(T.t("push_nTitle"), T.t("push_nBody"));
  }

  async function enable() {
    if (!available()) return "unavailable";
    var perm = await Notification.requestPermission();
    if (perm !== "granted") return "denied";
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64uToBytes(meta("vapid-public")),
    });
    var j = sub.toJSON();
    var ok = await post("/api/push/subscribe/", {
      endpoint: sub.endpoint,
      p256dh: (j.keys || {}).p256dh || "",
      auth: (j.keys || {}).auth || "",
    });
    if (!ok) return "server";
    localStorage.setItem(ON_KEY, "1");
    await syncSwText();
    await syncSlots();
    return "ok";
  }

  async function disable() {
    localStorage.removeItem(ON_KEY);
    try {
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if (sub) {
        await post("/api/push/unsubscribe/", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
    } catch (e) {}
    await post("/api/push/slots/", { times: [] });   // clear server slots
  }

  // Timed tasks (a due date + timeFrom) get one reminder `lead` minutes
  // before start, for the coming 7 days. Untimed tasks have no wall-clock
  // moment, so they stay in-app only — an honest v1 boundary.
  function computeTimes(vault) {
    var out = [];
    var now = Date.now();
    var horizon = now + 7 * 864e5;
    var J = g.Jalali;
    (vault.tasks || []).forEach(function (x) {
      if (x.done || x.archived || !x.due || !x.timeFrom) return;
      var m = /^(\d{1,2}):(\d{2})$/.exec(x.timeFrom);
      if (!m) return;
      var gd = J.toGregorian(x.due.jy, x.due.jm, x.due.jd);
      var at = new Date(gd.gy, gd.gm - 1, gd.gd, +m[1], +m[2]).getTime()
             - lead() * 60000;
      if (at > now && at < horizon) out.push(new Date(at).toISOString());
    });
    return out.sort();
  }

  var syncTimer = null;
  function syncSlots() {
    if (!enabled()) return Promise.resolve(false);
    var v = store().vault;
    if (!v) return Promise.resolve(false);
    return post("/api/push/slots/", { times: computeTimes(v) });
  }
  // Debounced: saveNow fires on every edit; the server needs the net result.
  function syncSoon() {
    if (!enabled()) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(syncSlots, 4000);
  }

  g.Push = {
    available: available,
    enabled: enabled,
    enable: enable,
    disable: disable,
    lead: lead,
    setLead: setLead,
    syncSoon: syncSoon,
    syncSlots: syncSlots,
    computeTimes: computeTimes,   // exported for the test suite
    syncSwText: syncSwText,
  };
})(window);
