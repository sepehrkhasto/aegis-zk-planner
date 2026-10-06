/* sw.js — minimal PWA worker.
 * static: stale-while-revalidate. HTML/app: network-first (fresh CSRF),
 * cached fallback for offline. Encrypted API calls are never cached.
 */
var V = "aegis-v710";

/* Precache (v3.3.0 — measured, not assumed): in production every page
 * references HASHED asset URLs (app.f3a1b2.css), so a precache of unhashed
 * paths could never match a single request — 34 files, ~180 KB, downloaded
 * on install and then dead. Offline has ALWAYS actually worked through the
 * runtime cache filling with the hashed files during the first visit; that
 * keeps working unchanged. What's left here is the honest list: the only
 * files the app requests by their unhashed names (the SW's own push icons
 * and the offline fallback page). Install went from ~700 KB to ~30 KB. */
var SHELL = [
  "/static/pwa/offline.html",
  "/static/img/logo.svg",
  "/static/pwa/icon-192.png",
  "/static/pwa/icon-512.png",
];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(V).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return c.add(u).catch(function (err) {
        /* v3.6.1: still tolerant (one missing icon must not abort install),
         * but no longer silent — a failed offline.html is exactly the kind of
         * thing that only shows up as a broken screen weeks later. */
        try { console.warn("[sw] precache failed:", u, err && err.message); } catch (e) {}
      });
    }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== V; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/accounts/")) return;
  // Never cache admin/panel navigations (they need fresh CSRF + auth state).
  if (url.pathname.startsWith("/panel/") || url.pathname.startsWith("/control")) return;

  if (url.pathname.startsWith("/static/")) {
    /* v3.3.0: a hashed name (app.1a2b3c4d.css) IS its content — revalidating
     * it is a pure wasted round-trip, and with ~30 assets per app load that
     * was 30 needless RTTs on every SW-controlled visit. Hashed → cache-first,
     * forever. Unhashed (dev mode, sw-adjacent files) → stale-while-revalidate
     * as before, so development never sees stale code. */
    var hashed = /\.[0-9a-f]{8,20}\.(?:css|js|woff2|png|svg|webmanifest)$/.test(url.pathname);
    e.respondWith(caches.open(V).then(function (c) {
      return c.match(e.request).then(function (hit) {
        if (hit && hashed) return hit;
        var net = fetch(e.request).then(function (res) {
          if (res.ok) c.put(e.request, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    }));
    return;
  }

  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(V).then(function (c) { c.put(e.request, copy); }).catch(function () {});
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        if (hit) return hit;
        // never-visited page while offline -> friendly fallback (v1.13.3)
        return caches.match("/static/pwa/offline.html").then(function (off) {
          if (off) return off;
          /* v3.6.1: if BOTH lookups miss, this used to resolve to `undefined`.
           * respondWith(undefined) is not a Response — the browser tears the
           * navigation down and shows a raw network-error screen instead of
           * anything of ours. The precache add() is deliberately fault
           * tolerant, so that path is reachable in the real world. Always
           * answer with a real Response. */
          return new Response(
            "<!doctype html><meta charset=utf-8>" +
            "<meta name=viewport content='width=device-width,initial-scale=1'>" +
            "<title>آفلاین</title>" +
            "<body style=\"margin:0;min-height:100vh;display:grid;place-items:center;" +
            "background:#0b1017;color:#eaf0f8;font-family:system-ui,sans-serif;text-align:center;padding:24px\">" +
            "<div><h1 style=\"font-size:1.15rem\">اینترنت قطع است</h1>" +
            "<p style=\"color:#9fb0c9\">You're offline.</p>" +
            "<a href=\"/app/\" style=\"color:#4f8cff\">بازگشت به اپ · Back to the app</a></div>",
            { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        });
      });
    }));
    return;
  }

  /* v3.6.1: anything else (images, manifest, cross-origin) is left to the
   * network on purpose — but if the SW is controlling the page and the
   * network is gone, an unhandled request simply fails, which is correct
   * and visible, rather than silently resolving to nothing. */
});

/* ---- Web Push (v1.11) ------------------------------------------------------
 * Tickles arrive with NO payload (zero-knowledge: the push pipe never carries
 * task content). The visible text was written to IndexedDB by the page in the
 * user's language; fall back to a bilingual line if it's missing. */
function swGetText() {
  return new Promise(function (res) {
    var open = indexedDB.open("aegis-push", 1);
    open.onupgradeneeded = function () { open.result.createObjectStore("kv"); };
    open.onsuccess = function () {
      var db = open.result;
      try {
        var tx = db.transaction("kv", "readonly");
        var get = tx.objectStore("kv").get("text");
        get.onsuccess = function () { db.close(); res(get.result || null); };
        get.onerror = function () { db.close(); res(null); };
      } catch (e) { db.close(); res(null); }
    };
    open.onerror = function () { res(null); };
  });
}

self.addEventListener("push", function (e) {
  e.waitUntil(swGetText().then(function (t) {
    return self.registration.showNotification(
      (t && t.title) || "Aegis Planner",
      {
        body: (t && t.body) || "یادآوری تسک · Task reminder",
        icon: "/static/pwa/icon-192.png",
        badge: "/static/pwa/icon-192.png",
        tag: "aegis-reminder",
        renotify: true,
      }
    );
  }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true })
    .then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf("/app/") !== -1) return list[i].focus();
      }
      return clients.openWindow("/app/");
    }));
});
