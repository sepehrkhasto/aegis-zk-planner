"""
Custom admin panel (/panel/) — staff only.

Deliberately limited to ACCOUNT management: approving users, invite codes,
high-level stats. It has no way to read vault contents; those are ciphertext.
"""

from datetime import timedelta

from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import user_passes_test
from django.db.models import Sum
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_POST

from .models import (PremiumLog, PurchaseIntent, PurchaseRequest,
                     RegistrationEvent, SiteConfig)

from vault.models import EncryptedVault

from .models import InviteCode

User = get_user_model()


def _safe_next(request, fallback="panel:users"):
    """Return the POSTed `next` only if it points back at this same site,
    otherwise the named fallback. Blocks open-redirect via `next`."""
    nxt = request.POST.get("next")
    if nxt and url_has_allowed_host_and_scheme(
        nxt, allowed_hosts={request.get_host()}, require_https=request.is_secure()
    ):
        return nxt
    return reverse(fallback)

staff_required = user_passes_test(
    lambda u: u.is_active and u.is_staff, login_url="accounts:login"
)


@staff_required
def home(request):
    users = User.objects.all()
    pending = users.filter(is_approved=False, is_active=True).order_by("-date_joined")
    now = timezone.now()
    active_7 = users.filter(last_seen__gte=now - timedelta(days=7)).count()
    active_30 = users.filter(last_seen__gte=now - timedelta(days=30)).count()
    cfg = SiteConfig.get_solo()

    # v5.0 — the dashboard leads with what needs a decision, not with numbers.
    # An open registration window is the item that matters most here: it is the
    # widest door the product has, and the real risk is forgetting it is open.
    attention = []
    if pending.count():
        attention.append({
            "kind": "pending", "level": "warn",
            "count": pending.count(),
            "url": reverse("panel:users"),
        })
    if cfg.open_reg_open:
        attention.append({
            "kind": "open_reg", "level": "alert",
            "until": cfg.open_reg_until,
            "left": cfg.open_reg_left,
            "used": cfg.open_reg_count,
            "max": cfg.open_reg_max,
        })
    if cfg.auto_approve_open:
        attention.append({
            "kind": "auto_window", "level": "warn",
            "until": cfg.auto_approve_until,
        })

    ctx = {
        "total_users": users.count(),
        "approved_users": users.filter(is_approved=True).count(),
        "pending_users": pending.count(),
        "vault_count": EncryptedVault.objects.count(),
        "active_invites": sum(1 for i in InviteCode.objects.all() if i.is_usable),
        "active_7": active_7,
        "active_30": active_30,
        # registration control surfaces
        "attention": attention,
        "auto_approve_open": cfg.auto_approve_open,
        "auto_approve_until": cfg.auto_approve_until,
        "auto_approve_days": cfg.auto_approve_days,
        "open_reg_open": cfg.open_reg_open,
        "open_reg_until": cfg.open_reg_until,
        "open_reg_days": cfg.open_reg_days,
        "open_reg_max": cfg.open_reg_max,
        "open_reg_count": cfg.open_reg_count,
        "open_reg_left": cfg.open_reg_left,
        "open_reg_needs_approval": cfg.open_reg_needs_approval,
        # v1.10 premium overview
        "premium_active": sum(1 for u in users if u.premium_active),
        "expiring_week": sorted(
            (u for u in users
             if u.premium_active and u.premium_days_left is not None and u.premium_days_left <= 7),
            key=lambda u: u.premium_days_left,
        )[:10],
        "pending_list": pending[:10],
        "recent_users": users.order_by("-date_joined")[:8],
        "nav": "home",
    }
    return render(request, "panel/home.html", ctx)


@staff_required
def users(request):
    qs = User.objects.order_by("-date_joined")
    q = (request.GET.get("q") or "").strip()
    if q:
        qs = qs.filter(username__icontains=q)
    ctx = {"users": qs, "q": q, "nav": "users"}
    return render(request, "panel/users.html", ctx)


@staff_required
@require_POST
def user_approve(request, pk):
    u = get_object_or_404(User, pk=pk)
    u.approve()
    messages.success(request, f"کاربر «{u.username}» تایید شد.")
    return redirect(_safe_next(request))


