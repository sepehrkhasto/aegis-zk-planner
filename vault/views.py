import json
import functools
from datetime import timedelta

from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.http import HttpResponseBadRequest, JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .models import EncryptedVault

# Rough cap on the encrypted blob so a single account can't exhaust storage.
MAX_CIPHERTEXT_CHARS = 6 * 1024 * 1024  # ~6 MB of base64


def _gate(request, *, need_write):
    """Shared access check for every vault endpoint (v4.8, فاز F).

    Returns None when the request may proceed, or an HttpResponse when it must
    be stopped. Three outcomes:

      * premium_active            → full access (read and write).
      * read-only (lapsed sub)    → reads pass; writes get 403 `read_only` but
                                    the session is KEPT, so the user can still
                                    read and export their own data.
      * hard block (kill-switch,  → access is revoked immediately, even
        unapproved, or disabled)    mid-session — exactly as before.
    """
    u = request.user
    if u.premium_active:
        return None
    if u.read_only_access:
        if not need_write:
            return None
        # A write attempt by a read-only user: refuse the write only — do NOT
        # log them out.
        if request.path.startswith("/api/"):
            return JsonResponse({"error": "read_only"}, status=403)
        return redirect("accounts:login")
    # Full block: admin kill-switch, unapproved, or disabled. Revoke now, even
    # mid-session, so flipping premium off takes effect on the next request.
    from django.contrib.auth import logout
    logout(request)
    if request.path.startswith("/api/"):
        return JsonResponse({"error": "premium_inactive"}, status=403)
    return redirect("accounts:login")


def read_required(view):
    """Reads — and the security actions that DON'T grow the vault (change master
    password, set recovery key) — are allowed for full AND read-only accounts."""
    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        stop = _gate(request, need_write=False)
        return stop if stop is not None else view(request, *args, **kwargs)
    return wrapped


def write_required(view):
    """Content writes require an active subscription; a lapsed (read-only)
    account is refused with 403 `read_only` instead of losing its session."""
    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        stop = _gate(request, need_write=True)
        return stop if stop is not None else view(request, *args, **kwargs)
    return wrapped


@login_required
@read_required
@ensure_csrf_cookie
def app(request):
    """The single-page vault UI. All crypto happens in the browser."""
    from django.conf import settings as dj
    return render(request, "vault/app.html", {
        "vapid_public": dj.VAPID_PUBLIC_KEY,
        # v4.8 (فاز F): drives the read-only banner + the client-side write
        # guard. Staff/superusers are always premium_active, so never read-only.
        "read_only": not request.user.premium_active,
    })


def _vault_of(user):
    return EncryptedVault.objects.filter(user=user).first()


def _json_body(request):
    try:
        return json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


def _valid_strings(data, keys):
    return all(isinstance(data.get(k), str) and data.get(k) for k in keys)


@login_required
@read_required
@require_GET
def state(request):
    v = _vault_of(request.user)
    if v is None:
        return JsonResponse({"initialized": False})
    payload = {
        "initialized": True,
        "meta": {
            "kdf": v.kdf,
            "iterations": v.kdf_iterations,
            "salt": v.salt,
            "wrappedKey": v.wrapped_key,
            "wrappedKeyIv": v.wrapped_key_iv,
        },
        "ciphertext": v.ciphertext,
        "ciphertextIv": v.ciphertext_iv,
        "revision": v.revision,
        "hasRecovery": bool(v.recovery_wrapped_key),
    }
    # The wrapped DEK + salt are safe to expose: they're useless without the
    # user's printed recovery key. Sending them lets a locked-out user reset
    # their master password on the unlock screen.
    if v.recovery_wrapped_key:
        payload["recovery"] = {
            "salt": v.recovery_salt,
            "wrappedKey": v.recovery_wrapped_key,
            "wrappedKeyIv": v.recovery_wrapped_key_iv,
        }
    return JsonResponse(payload)


