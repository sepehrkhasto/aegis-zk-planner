import json

from django import forms
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.contrib.auth import authenticate, login, logout
from django.http import HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_http_methods, require_POST
from django_ratelimit.core import is_ratelimited
from django_ratelimit.decorators import ratelimit

from .forms import LoginForm, RegistrationForm
from .models import PurchaseRequest
from .security import client_ip, clear_failures, is_locked, note_failure

# --------------------------------------------------------------------------- #
# Rate limits (v1.13.1, فاز A مورد ۱). The old caps — register 5/h + 20/d and
# login 10/5m — counted *every* POST, including form-validation retries and
# successful logins, so a user re-typing an invite code hit HTTP 429 within
# minutes (reported three times). New policy:
#   * register: 10/min per IP, plus a 300/day bot backstop no human reaches;
#   * login: only FAILED attempts count (10 failures/min per IP). Successful
#     logins are free. The per-username lockout in security.py stays intact.
# --------------------------------------------------------------------------- #
REGISTER_RATE = "10/m"
REGISTER_RATE_DAILY = "300/d"
LOGIN_FAIL_RATE = "10/m"


def ratelimited(request, exception=None):
    """Rendered when an endpoint is rate-limited (HTTP 429)."""
    return render(request, "errors/429.html", status=429)


def _login_failures_limited(request, increment: bool) -> bool:
    """Per-IP counter that only advances on *failed* logins (فاز A مورد ۱)."""
    return is_ratelimited(
        request,
        group="accounts.login_fail",
        key="ip",
        rate=LOGIN_FAIL_RATE,
        method="POST",
        increment=increment,
    )


@require_http_methods(["GET", "POST"])
@ratelimit(key="ip", rate=REGISTER_RATE, method="POST", block=False)
@ratelimit(key="ip", rate=REGISTER_RATE_DAILY, method="POST", block=False)
def register(request):
    if request.user.is_authenticated:
        return redirect("vault:app")

    if getattr(request, "limited", False):
        return ratelimited(request)

    if request.method == "POST":
        form = RegistrationForm(request.POST)
        if form.is_valid():
            try:
                new_user = form.save(registered_ip=client_ip(request))
            except forms.ValidationError as exc:
                # Lost the race for the last use of an invite code.
                form.add_error("invite_code", exc)
            else:
                # v5.0 — four routes in, each with its own approval rule and
                # its own subscription length. Resolved here, in one place, so
                # the policy is readable rather than scattered.
                from .models import RegistrationEvent, SiteConfig

                cfg = SiteConfig.get_solo()
                invite = form._invite_obj

                if invite is None:
                    route = RegistrationEvent.ROUTE_OPEN
                    days = cfg.open_reg_days
                    auto = not cfg.open_reg_needs_approval
                elif invite.auto_approve_open:
                    # the code carries its own trust
                    route = RegistrationEvent.ROUTE_INVITE_AUTO
                    days = invite.premium_days
                    auto = True
                elif cfg.auto_approve_open:
                    # the global window is running
                    route = RegistrationEvent.ROUTE_WINDOW
                    days = cfg.auto_approve_days
                    auto = True
                else:
                    route = RegistrationEvent.ROUTE_INVITE
                    days = invite.premium_days
                    auto = False

                if auto:
                    new_user.approve(days=days)

                RegistrationEvent.objects.create(
                    user=new_user,
                    username=new_user.username,
                    route=route,
                    invite_code=invite.code if invite else "",
                    auto_approved=auto,
                    premium_days=days if auto else 0,
                    registered_ip=client_ip(request),
                )

                if auto:
                    messages.success(
                        request,
                        "ثبت‌نام انجام شد و حسابت فعال است. حالا می‌توانی وارد شوی.",
                    )
                    return redirect("accounts:login")
                messages.success(
                    request,
                    "ثبت‌نام انجام شد. حساب شما پس از تایید ادمین فعال می‌شود.",
                )
                return redirect("accounts:pending")
    else:
        form = RegistrationForm()

    return render(request, "accounts/register.html", {"form": form})


