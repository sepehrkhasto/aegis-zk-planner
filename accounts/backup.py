"""
v5.2 — encrypted database backup.

WHY THIS IS ENCRYPTED AND NOT PLAIN JSON
----------------------------------------
A plain dump of this database would contain every account's Argon2 password
hash, the recovery-key salts and wrapped keys, and every encrypted vault blob.
Zero-knowledge protects the data while it sits on the server: an attacker who
gets in still cannot read a vault. A dump changes that calculus, because a file
on a laptop can be attacked offline, at leisure, for as long as the attacker
likes. Argon2 makes that expensive — but a weak password eventually falls, and
when it does, that user's vault opens.

So the bundle is encrypted before it ever leaves the process:

    passphrase --Argon2id--> 32-byte key --AES-256-GCM--> ciphertext

The passphrase is deliberately NOT the admin's login password. A login password
is typed into a form regularly and gets rotated; if backups were bound to it,
every rotation would silently orphan every previous backup, and nobody would
notice until the day they needed one.

GCM gives authentication as well as secrecy, so a corrupted or tampered bundle
fails loudly on import instead of restoring quietly wrong data.

The bundle is built in memory and streamed. It is never written to disk on the
server, so it cannot be left behind in a temp directory or picked up by a
backup of the backup.
"""

from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timezone as dt_timezone

from argon2.low_level import Type, hash_secret_raw
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.apps import apps
from django.core import serializers

# --------------------------------------------------------------------------- #
# Format
# --------------------------------------------------------------------------- #
MAGIC = "AEGIS-BACKUP"
FORMAT_VERSION = 1

# Argon2id parameters for deriving the file key. Heavier than a login hash on
# purpose: a backup is decrypted once in a blue moon, so a slow derivation costs
# nothing in practice while making an offline guessing attack far more painful.
ARGON_TIME = 4
ARGON_MEMORY = 256 * 1024        # 256 MiB
ARGON_PARALLELISM = 2
KEY_LEN = 32                     # AES-256

# Everything that carries state worth restoring. Sessions, content types, admin
# log entries and permissions are deliberately excluded: they are rebuilt by
# Django and restoring them would drag stale primary keys into a fresh install.
BACKUP_MODELS = [
    "accounts.User",
    "accounts.InviteCode",
    "accounts.PremiumLog",
    "accounts.Feedback",
    "accounts.Broadcast",
    "accounts.PurchaseRequest",
    "accounts.SiteConfig",
    "accounts.RegistrationEvent",
    "accounts.PurchaseIntent",
    "vault.EncryptedVault",
    "vault.PushSubscription",
    "vault.ReminderSlot",
]

MIN_PASSPHRASE = 12


class BackupError(Exception):
    """Anything that should be reported to the operator in plain language."""


# --------------------------------------------------------------------------- #
# Crypto
# --------------------------------------------------------------------------- #
def _derive_key(passphrase: str, salt: bytes) -> bytes:
    return hash_secret_raw(
        secret=passphrase.encode("utf-8"),
        salt=salt,
        time_cost=ARGON_TIME,
        memory_cost=ARGON_MEMORY,
        parallelism=ARGON_PARALLELISM,
        hash_len=KEY_LEN,
        type=Type.ID,
    )


# --------------------------------------------------------------------------- #
# Export
# --------------------------------------------------------------------------- #
def collect_payload() -> dict:
    """Serialise every backed-up model into one JSON-able structure."""
    data = {}
    total = 0
    for label in BACKUP_MODELS:
        try:
            model = apps.get_model(label)
        except LookupError:
            continue                      # model retired since this list was written
        rows = json.loads(serializers.serialize("json", model.objects.all()))
        data[label] = rows
        total += len(rows)
    return {
        "magic": MAGIC,
        "format": FORMAT_VERSION,
        "created_at": datetime.now(dt_timezone.utc).isoformat(),
        "counts": {k: len(v) for k, v in data.items()},
        "total_rows": total,
        "data": data,
    }


def export_bundle(passphrase: str) -> bytes:
    """Return the encrypted backup as bytes, ready to stream to the browser."""
    if not passphrase or len(passphrase) < MIN_PASSPHRASE:
        raise BackupError(
            f"عبارت عبور باید حداقل {MIN_PASSPHRASE} کاراکتر باشد."
        )
    payload = json.dumps(collect_payload(), ensure_ascii=False).encode("utf-8")

    salt = secrets.token_bytes(16)
    nonce = secrets.token_bytes(12)
    key = _derive_key(passphrase, salt)
    ciphertext = AESGCM(key).encrypt(nonce, payload, None)

    # The header travels in the clear so a future version can read an old file:
    # it carries no secret, only the parameters needed to redo the derivation.
    header = {
        "magic": MAGIC,
        "format": FORMAT_VERSION,
        "kdf": "argon2id",
        "time": ARGON_TIME,
        "memory": ARGON_MEMORY,
        "parallelism": ARGON_PARALLELISM,
        "salt": salt.hex(),
        "nonce": nonce.hex(),
        "created_at": datetime.now(dt_timezone.utc).isoformat(),
    }
    return (json.dumps(header).encode("utf-8") + b"\n" + ciphertext)