@login_required
@write_required
@require_POST
def init_vault(request):
    if _vault_of(request.user) is not None:
        return JsonResponse({"error": "already_initialized"}, status=409)

    data = _json_body(request)
    if data is None:
        return HttpResponseBadRequest("bad json")

    required = ["kdf", "salt", "wrappedKey", "wrappedKeyIv", "ciphertext", "ciphertextIv"]
    if not _valid_strings(data, required) or not isinstance(data.get("iterations"), int):
        return HttpResponseBadRequest("missing fields")
    if len(data["ciphertext"]) > MAX_CIPHERTEXT_CHARS:
        return HttpResponseBadRequest("too large")

    v = EncryptedVault.objects.create(
        user=request.user,
        kdf=data["kdf"],
        kdf_iterations=data["iterations"],
        salt=data["salt"],
        wrapped_key=data["wrappedKey"],
        wrapped_key_iv=data["wrappedKeyIv"],
        ciphertext=data["ciphertext"],
        ciphertext_iv=data["ciphertextIv"],
        revision=1,
    )
    return JsonResponse({"revision": v.revision})


@login_required
@write_required
@require_POST
def save_vault(request):
    data = _json_body(request)
    if data is None:
        return HttpResponseBadRequest("bad json")
    if not _valid_strings(data, ["ciphertext", "ciphertextIv"]) or not isinstance(
        data.get("revision"), int
    ):
        return HttpResponseBadRequest("missing fields")
    if len(data["ciphertext"]) > MAX_CIPHERTEXT_CHARS:
        return HttpResponseBadRequest("too large")

    with transaction.atomic():
        v = EncryptedVault.objects.select_for_update().filter(user=request.user).first()
        if v is None:
            return JsonResponse({"error": "not_initialized"}, status=409)
        if data["revision"] != v.revision:
            # Someone (another tab/device) saved in the meantime.
            return JsonResponse({"error": "conflict", "revision": v.revision}, status=409)
        v.ciphertext = data["ciphertext"]
        v.ciphertext_iv = data["ciphertextIv"]
        v.revision += 1
        v.save(update_fields=["ciphertext", "ciphertext_iv", "revision", "updated_at"])
    return JsonResponse({"revision": v.revision})


@login_required
@read_required
@require_POST
def rekey(request):
    """Change the master password: only the wrapping fields change; the DEK
    (and therefore the ciphertext) stays the same, so this is cheap."""
    data = _json_body(request)
    if data is None:
        return HttpResponseBadRequest("bad json")
    required = ["kdf", "salt", "wrappedKey", "wrappedKeyIv"]
    if not _valid_strings(data, required) or not isinstance(data.get("iterations"), int):
        return HttpResponseBadRequest("missing fields")

    v = _vault_of(request.user)
    if v is None:
        return JsonResponse({"error": "not_initialized"}, status=409)
    v.kdf = data["kdf"]
    v.kdf_iterations = data["iterations"]
    v.salt = data["salt"]
    v.wrapped_key = data["wrappedKey"]
    v.wrapped_key_iv = data["wrappedKeyIv"]
    v.save(
        update_fields=[
            "kdf",
            "kdf_iterations",
            "salt",
            "wrapped_key",
            "wrapped_key_iv",
            "updated_at",
        ]
    )
    return JsonResponse({"ok": True})


@login_required
@read_required
@require_POST
def set_recovery(request):
    """Store (or replace) the recovery wrap of the DEK. The browser derives a
    key from the printed recovery string and wraps the DEK with it; the server
    only ever sees opaque base64. Sending empty strings clears recovery."""
    data = _json_body(request)
    if data is None:
        return HttpResponseBadRequest("bad json")
    salt = data.get("salt", "")
    wk = data.get("wrappedKey", "")
    iv = data.get("wrappedKeyIv", "")
    if not (isinstance(salt, str) and isinstance(wk, str) and isinstance(iv, str)):
        return HttpResponseBadRequest("bad fields")
    # A recovery wrap is a wrapped 32-byte key + 16-byte salt + 12-byte IV —
    # a few hundred base64 chars at most. Cap generously; reject anything that
    # could only be an abuse attempt (matches the caps on the other endpoints).
    if len(salt) > 128 or len(wk) > 1024 or len(iv) > 128:
        return HttpResponseBadRequest("too large")
    # all-or-nothing: either a complete wrap or a complete clear
    if any([salt, wk, iv]) and not all([salt, wk, iv]):
        return HttpResponseBadRequest("incomplete")

    v = _vault_of(request.user)
    if v is None:
        return JsonResponse({"error": "not_initialized"}, status=409)
    v.recovery_salt = salt
    v.recovery_wrapped_key = wk
    v.recovery_wrapped_key_iv = iv
    v.save(update_fields=[
        "recovery_salt", "recovery_wrapped_key", "recovery_wrapped_key_iv", "updated_at",
    ])
    return JsonResponse({"ok": True, "hasRecovery": bool(wk)})