def _apply_premium_change(request, u, delta, reason):
    """Apply a +/- day change and record it in the audit log (v1.10)."""
    if u.is_staff or u.is_superuser:
        # ادمین/سوپریوزر بدون تاریخ انقضاست؛ روز دادن یا گرفتن برایش بی‌معناست
        # و نباید اشتراکش را ۳۰روزه کند (v1.13.1، فاز A مورد ۴).
        messages.info(
            request,
            f"«{u.username}» ادمین است و اشتراکش بدون تاریخ انقضاست — تغییری اعمال نشد.",
        )
        return
    u.adjust_premium(delta)
    PremiumLog.objects.create(
        user=u, admin=request.user, delta_days=delta,
        reason=reason[:200], until_after=u.premium_until,
    )
    sign = "+" if delta >= 0 else ""
    messages.success(
        request,
        f"اشتراک {u.username}: {sign}{delta} روز — اعتبار تا {u.premium_until or 'نامحدود'}.",
    )


@staff_required
@require_POST
def user_extend_premium(request, pk):
    """Quick +30 days (kept for the one-tap button; goes through the log)."""
    u = get_object_or_404(User, pk=pk)
    _apply_premium_change(request, u, 30, "تمدید سریع ۳۰ روزه")
    return redirect(_safe_next(request))


@staff_required
@require_POST
def user_premium_adjust(request, pk):
    """Arbitrary +/- days with a reason — the real premium management (v1.10).
    Bounded to ±3650 so a typo can't hand out a century of premium."""
    u = get_object_or_404(User, pk=pk)
    try:
        delta = int(request.POST.get("days", ""))
    except (TypeError, ValueError):
        messages.error(request, "تعداد روز نامعتبر است.")
        return redirect(_safe_next(request))
    if delta == 0 or abs(delta) > 3650:
        messages.error(request, "تعداد روز باید بین ‎-3650 و 3650 و غیر صفر باشد.")
        return redirect(_safe_next(request))
    reason = (request.POST.get("reason") or "").strip()
    _apply_premium_change(request, u, delta, reason)
    return redirect(_safe_next(request))


@staff_required
def user_premium_log(request, pk):
    """Per-user premium audit trail (v1.10)."""
    u = get_object_or_404(User, pk=pk)
    logs = u.premium_logs.select_related("admin")[:200]
    return render(request, "panel/premium_log.html", {"u": u, "logs": logs, "nav": "users"})


@staff_required
@require_POST
def user_toggle_active(request, pk):
    u = get_object_or_404(User, pk=pk)
    if u == request.user:
        messages.error(request, "نمی‌توانی حساب خودت را غیرفعال کنی.")
    elif u.is_superuser and not request.user.is_superuser:
        messages.error(request, "فقط سوپر‌ادمین می‌تواند سوپر‌ادمین را تغییر دهد.")
    else:
        u.is_active = not u.is_active
        u.save(update_fields=["is_active"])
        state = "فعال" if u.is_active else "غیرفعال"
        messages.success(request, f"حساب «{u.username}» {state} شد.")
    return redirect(_safe_next(request))


@staff_required
@require_POST
def auto_approve_set(request):
    """v4.8 (فاز E): open or close the auto-registration window.

    `hours` > 0 opens the window for that many hours from now; `hours` == 0
    closes it immediately. Bounded to 30 days so a typo can't leave the door
    open forever."""
    try:
        hours = int(request.POST.get("hours", ""))
    except (TypeError, ValueError):
        messages.error(request, "مدت نامعتبر است.")
        return redirect("panel:home")
    if hours < 0 or hours > 720:
        messages.error(request, "مدت باید بین ۰ تا ۷۲۰ ساعت باشد.")
        return redirect("panel:home")
    cfg = SiteConfig.get_solo()
    if hours == 0:
        cfg.auto_approve_until = None
        messages.success(request, "پنجره‌ی ثبت‌نام خودکار بسته شد.")
    else:
        cfg.auto_approve_until = timezone.now() + timedelta(hours=hours)
        messages.success(
            request,
            f"ثبت‌نام خودکار برای {hours} ساعت باز شد "
            f"(تا {cfg.auto_approve_until:%Y-%m-%d %H:%M}).",
        )
    cfg.updated_by = request.user
    cfg.save()
    return redirect("panel:home")


@staff_required
def invites(request):
    if request.method == "POST":
        label = (request.POST.get("label") or "").strip()[:120]
        try:
            max_uses = max(1, min(50, int(request.POST.get("max_uses") or 1)))
        except ValueError:
            max_uses = 1
        try:
            days = int(request.POST.get("days") or 0)
        except ValueError:
            days = 0
        expires_at = timezone.now() + timedelta(days=days) if days > 0 else None
        inv = InviteCode.objects.create(
            label=label, max_uses=max_uses, expires_at=expires_at,
            created_by=request.user,
        )
        messages.success(request, f"کد دعوت ساخته شد: {inv.code}")
        return redirect("panel:invites")
    ctx = {"invites": InviteCode.objects.all(), "nav": "invites"}
    return render(request, "panel/invites.html", ctx)


