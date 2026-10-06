/* offline.js — encrypted local cache of the vault (v1.13.3, فاز C مورد ۱۵).
 *
 * Stores EXACTLY what the server stores: KDF params + the AES-256-GCM
 * ciphertext. Nothing here is readable without the master password, so the
 * zero-knowledge boundary is unchanged — this is the same trick Notesnook and
 * Standard Notes use for offline reading.
 *
 * `pending` holds one encrypted blob that could not reach the server (network
 * down). The vault is a single blob, so the queue is "last write wins":
 * flushing pushes the newest local ciphertext. `shouldFlushPending` refuses
 * to overwrite a server that moved on while we were offline (another device
 * saved); that rare case is surfaced to the user instead of silently clobbered.
 */
(function (g) {
  "use strict";
  var KEY = "sp_vault_cache";

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o !== "object" || !o.meta || typeof o.revision !== "number") return null;
      if (o.pending === undefined) o.pending = null;
      return o;
    } catch (e) { return null; }
  }

  function write(snap) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        meta: snap.meta,
        ciphertext: snap.ciphertext || "",
        ciphertextIv: snap.ciphertextIv || "",
        revision: typeof snap.revision === "number" ? snap.revision : 0,
        recovery: snap.recovery || null,
        pending: snap.pending || null,
        cachedAt: new Date().toISOString(),
      }));
      return true;
    } catch (e) { return false; }   // quota etc. — the cache is best-effort
  }

  function setPending(ciphertext, ciphertextIv, baseRevision) {
    var o = read();
    if (!o) return false;
    o.pending = {
      ciphertext: ciphertext, ciphertextIv: ciphertextIv,
      baseRevision: baseRevision, at: new Date().toISOString(),
    };
    return write(o);
  }

  function clearPending() {
    var o = read();
    if (!o) return false;
    o.pending = null;
    return write(o);
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  // Safe to push the offline blob only if the server is still at (or before)
  // the revision the offline edits were based on.
  function shouldFlushPending(pending, serverRevision) {
    return !!(pending && typeof pending.baseRevision === "number" &&
      typeof serverRevision === "number" && serverRevision <= pending.baseRevision);
  }

  g.OffCache = {
    read: read, write: write,
    setPending: setPending, clearPending: clearPending,
    clear: clear, shouldFlushPending: shouldFlushPending,
  };
})(window);