@login_required
@write_required
@require_POST
def restore(request):
    """Import: overwrite the whole vault with an encrypted export bundle.
    Unlocked afterwards with whatever master password that export used."""
    data = _json_body(request)
    if data is None:
        return HttpResponseBadRequest("bad json")
    required = ["kdf", "salt", "wrappedKey", "wrappedKeyIv", "ciphertext", "ciphertextIv"]
    if not _valid_strings(data, required) or not isinstance(data.get("iterations"), int):
        return HttpResponseBadRequest("missing fields")
    if len(data["ciphertext"]) > MAX_CIPHERTEXT_CHARS:
        return HttpResponseBadRequest("too large")

    with transaction.atomic():
        v = EncryptedVault.objects.select_for_update().filter(user=request.user).first()
        if v is None:
            v = EncryptedVault(user=request.user)
        v.kdf = data["kdf"]
        v.kdf_iterations = data["iterations"]
        v.salt = data["salt"]
        v.wrapped_key = data["wrappedKey"]
        v.wrapped_key_iv = data["wrappedKeyIv"]
        v.ciphertext = data["ciphertext"]
        v.ciphertext_iv = data["ciphertextIv"]
        # The imported bundle carries a different DEK, so any existing recovery
        # wrap is now stale — clear it and let the user mint a fresh one.
        v.recovery_salt = ""
        v.recovery_wrapped_key = ""
        v.recovery_wrapped_key_iv = ""
        v.revision = (v.revision or 0) + 1
        v.save()
    return JsonResponse({"revision": v.revision})


# ---- Web Push (v1.11) ------------------------------------------------------

MAX_SLOTS = 200  # a week of reminders, generously


@login_required
@write_required
@require_POST
def push_subscribe(request):
    from .models import PushSubscription

    data = _json_body(request)
    if data is None:
        return HttpResponseBadRequest("bad json")
    endpoint = data.get("endpoint", "")
    if not (isinstance(endpoint, str) and endpoint.startswith("https://") and len(endpoint) <= 500):
        return HttpResponseBadRequest("bad endpoint")
    p256dh = data.get("p256dh", "") or ""
    auth = data.get("auth", "") or ""
    if not (isinstance(p256dh, str) and isinstance(auth, str)
            and len(p256dh) <= 200 and len(auth) <= 100):
        return HttpResponseBadRequest("bad keys")
    PushSubscription.objects.update_or_create(
        endpoint=endpoint,
        defaults={"user": request.user, "p256dh": p256dh, "auth": auth},
    )
    return JsonResponse({"ok": True})


@login_required
@write_required
@require_POST
def push_unsubscribe(request):
    from .models import PushSubscription

    data = _json_body(request)
    if data is None:
        return HttpResponseBadRequest("bad json")
    endpoint = data.get("endpoint", "")
    PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
    return JsonResponse({"ok": True})


@login_required
@write_required
@require_POST
def push_slots(request):
    """Replace this user's un-sent future reminder slots with the posted list.
    The list is bare ISO timestamps — the entire (documented) metadata cost of
    zero-knowledge push reminders."""
    from django.utils.dateparse import parse_datetime
    from django.utils import timezone as tz

    from .models import ReminderSlot

    data = _json_body(request)
    if data is None:
        return HttpResponseBadRequest("bad json")
    times = data.get("times")
    if not isinstance(times, list) or len(times) > MAX_SLOTS:
        return HttpResponseBadRequest("bad times")
    now = tz.now()
    horizon = now + timedelta(days=8)
    parsed = []
    for item in times:
        if not isinstance(item, str) or len(item) > 40:
            return HttpResponseBadRequest("bad time")
        dt = parse_datetime(item)
        if dt is None or dt.tzinfo is None:
            return HttpResponseBadRequest("bad time")
        if now <= dt <= horizon:
            parsed.append(dt)

    ReminderSlot.objects.filter(user=request.user, sent=False, fire_at__gte=now).delete()
    ReminderSlot.objects.bulk_create(
        [ReminderSlot(user=request.user, fire_at=dt) for dt in sorted(set(parsed))]
    )
    return JsonResponse({"ok": True, "count": len(set(parsed))})