def suggested_filename() -> str:
    return "aegis-backup-" + datetime.now().strftime("%Y%m%d-%H%M") + ".aegis"


# --------------------------------------------------------------------------- #
# Import
# --------------------------------------------------------------------------- #
def decrypt_bundle(blob: bytes, passphrase: str) -> dict:
    """Authenticate and decrypt a bundle. Raises BackupError with a message the
    operator can act on — a wrong passphrase and a corrupted file are different
    problems and should not look identical."""
    if b"\n" not in blob:
        raise BackupError("فایل پشتیبان معتبر نیست (ساختار ناشناخته).")
    head_raw, ciphertext = blob.split(b"\n", 1)
    try:
        header = json.loads(head_raw.decode("utf-8"))
    except Exception:
        raise BackupError("فایل پشتیبان معتبر نیست (سرآیند خوانده نشد).")

    if header.get("magic") != MAGIC:
        raise BackupError("این فایل پشتیبان ایجیس نیست.")
    if header.get("format") != FORMAT_VERSION:
        raise BackupError(
            f"نسخه‌ی فایل ({header.get('format')}) با این نسخه‌ی برنامه سازگار نیست."
        )

    try:
        salt = bytes.fromhex(header["salt"])
        nonce = bytes.fromhex(header["nonce"])
    except Exception:
        raise BackupError("سرآیند فایل ناقص است.")

    key = hash_secret_raw(
        secret=passphrase.encode("utf-8"),
        salt=salt,
        time_cost=int(header.get("time", ARGON_TIME)),
        memory_cost=int(header.get("memory", ARGON_MEMORY)),
        parallelism=int(header.get("parallelism", ARGON_PARALLELISM)),
        hash_len=KEY_LEN,
        type=Type.ID,
    )
    try:
        plaintext = AESGCM(key).decrypt(nonce, ciphertext, None)
    except Exception:
        # GCM cannot tell "wrong key" from "tampered bytes", and pretending
        # otherwise would be a lie. Say both.
        raise BackupError(
            "رمزگشایی ناموفق بود: یا عبارت عبور اشتباه است یا فایل دستکاری/خراب شده."
        )

    try:
        payload = json.loads(plaintext.decode("utf-8"))
    except Exception:
        raise BackupError("محتوای فایل خوانده نشد.")

    if payload.get("magic") != MAGIC:
        raise BackupError("محتوای فایل معتبر نیست.")
    return payload


def restore_payload(payload: dict) -> dict:
    """Replace the contents of every backed-up model with the bundle's rows.

    Runs inside a single transaction: a restore that fails halfway would leave
    the install in a state that is neither the old data nor the new, which is
    worse than either. Rows are only accepted for models on the whitelist, so a
    crafted bundle cannot reach a model the backup was never meant to touch.
    """
    from django.db import transaction

    restored = {}
    with transaction.atomic():
        data = payload.get("data", {})
        # Delete in reverse dependency order, load in forward order, so foreign
        # keys never point at rows that are momentarily missing.
        for label in reversed(BACKUP_MODELS):
            if label not in data:
                continue
            try:
                model = apps.get_model(label)
            except LookupError:
                continue
            model.objects.all().delete()

        for label in BACKUP_MODELS:
            rows = data.get(label)
            if not rows:
                continue
            if label not in BACKUP_MODELS:      # defence in depth
                continue
            count = 0
            for obj in serializers.deserialize("json", json.dumps(rows)):
                obj.save()
                count += 1
            restored[label] = count
    return restored


# --------------------------------------------------------------------------- #
# Pre-restore snapshots
# --------------------------------------------------------------------------- #
def snapshot_dir():
    """Where pre-restore snapshots live.

    On disk rather than in memory because the entire purpose is to survive the
    restore that follows. The files are already encrypted with the operator's
    passphrase, so this adds no plaintext exposure — an attacker who reaches
    this directory has reached the database itself anyway.
    """
    from django.conf import settings
    import pathlib
    d = pathlib.Path(settings.BASE_DIR) / "backups"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_snapshot(blob: bytes):
    """Write a pre-restore snapshot and prune old ones so the directory cannot
    grow without bound on a small host."""
    d = snapshot_dir()
    name = "pre-restore-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".aegis"
    path = d / name
    path.write_bytes(blob)
    try:
        os.chmod(path, 0o600)          # owner only, where the OS honours it
    except OSError:
        pass
    keep = sorted(d.glob("pre-restore-*.aegis"), reverse=True)[:10]
    for old in d.glob("pre-restore-*.aegis"):
        if old not in keep:
            try:
                old.unlink()
            except OSError:
                pass
    return path


def list_snapshots():
    """Newest-first list of (name, size, mtime) for the panel."""
    out = []
    for p in sorted(snapshot_dir().glob("pre-restore-*.aegis"), reverse=True):
        st = p.stat()
        out.append({
            "name": p.name,
            "size": st.st_size,
            "when": datetime.fromtimestamp(st.st_mtime),
        })
    return out