@require_http_methods(["GET", "POST"])
def login_view(request):
    if request.user.is_authenticated:
        return redirect("vault:app")

    form = LoginForm(request.POST or None)
    if request.method == "POST" and _login_failures_limited(request, increment=False):
        return ratelimited(request)
    if request.method == "POST" and form.is_valid():
        username = form.cleaned_data["username"].strip()
        password = form.cleaned_data["password"]
        ip = client_ip(request)

        if is_locked(username, ip):
            messages.error(
                request,
                "به دلیل تلاش‌های ناموفق زیاد، ورود این حساب موقتاً قفل شده است. "
                "کمی بعد دوباره تلاش کنید.",
            )
            return render(request, "accounts/login.html", {"form": form}, status=429)

        user = authenticate(request, username=username, password=password)

        if user is None:
            _login_failures_limited(request, increment=True)  # only failures count
            note_failure(username, ip)
            messages.error(request, "نام کاربری یا رمز ورود اشتباه است.")
        elif not user.is_approved:
            messages.warning(
                request,
                "حساب شما هنوز توسط ادمین تایید نشده است.",
            )
            return redirect("accounts:pending")
        elif not user.can_open_app:
            # v4.8 (فاز F): only a *hard* block lands here now — the admin
            # kill-switch (is_premium off) or an unapproved/disabled account. A
            # naturally expired subscription passes this gate and opens the vault
            # in read-only mode instead (enforced in vault.views).
            messages.error(
                request,
                "دسترسی این حساب فعال نیست. برای فعال‌سازی دوباره، با مدیر تماس بگیرید. "
                "داده‌های شما رمزنگاری‌شده و دست‌نخورده باقی می‌ماند.",
            )
            return render(request, "accounts/login.html", {"form": form}, status=403)
        else:
            clear_failures(username, ip)
            login(request, user)
            next_url = request.GET.get("next")
            if next_url and url_has_allowed_host_and_scheme(
                next_url, allowed_hosts={request.get_host()},
                require_https=request.is_secure(),
            ):
                return redirect(next_url)
            return redirect("vault:app")

    return render(request, "accounts/login.html", {"form": form})


@require_http_methods(["POST"])
def logout_view(request):
    logout(request)
    messages.info(request, "از حساب خارج شدید.")
    return redirect("accounts:login")


@ratelimit(key="ip", rate="10/h", method="POST", block=False)
@require_http_methods(["POST"])
def submit_feedback(request):
    """Anonymous feedback. Not tied to the user — we store only category, text
    and an optional rating. Rate-limited to curb spam."""
    from .models import Feedback

    if getattr(request, "limited", False):
        return JsonResponse({"error": "rate"}, status=429)
    import json as _json
    try:
        data = _json.loads(request.body.decode("utf-8"))
    except Exception:
        return JsonResponse({"error": "bad"}, status=400)
    msg = (data.get("message") or "").strip()
    if not msg or len(msg) > 4000:
        return JsonResponse({"error": "empty"}, status=400)
    cat = data.get("category") or "suggestion"
    valid = {c[0] for c in Feedback.CATEGORY_CHOICES}
    if cat not in valid:
        cat = "other"
    rating = data.get("rating")
    try:
        rating = int(rating)
        if rating < 1 or rating > 5:
            rating = None
    except (TypeError, ValueError):
        rating = None
    Feedback.objects.create(category=cat, message=msg, rating=rating)
    return JsonResponse({"ok": True})


@require_http_methods(["GET"])
def broadcasts(request):
    """Active global announcements for the notification center. Requires login
    so anonymous visitors don't see internal notices."""
    if not request.user.is_authenticated:
        return JsonResponse({"items": []})
    from .models import Broadcast

    items = [
        {
            "id": b.id,
            "title": b.title,
            "body": b.body,
            "level": b.level,
            "at": b.created_at.isoformat(),
        }
        for b in Broadcast.objects.filter(is_active=True)[:30]
    ]
    return JsonResponse({"items": items})


def pending(request):
    return render(request, "accounts/pending.html")