@staff_required
@require_POST
def invite_toggle(request, pk):
    inv = get_object_or_404(InviteCode, pk=pk)
    inv.is_active = not inv.is_active
    inv.save(update_fields=["is_active"])
    messages.success(request, "وضعیت کد دعوت تغییر کرد.")
    return redirect("panel:invites")


@staff_required
def feedback(request):
    from .models import Feedback

    items = Feedback.objects.all()[:200]
    unread = Feedback.objects.filter(is_read=False).count()
    # mark everything read when viewed
    Feedback.objects.filter(is_read=False).update(is_read=True)
    ctx = {"items": items, "unread": unread, "total": Feedback.objects.count(), "nav": "feedback"}
    return render(request, "panel/feedback.html", ctx)


@staff_required
@require_POST
def feedback_delete(request, pk):
    from .models import Feedback

    Feedback.objects.filter(pk=pk).delete()
    return redirect("panel:feedback")


@staff_required
def broadcasts(request):
    from .models import Broadcast

    if request.method == "POST":
        title = (request.POST.get("title") or "").strip()
        body = (request.POST.get("body") or "").strip()
        level = request.POST.get("level") or "info"
        if level not in {"info", "success", "warning"}:
            level = "info"
        if title:
            Broadcast.objects.create(title=title[:160], body=body[:2000], level=level)
            messages.success(request, "اعلان سراسری ارسال شد.")
        return redirect("panel:broadcasts")
    ctx = {"items": Broadcast.objects.all()[:100], "nav": "broadcasts"}
    return render(request, "panel/broadcasts.html", ctx)


@staff_required
@require_POST
def broadcast_toggle(request, pk):
    from .models import Broadcast

    b = get_object_or_404(Broadcast, pk=pk)
    b.is_active = not b.is_active
    b.save(update_fields=["is_active"])
    return redirect("panel:broadcasts")


@staff_required
@require_POST
def broadcast_delete(request, pk):
    from .models import Broadcast

    Broadcast.objects.filter(pk=pk).delete()
    return redirect("panel:broadcasts")


# --------------------------------------------------------------------------- #
# v1.18 (فاز H مورد ۴۴) — subscription purchase requests
# --------------------------------------------------------------------------- #

@staff_required
def purchases(request):
    return render(request, "panel/purchases.html", {
        "nav": "purchases",
        "rows": PurchaseRequest.objects.all(),
        "pending": PurchaseRequest.objects.filter(handled=False).count(),
    })


@staff_required
@require_POST
def purchase_toggle(request, pk):
    pr = get_object_or_404(PurchaseRequest, pk=pk)
    pr.handled = not pr.handled
    pr.save(update_fields=["handled"])
    messages.success(request, "وضعیت به‌روزرسانی شد.")
    return redirect("panel:purchases")


@staff_required
@require_POST
def purchase_delete(request, pk):
    get_object_or_404(PurchaseRequest, pk=pk).delete()
    messages.success(request, "درخواست حذف شد.")
    return redirect("panel:purchases")


@staff_required
@require_POST
def open_reg_set(request):
    """v5.0 — open the registration window that needs no invite code.

    This is the widest door the product has, so it is bounded harder than the
    auto-approve window: 24 hours instead of 720, and an explicit account cap
    that closes it automatically. Opening also resets the counter, so each
    window gets its own fresh allowance rather than inheriting a spent one.
    """
    def _int(name, default=0):
        try:
            return int(request.POST.get(name, default))
        except (TypeError, ValueError):
            return None

    hours = _int("hours")
    if hours is None or hours < 0 or hours > 24:
        messages.error(request, "مدت باید بین ۰ تا ۲۴ ساعت باشد.")
        return redirect("panel:home")

    cfg = SiteConfig.get_solo()
    if hours == 0:
        cfg.open_reg_until = None
        messages.success(request, "ثبت‌نام بدون کد دعوت بسته شد.")
    else:
        days = _int("days", cfg.open_reg_days)
        cap = _int("max", cfg.open_reg_max)
        if days is None or not (1 <= days <= 3650):
            messages.error(request, "روزهای اشتراک نامعتبر است.")
            return redirect("panel:home")
        if cap is None or not (1 <= cap <= 10000):
            messages.error(request, "سقف تعداد نامعتبر است.")
            return redirect("panel:home")
        cfg.open_reg_until = timezone.now() + timedelta(hours=hours)
        cfg.open_reg_days = days
        cfg.open_reg_max = cap
        cfg.open_reg_count = 0          # a new window gets a fresh allowance
        cfg.open_reg_needs_approval = bool(request.POST.get("needs_approval"))
        messages.success(
            request,
            f"ثبت‌نام بدون کد دعوت برای {hours} ساعت باز شد "
            f"(سقف {cap} حساب، {days} روز اشتراک).",
        )
    cfg.updated_by = request.user
    cfg.save()
    return redirect("panel:home")


