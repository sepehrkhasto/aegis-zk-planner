/* crypto.js — zero-knowledge primitives (AES-256-GCM + PBKDF2-SHA256)
 *
 * Key hierarchy (like a password manager):
 *   master password --PBKDF2--> KEK  (never stored)
 *   random 256-bit DEK           (wrapped by KEK, stored as ciphertext)
 *   vault JSON --AES-GCM(DEK)--> ciphertext (stored)
 *
 * Changing the master password only re-wraps the DEK; the vault ciphertext
 * stays valid, so it's fast.
 */
(function (global) {
  "use strict";

  const KDF_ITERATIONS = 600000;
  const KDF_NAME = "PBKDF2-SHA256";
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function b64encode(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64decode(str) {
    const s = atob(str);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }
  function randomBytes(n) {
    return crypto.getRandomValues(new Uint8Array(n));
  }

  async function deriveKek(masterPassword, saltBytes, iterations) {
    const base = await crypto.subtle.importKey(
      "raw",
      enc.encode(masterPassword),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations: iterations, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function aesEncrypt(key, dataBytes) {
    const iv = randomBytes(12);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, dataBytes);
    return { iv: b64encode(iv), ct: b64encode(ct) };
  }
  async function aesDecrypt(key, ivB64, ctB64) {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(ivB64) },
      key,
      b64decode(ctB64)
    );
    return new Uint8Array(pt);
  }

  async function importDek(rawBytes) {
    return crypto.subtle.importKey("raw", rawBytes, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  }

  // Fresh key material for a brand-new vault, given a master password.
  async function createKeyMaterial(masterPassword) {
    const salt = randomBytes(16);
    const kek = await deriveKek(masterPassword, salt, KDF_ITERATIONS);
    const dekRaw = randomBytes(32);
    const wrapped = await aesEncrypt(kek, dekRaw);
    const dek = await importDek(dekRaw);
    return {
      meta: {
        kdf: KDF_NAME,
        iterations: KDF_ITERATIONS,
        salt: b64encode(salt),
        wrappedKey: wrapped.ct,
        wrappedKeyIv: wrapped.iv,
      },
      dek: dek,
      dekRaw: dekRaw,
    };
  }

  // Unlock an existing vault: derive KEK, unwrap DEK. Throws on wrong password
  // (AES-GCM authentication fails).
  async function unlock(masterPassword, meta) {
    const kek = await deriveKek(masterPassword, b64decode(meta.salt), meta.iterations);
    const dekRaw = await aesDecrypt(kek, meta.wrappedKeyIv, meta.wrappedKey);
    const dek = await importDek(dekRaw);
    return { dek: dek, dekRaw: dekRaw };
  }

  // Re-wrap an existing DEK under a new master password (change password).
  async function rewrap(dekRaw, newMasterPassword) {
    const salt = randomBytes(16);
    const kek = await deriveKek(newMasterPassword, salt, KDF_ITERATIONS);
    const wrapped = await aesEncrypt(kek, dekRaw);
    return {
      kdf: KDF_NAME,
      iterations: KDF_ITERATIONS,
      salt: b64encode(salt),
      wrappedKey: wrapped.ct,
      wrappedKeyIv: wrapped.iv,
    };
  }

  async function encryptVault(dek, obj) {
    const out = await aesEncrypt(dek, enc.encode(JSON.stringify(obj)));
    return { ciphertext: out.ct, ciphertextIv: out.iv };
  }
  async function decryptVault(dek, ivB64, ctB64) {
    const bytes = await aesDecrypt(dek, ivB64, ctB64);
    return JSON.parse(dec.decode(bytes));
  }

  // ---- device quick-unlock (PIN) -----------------------------------------
  // A PIN plus a random 256-bit on-device pepper together wrap the DEK. An
  // attacker needs BOTH the device's stored blob AND the PIN; a wrong PIN just
  // fails GCM authentication. This never replaces the master password — it's a
  // convenience for re-entering an already-unlocked vault on the same device.
  function concatBytes(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a); out.set(b, a.length);
    return out;
  }
  async function deriveKekBytes(bytes, saltBytes, iterations) {
    const base = await crypto.subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations: iterations, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function pinWrap(pin, dekRaw) {
    const pepper = randomBytes(32);
    const salt = randomBytes(16);
    const key = await deriveKekBytes(concatBytes(enc.encode(pin), pepper), salt, 150000);
    const w = await aesEncrypt(key, dekRaw);
    return { v: 1, iter: 150000, salt: b64encode(salt), pepper: b64encode(pepper), iv: w.iv, ct: w.ct };
  }
  async function pinUnwrap(pin, blob) {
    const key = await deriveKekBytes(
      concatBytes(enc.encode(pin), b64decode(blob.pepper)),
      b64decode(blob.salt), blob.iter || 150000);
    return aesDecrypt(key, blob.iv, blob.ct); // returns raw DEK bytes; throws on wrong PIN
  }

  // ---- recovery key -------------------------------------------------------
  // A recovery key is a second, independent way to unwrap the SAME DEK. We
  // generate 256 random bits, show them to the user as a grouped Crockford
  // base32 string, derive a KEK from that string (its own salt), and wrap the
  // DEK with it. The server stores only the wrapped DEK + salt — useless
  // without the printed key. Because it wraps the DEK (not the vault), it can
  // both (a) unlock the vault and (b) let the user set a brand-new master
  // password, all without the server ever seeing a secret.
  var B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford (no I L O U)
  function toBase32(bytes) {
    var bits = 0, val = 0, out = "";
    for (var i = 0; i < bytes.length; i++) {
      val = (val << 8) | bytes[i]; bits += 8;
      while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += B32[(val << (5 - bits)) & 31];
    return out;
  }
  function fromBase32(str) {
    var clean = str.toUpperCase().replace(/[^0-9A-Z]/g, "")
      .replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");
    var bits = 0, val = 0, out = [];
    for (var i = 0; i < clean.length; i++) {
      var idx = B32.indexOf(clean[i]);
      if (idx < 0) continue;
      val = (val << 5) | idx; bits += 5;
      if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    }
    return new Uint8Array(out);
  }
  // "AEGIS-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" — grouped, with a prefix
  // so a user can recognize the file's purpose at a glance.
  function newRecoveryKey() {
    var raw = randomBytes(20); // 160 bits -> 32 base32 chars, plenty
    var s = toBase32(raw);
    var groups = s.match(/.{1,5}/g) || [s];
    return "AEGIS-" + groups.join("-");
  }
  async function wrapWithRecovery(dekRaw, recoveryKey) {
    var salt = randomBytes(16);
    var kek = await deriveKekBytes(fromBase32(recoveryKey), salt, KDF_ITERATIONS);
    var w = await aesEncrypt(kek, dekRaw);
    return { salt: b64encode(salt), wrappedKey: w.ct, wrappedKeyIv: w.iv };
  }
  async function unwrapWithRecovery(recoveryKey, meta) {
    var kek = await deriveKekBytes(fromBase32(recoveryKey), b64decode(meta.salt), KDF_ITERATIONS);
    return aesDecrypt(kek, meta.wrappedKeyIv, meta.wrappedKey); // raw DEK; throws on bad key
  }

  // ---- raw-secret wrap (passkey / PRF, v1.12) ------------------------------
  // A WebAuthn PRF output is already 32 bytes of authenticator-guarded
  // entropy, so unlike a PIN it needs no stretching: import it directly as an
  // AES-256-GCM key and wrap the DEK. Everything stays on this device.
  async function rawWrap(secretBytes, dekRaw) {
    var key = await crypto.subtle.importKey(
      "raw", secretBytes, { name: "AES-GCM" }, false, ["encrypt"]);
    var iv = randomBytes(12);
    var ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, dekRaw);
    return { iv: b64encode(iv), ct: b64encode(new Uint8Array(ct)) };
  }
  async function rawUnwrap(secretBytes, blob) {
    var key = await crypto.subtle.importKey(
      "raw", secretBytes, { name: "AES-GCM" }, false, ["decrypt"]);
    var pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(blob.iv) }, key, b64decode(blob.ct));
    return new Uint8Array(pt);
  }

  global.ZKCrypto = {
    KDF_ITERATIONS: KDF_ITERATIONS,
    createKeyMaterial: createKeyMaterial,
    unlock: unlock,
    rewrap: rewrap,
    newRecoveryKey: newRecoveryKey,
    wrapWithRecovery: wrapWithRecovery,
    unwrapWithRecovery: unwrapWithRecovery,
    encryptVault: encryptVault,
    decryptVault: decryptVault,
    importDek: importDek,
    pinWrap: pinWrap,
    pinUnwrap: pinUnwrap,
    rawWrap: rawWrap,
    rawUnwrap: rawUnwrap,
  };
})(window);