@require_http_methods(["POST"])
def delete_account(request):
    """Permanently delete the signed-in user's account and all its (encrypted)
    data. Requires the user to be authenticated and to re-type their username
    as confirmation. This is irreversible."""
    if not request.user.is_authenticated:
        return redirect("accounts:login")
    confirm = (request.POST.get("confirm_username") or "").strip()
    if confirm != request.user.username:
        messages.error(request, "برای حذف حساب، نام کاربری‌ات را دقیق وارد کن.")
        return redirect("vault:app")
    user = request.user
    logout(request)
    # deleting the user cascades to the OneToOne EncryptedVault
    user.delete()
    messages.info(request, "حساب و تمام داده‌های شما برای همیشه حذف شد.")
    return redirect("core:landing")


@login_required
@require_http_methods(["POST"])
def profile_update(request):
    """v1.15 (فاز E مورد ۳۱): optional server-side name/email.

    These two fields are plain account metadata for contact/support — they sit
    on the User row on purpose and never touch the zero-knowledge vault."""
    try:
        data = json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"error": "bad_json"}, status=400)
    name = str(data.get("name") or "").strip()[:60]
    email = str(data.get("email") or "").strip()[:254]
    if email:
        try:
            validate_email(email)
        except ValidationError:
            return JsonResponse({"error": "bad_email"}, status=400)
    request.user.first_name = name
    request.user.email = email
    request.user.save(update_fields=["first_name", "email"])
    return JsonResponse({"ok": True})


PURCHASE_RATE = "6/h"


@require_http_methods(["POST"])
@ratelimit(key="ip", rate=PURCHASE_RATE, method="POST", block=False)
def purchase_request(request):
    """v1.18 (فاز H مورد ۴۴): public subscription enquiry form.

    Rate-limited per IP because it is unauthenticated. Stores only what the
    person typed; nothing else about them is recorded."""
    if getattr(request, "limited", False):
        return ratelimited(request)
    name = (request.POST.get("name") or "").strip()[:80]
    phone = (request.POST.get("phone") or "").strip()[:30]
    email = (request.POST.get("email") or "").strip()[:254]
    note = (request.POST.get("note") or "").strip()[:300]
    if not name or not phone:
        messages.error(request, "نام و شماره تماس لازم است.")
        return redirect(reverse("core:landing") + "#buy")
    if email:
        try:
            validate_email(email)
        except ValidationError:
            messages.error(request, "ایمیل معتبر نیست.")
            return redirect(reverse("core:landing") + "#buy")
    PurchaseRequest.objects.create(name=name, phone=phone, email=email, note=note)
    messages.success(
        request,
        "درخواستت ثبت شد. برای ادامه‌ی خرید، در تلگرام پیام بده.",
    )
    return redirect(reverse("core:landing") + "#buy")


@login_required
def subscribe(request):
    """v4.9 — the subscription page.

    Deliberately reachable while an account is in read-only mode (فاز F): the
    one thing an expired user must always be able to do is renew. It is a
    plain server-rendered page — it never touches the vault, so nothing here
    weakens the zero-knowledge boundary.
    """
    from .models import SiteConfig
    cfg = SiteConfig.get_solo()
    u = request.user
    return render(request, "accounts/subscribe.html", {
        "plans": cfg.plans(),
        "telegram_id": cfg.telegram_id,
        "telegram_url": ("https://t.me/" + cfg.telegram_id.lstrip("@")) if cfg.telegram_id else "",
        "gateway_enabled": cfg.gateway_enabled,
        "premium_active": u.premium_active,
        "read_only": getattr(u, "read_only_access", False),
        "premium_until": u.premium_until,
    })


@login_required
@require_POST
def purchase_intent(request):
    """v5.0 — record that someone reached for a plan.

    Fired when the Telegram button on the subscription page is used. It closes
    a real gap: until now that click left no trace, so "how many wanted to buy,
    and which plan?" was unanswerable.

    It records the reach, not a sale — the account, the plan, the price at that
    moment. Nothing about the vault, no page analytics. It answers with 204 so
    the click proceeds to Telegram whether or not this succeeds; a failed
    metric must never block a purchase.
    """
    from .models import PurchaseIntent, SiteConfig

    plan = (request.POST.get("plan") or "").strip()[:8]
    valid = {p["key"]: p["price"] for p in SiteConfig.get_solo().plans()}
    if plan in valid:
        PurchaseIntent.objects.create(
            user=request.user,
            username=request.user.username,
            plan=plan,
            price=valid[plan],
        )
    return HttpResponse(status=204)