@staff_required
@require_POST
def auto_approve_days_set(request):
    """v5.0 — how many days the global auto-approve window grants."""
    try:
        days = int(request.POST.get("days", ""))
    except (TypeError, ValueError):
        days = -1
    if not (1 <= days <= 3650):
        messages.error(request, "روزهای اشتراک باید بین ۱ تا ۳۶۵۰ باشد.")
        return redirect("panel:home")
    cfg = SiteConfig.get_solo()
    cfg.auto_approve_days = days
    cfg.updated_by = request.user
    cfg.save()
    messages.success(request, f"روزهای اشتراک پنجره‌ی تایید خودکار روی {days} تنظیم شد.")
    return redirect("panel:home")


@staff_required
def reports(request):
    """v5.0 — the two questions the panel could not answer before:
    who arrived and how, and who reached for a plan."""
    now = timezone.now()
    events = RegistrationEvent.objects.select_related("user")[:100]
    intents = PurchaseIntent.objects.select_related("user")[:100]

    # sign-ups per route, last 30 days
    since = now - timedelta(days=30)
    by_route = {}
    for key, label in RegistrationEvent.ROUTES:
        by_route[key] = {
            "label": label,
            "count": RegistrationEvent.objects.filter(
                route=key, created_at__gte=since).count(),
        }

    # which plans people reached for
    by_plan = {}
    for i in PurchaseIntent.objects.filter(created_at__gte=since):
        row = by_plan.setdefault(i.plan, {"plan": i.plan, "count": 0, "value": 0})
        row["count"] += 1
        row["value"] += i.price

    # recent logins, newest first — `last_seen` is the only activity stamp we
    # keep, and it is deliberately coarse (hourly), so this is "recently seen"
    # rather than a login log. Saying so beats implying a precision we don't have.
    recent_seen = (User.objects.filter(last_seen__isnull=False)
                   .order_by("-last_seen")[:40])

    return render(request, "panel/reports.html", {
        "nav": "reports",
        "events": events,
        "intents": intents,
        "by_route": by_route.values(),
        "by_plan": sorted(by_plan.values(), key=lambda r: -r["count"]),
        "recent_seen": recent_seen,
        "intent_total": PurchaseIntent.objects.filter(created_at__gte=since).count(),
        "signup_total": RegistrationEvent.objects.filter(created_at__gte=since).count(),
    })


# --------------------------------------------------------------------------- #
# v5.2 — encrypted backup
# --------------------------------------------------------------------------- #
@staff_required
def backup_page(request):
    """The backup console. Superuser only — this is the one screen that can
    hand over every account in the system, or replace them all."""
    if not request.user.is_superuser:
        messages.error(request, "فقط سوپریوزر به بخش پشتیبان دسترسی دارد.")
        return redirect("panel:home")
    from .backup import BACKUP_MODELS, MIN_PASSPHRASE
    from django.apps import apps as dj_apps

    counts = []
    for label in BACKUP_MODELS:
        try:
            counts.append((label, dj_apps.get_model(label).objects.count()))
        except LookupError:
            continue
    from .backup import list_snapshots
    return render(request, "panel/backup.html", {
        "nav": "backup",
        "counts": counts,
        "total": sum(c for _, c in counts),
        "min_pass": MIN_PASSPHRASE,
        "snapshots": list_snapshots(),
    })


@staff_required
@require_POST
def backup_export(request):
    """Stream an encrypted bundle. Re-authenticates first: possessing a live
    session is not the same as being at the keyboard, and this is the single
    highest-value action in the product."""
    if not request.user.is_superuser:
        return redirect("panel:home")
    from django.contrib.auth import authenticate
    from django.http import HttpResponse
    from .backup import BackupError, export_bundle, suggested_filename

    if authenticate(request,
                    username=request.user.username,
                    password=request.POST.get("login_password", "")) is None:
        messages.error(request, "رمز ورود اشتباه است.")
        return redirect("panel:backup")

    passphrase = request.POST.get("passphrase", "")
    if passphrase != request.POST.get("passphrase2", ""):
        messages.error(request, "دو عبارت عبور یکسان نیستند.")
        return redirect("panel:backup")

    try:
        blob = export_bundle(passphrase)
    except BackupError as exc:
        messages.error(request, str(exc))
        return redirect("panel:backup")

    resp = HttpResponse(blob, content_type="application/octet-stream")
    resp["Content-Disposition"] = f'attachment; filename="{suggested_filename()}"'
    resp["Content-Length"] = str(len(blob))
    # A backup must never sit in a cache, a proxy, or the browser's history.
    resp["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
    return resp


@staff_required
@require_POST
def backup_import(request):
    """Restore from a bundle.

    Two safety rails, because this is the only action in the product that can
    destroy everything at once: the operator must type the confirmation phrase,
    and a snapshot of the CURRENT database is taken first — encrypted with the
    same passphrase — so a restore that turns out to be the wrong file is
    itself reversible.
    """
    if not request.user.is_superuser:
        return redirect("panel:home")
    from django.contrib.auth import authenticate
    from .backup import (BackupError, decrypt_bundle, export_bundle,
                         restore_payload, save_snapshot)

    if authenticate(request,
                    username=request.user.username,
                    password=request.POST.get("login_password", "")) is None:
        messages.error(request, "رمز ورود اشتباه است.")
        return redirect("panel:backup")

    if request.POST.get("confirm", "").strip() != "RESTORE":
        messages.error(request, "برای بازگردانی باید عبارت RESTORE را دقیقاً وارد کنی.")
        return redirect("panel:backup")

    upload = request.FILES.get("bundle")
    if upload is None:
        messages.error(request, "فایل پشتیبان انتخاب نشده.")
        return redirect("panel:backup")
    if upload.size > 200 * 1024 * 1024:
        messages.error(request, "فایل بیش از حد بزرگ است.")
        return redirect("panel:backup")

    passphrase = request.POST.get("passphrase", "")
    try:
        payload = decrypt_bundle(upload.read(), passphrase)
    except BackupError as exc:
        messages.error(request, str(exc))
        return redirect("panel:backup")

    # Take the safety snapshot BEFORE touching anything, and WRITE IT DOWN.
    # A snapshot that is generated and discarded is not a safety net; the whole
    # point is that a restore of the wrong file stays reversible. It is stored
    # encrypted with the same passphrase, so the file on disk is no more
    # sensitive than the bundle the operator is already holding.
    try:
        snapshot = export_bundle(passphrase)
        snap_path = save_snapshot(snapshot)
    except BackupError as exc:
        messages.error(request, f"اسنپ‌شات ایمنی ساخته نشد، بازگردانی انجام نشد: {exc}")
        return redirect("panel:backup")
    except OSError as exc:
        messages.error(request, f"اسنپ‌شات ایمنی ذخیره نشد، بازگردانی انجام نشد: {exc}")
        return redirect("panel:backup")

    try:
        restored = restore_payload(payload)
    except Exception as exc:                      # noqa: BLE001 — reported to operator
        messages.error(request, f"بازگردانی ناموفق بود و چیزی تغییر نکرد: {exc}")
        return redirect("panel:backup")

    total = sum(restored.values())
    messages.success(
        request,
        f"بازگردانی انجام شد: {total} رکورد از {len(restored)} جدول. "
        f"اسنپ‌شات پیش از بازگردانی با نام «{snap_path.name}» ذخیره شد و از "
        f"همین صفحه قابل دانلود است."
    )
    return redirect("panel:backup")


@staff_required
def snapshot_download(request, name):
    """Hand back a pre-restore snapshot.

    The filename is validated against the directory listing rather than being
    joined into a path: accepting a name from the URL and building a path from
    it is how directory traversal happens, and this view is superuser-only
    precisely because it hands over the whole database.
    """
    if not request.user.is_superuser:
        return redirect("panel:home")
    from django.http import Http404, FileResponse
    from .backup import list_snapshots, snapshot_dir

    if name not in {s["name"] for s in list_snapshots()}:
        raise Http404
    path = snapshot_dir() / name
    resp = FileResponse(open(path, "rb"), content_type="application/octet-stream")
    resp["Content-Disposition"] = f'attachment; filename="{name}"'
    resp["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
    return resp
