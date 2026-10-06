from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import InviteCode, PremiumLog, PurchaseRequest

User = get_user_model()


@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class RegistrationTests(TestCase):
    def _register(self, code, username="ali", pw="a-very-long-pass-123"):
        return self.client.post(reverse("accounts:register"), {
            "username": username,
            "password1": pw,
            "password2": pw,
            "invite_code": code,
        })

    def test_register_requires_valid_invite(self):
        r = self._register("nope")
        self.assertContains(r, "کد دعوت نامعتبر", status_code=200)
        self.assertFalse(User.objects.filter(username="ali").exists())

    def test_register_with_invite_creates_unapproved_user(self):
        inv = InviteCode.objects.create()
        r = self._register(inv.code)
        self.assertRedirects(r, reverse("accounts:pending"))
        u = User.objects.get(username="ali")
        self.assertFalse(u.is_approved)
        inv.refresh_from_db()
        self.assertEqual(inv.used_count, 1)

    def test_exhausted_invite_rejected(self):
        inv = InviteCode.objects.create(max_uses=1)
        self._register(inv.code, username="one")
        r = self._register(inv.code, username="two")
        self.assertContains(r, "منقضی", status_code=200)
        self.assertFalse(User.objects.filter(username="two").exists())


@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class LoginTests(TestCase):
    def setUp(self):
        # v1.13.1: lockout counters live in the cache, which DB transactions
        # don't roll back — without this, failures leak between tests.
        cache.clear()
        self.user = User.objects.create_user("sara", password="long-pass-abc-999")

    def _login(self, pw, ip=None):
        kwargs = {"REMOTE_ADDR": ip} if ip else {}
        return self.client.post(reverse("accounts:login"),
                                {"username": "sara", "password": pw}, **kwargs)

    def test_unapproved_user_cannot_login(self):
        r = self._login("long-pass-abc-999")
        self.assertRedirects(r, reverse("accounts:pending"))
        self.assertFalse(r.wsgi_request.user.is_authenticated)

    def test_approved_user_logs_in(self):
        self.user.approve()
        r = self._login("long-pass-abc-999")
        self.assertRedirects(r, reverse("vault:app"))

    def test_lockout_after_failures(self):
        self.user.approve()
        for _ in range(5):
            self._login("wrong-password!!")
        r = self._login("long-pass-abc-999")  # correct, but locked now
        self.assertEqual(r.status_code, 429)

    def test_lockout_is_scoped_to_ip(self):
        # An attacker hammering from one IP must not lock the victim out
        # everywhere: a different IP keeps its own clean counter.
        self.user.approve()
        for _ in range(5):
            self._login("wrong-password!!", ip="10.0.0.9")
        # same attacker IP is now locked
        self.assertEqual(
            self._login("long-pass-abc-999", ip="10.0.0.9").status_code, 429)
        # victim's own IP is unaffected → can log in
        r = self._login("long-pass-abc-999", ip="10.0.0.250")
        self.assertRedirects(r, reverse("vault:app"))


@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class PanelTests(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user(
            "boss", password="long-pass-abc-999", is_staff=True, is_approved=True)
        self.normal = User.objects.create_user(
            "member", password="long-pass-abc-999", is_approved=True)

    def test_panel_requires_staff(self):
        self.client.force_login(self.normal)
        r = self.client.get(reverse("panel:home"))
        self.assertEqual(r.status_code, 302)  # bounced to login

    def test_panel_anonymous_redirected(self):
        r = self.client.get(reverse("panel:home"))
        self.assertEqual(r.status_code, 302)

    def test_staff_sees_dashboard(self):
        self.client.force_login(self.staff)
        r = self.client.get(reverse("panel:home"))
        self.assertContains(r, "پنل مدیریت")

    def test_approve_action(self):
        pending = User.objects.create_user("newbie", password="long-pass-xyz-111")
        self.client.force_login(self.staff)
        self.client.post(reverse("panel:user_approve", args=[pending.pk]))
        pending.refresh_from_db()
        self.assertTrue(pending.is_approved)

    def test_cannot_deactivate_self(self):
        self.client.force_login(self.staff)
        self.client.post(reverse("panel:user_toggle", args=[self.staff.pk]))
        self.staff.refresh_from_db()
        self.assertTrue(self.staff.is_active)

    def test_toggle_other_user(self):
        self.client.force_login(self.staff)
        self.client.post(reverse("panel:user_toggle", args=[self.normal.pk]))
        self.normal.refresh_from_db()
        self.assertFalse(self.normal.is_active)

    def test_create_invite(self):
        self.client.force_login(self.staff)
        r = self.client.post(reverse("panel:invites"),
                             {"label": "برای علی", "max_uses": "3", "days": "7"})
        self.assertRedirects(r, reverse("panel:invites"))
        inv = InviteCode.objects.get(label="برای علی")
        self.assertEqual(inv.max_uses, 3)
        self.assertIsNotNone(inv.expires_at)
        self.assertEqual(inv.created_by, self.staff)

    def test_invite_toggle(self):
        inv = InviteCode.objects.create()
        self.client.force_login(self.staff)
        self.client.post(reverse("panel:invite_toggle", args=[inv.pk]))
        inv.refresh_from_db()
        self.assertFalse(inv.is_active)


@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class RedirectSafetyTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            "safe", password="long-pass-abc-999", is_approved=True)

    def test_login_ignores_external_next(self):
        r = self.client.post(
            reverse("accounts:login") + "?next=//evil.com",
            {"username": "safe", "password": "long-pass-abc-999"})
        # must land on the app, never on the external host
        self.assertRedirects(r, reverse("vault:app"))

    def test_login_ignores_protocol_relative(self):
        r = self.client.post(
            reverse("accounts:login") + "?next=https://evil.com/x",
            {"username": "safe", "password": "long-pass-abc-999"})
        self.assertRedirects(r, reverse("vault:app"))

    def test_login_allows_internal_next(self):
        r = self.client.post(
            reverse("accounts:login") + "?next=/app/",
            {"username": "safe", "password": "long-pass-abc-999"})
        self.assertRedirects(r, "/app/")


@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class PanelRedirectTests(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user(
            "boss2", password="long-pass-abc-999", is_staff=True, is_approved=True)
        self.target = User.objects.create_user("newbie2", password="long-pass-xyz-111")
        self.client.force_login(self.staff)

    def test_approve_ignores_external_next(self):
        r = self.client.post(
            reverse("panel:user_approve", args=[self.target.pk]),
            {"next": "//evil.com"})
        # falls back to the users page, never the external host
        self.assertRedirects(r, reverse("panel:users"))

    def test_approve_allows_internal_next(self):
        r = self.client.post(
            reverse("panel:user_approve", args=[self.target.pk]),
            {"next": reverse("panel:home")})
        self.assertRedirects(r, reverse("panel:home"))


@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class InviteConsumeTests(TestCase):
    def test_single_use_invite_consumed_once(self):
        inv = InviteCode.objects.create(max_uses=1)
        pw = "long-pass-abc-999"
        r1 = self.client.post(reverse("accounts:register"), {
            "username": "first", "password1": pw, "password2": pw,
            "invite_code": inv.code,
        })
        self.assertRedirects(r1, reverse("accounts:pending"))
        # second attempt with the now-exhausted code must fail
        r2 = self.client.post(reverse("accounts:register"), {
            "username": "second", "password1": pw, "password2": pw,
            "invite_code": inv.code,
        })
        self.assertEqual(r2.status_code, 200)
        self.assertFalse(User.objects.filter(username="second").exists())
        inv.refresh_from_db()
        self.assertEqual(inv.used_count, 1)


@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class PremiumGateTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            "prem", password="long-pass-abc-999", is_approved=True)

    def test_inactive_premium_blocks_login(self):
        self.user.is_premium = False
        self.user.save(update_fields=["is_premium"])
        r = self.client.post(reverse("accounts:login"),
                             {"username": "prem", "password": "long-pass-abc-999"})
        self.assertEqual(r.status_code, 403)
        self.assertFalse(r.wsgi_request.user.is_authenticated)

    def test_active_premium_allows_login(self):
        r = self.client.post(reverse("accounts:login"),
                             {"username": "prem", "password": "long-pass-abc-999"})
        self.assertRedirects(r, reverse("vault:app"))

    def test_premium_switch_off_blocks_vault_api_midsession(self):
        self.client.force_login(self.user)
        self.assertEqual(self.client.get(reverse("vault:state")).status_code, 200)
        self.user.is_premium = False
        self.user.save(update_fields=["is_premium"])
        r = self.client.get(reverse("vault:state"))
        self.assertEqual(r.status_code, 403)


class CSPComplianceTests(TestCase):
    """Guards against reintroducing CSP-violating inline <style>/<script> or
    style="" attributes in templates (style-src/script-src are 'self' only)."""

    def test_no_inline_style_or_script_in_templates(self):
        import os
        root = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")
        offenders = []
        for dirpath, _dirs, files in os.walk(root):
            for f in files:
                if not f.endswith(".html"):
                    continue
                path = os.path.join(dirpath, f)
                with open(path, encoding="utf-8") as fh:
                    text = fh.read()
                if "<style>" in text or 'style="' in text or "<script>" in text:
                    offenders.append(os.path.relpath(path, root))
        self.assertEqual(offenders, [], f"CSP-violating inline style/script in: {offenders}")


# --------------------------------------------------------------------------- #
# v1.13.1 — فاز A
# --------------------------------------------------------------------------- #

class SuperuserBootstrapTests(TestCase):
    """فاز A موارد ۳ و ۴ — createsuperuser must yield a working admin account:
    approved from the start, premium open-ended («بدون تاریخ انقضا»)."""

    def test_create_superuser_is_approved(self):
        su = User.objects.create_superuser("root1", "r1@x.co", "long-pass-abc-999")
        self.assertTrue(su.is_approved)
        self.assertIsNotNone(su.approved_at)

    def test_staff_premium_is_open_ended(self):
        su = User.objects.create_superuser("root2", "r2@x.co", "long-pass-abc-999")
        self.assertTrue(su.premium_active)
        self.assertIsNone(su.premium_until)      # «بدون تاریخ انقضا»
        self.assertIsNone(su.premium_days_left)  # so no UI ever shows a countdown

    def test_staff_premium_ignores_past_expiry(self):
        # Even if the old bug left a past date on an admin row, the premium
        # gate must never close on staff — and the UI must not show days.
        su = User.objects.create_superuser("root3", "r3@x.co", "long-pass-abc-999")
        su.premium_until = timezone.now().date() - timedelta(days=5)
        su.save(update_fields=["premium_until"])
        self.assertTrue(su.premium_active)
        self.assertIsNone(su.premium_days_left)

    def test_approve_keeps_staff_unlimited(self):
        mod = User.objects.create_user("mod1", password="long-pass-abc-999", is_staff=True)
        mod.approve()
        self.assertTrue(mod.is_approved)
        self.assertIsNone(mod.premium_until)

    def test_approve_still_gives_members_30_days(self):
        u = User.objects.create_user("plain1", password="long-pass-abc-999")
        u.approve()
        self.assertEqual(u.premium_until, timezone.now().date() + timedelta(days=30))


@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class PanelStaffPremiumTests(TestCase):
    """فاز A مورد ۴ — the panel must never put a day-counter on an admin."""

    def setUp(self):
        self.admin = User.objects.create_superuser("root4", "r4@x.co", "long-pass-abc-999")
        self.client.force_login(self.admin)

    def test_adjust_on_staff_is_a_noop(self):
        r = self.client.post(
            reverse("panel:user_premium_adjust", args=[self.admin.pk]),
            {"days": "30", "reason": "test"},
        )
        self.assertEqual(r.status_code, 302)
        self.admin.refresh_from_db()
        self.assertIsNone(self.admin.premium_until)
        self.assertFalse(PremiumLog.objects.filter(user=self.admin).exists())

    def test_quick_extend_on_staff_is_a_noop(self):
        self.client.post(reverse("panel:user_extend", args=[self.admin.pk]))
        self.admin.refresh_from_db()
        self.assertIsNone(self.admin.premium_until)
        self.assertFalse(PremiumLog.objects.filter(user=self.admin).exists())


@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=True,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class RateLimitTests(TestCase):
    """فاز A مورد ۱ — humane limits. Successful logins are never counted;
    failures and register spam still hit a wall. Loops are sized so a minute
    window rolling over mid-test cannot make them flaky."""

    def setUp(self):
        cache.clear()

    def test_successful_logins_never_rate_limited(self):
        User.objects.create_user("rlok", password="long-pass-abc-999", is_approved=True)
        for _ in range(12):
            r = self.client.post(reverse("accounts:login"),
                                 {"username": "rlok", "password": "long-pass-abc-999"})
            self.assertEqual(r.status_code, 302)   # 12/5m would have blocked here
            self.client.post(reverse("accounts:logout"))

    def test_failed_logins_hit_the_ip_limit(self):
        statuses = []
        for i in range(26):
            r = self.client.post(reverse("accounts:login"),
                                 {"username": f"ghost{i}", "password": "wrong-pass!!"})
            statuses.append(r.status_code)
            if r.status_code == 429:
                break
        self.assertTrue(all(s == 200 for s in statuses[:10]),
                        f"blocked too early: {statuses}")   # forgiving at first…
        self.assertIn(429, statuses, f"never blocked: {statuses}")  # …but the wall exists

    def test_register_form_retries_then_backstop(self):
        # Ten sloppy form submissions in a row stay free (the old 5/h cap
        # locked real users out here) …
        for _ in range(10):
            self.assertEqual(
                self.client.post(reverse("accounts:register"), {}).status_code, 200)
        # … and only sustained hammering meets the new wall.
        statuses = [self.client.post(reverse("accounts:register"), {}).status_code
                    for _ in range(16)]
        self.assertIn(429, statuses, f"backstop missing: {statuses}")


@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class ProfileTests(TestCase):
    """v1.15 فاز E مورد ۳۱ — optional server-side name/email on the User row."""

    def setUp(self):
        self.user = User.objects.create_user(
            "pf1", password="long-pass-abc-999", is_approved=True)
        self.client.force_login(self.user)

    def _post(self, payload):
        return self.client.post(
            reverse("accounts:profile"), payload,
            content_type="application/json")

    def test_requires_login(self):
        self.client.logout()
        r = self._post('{"name": "x", "email": ""}')
        self.assertEqual(r.status_code, 302)   # bounced to login

    def test_saves_name_and_email(self):
        r = self._post('{"name": "حمید", "email": "h@example.com"}')
        self.assertEqual(r.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "حمید")
        self.assertEqual(self.user.email, "h@example.com")

    def test_rejects_bad_email(self):
        r = self._post('{"name": "", "email": "not-an-email"}')
        self.assertEqual(r.status_code, 400)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "")

    def test_clearing_both_fields_is_fine(self):
        self._post('{"name": "حمید", "email": "h@example.com"}')
        r = self._post('{"name": "", "email": ""}')
        self.assertEqual(r.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "")
        self.assertEqual(self.user.email, "")

    def test_rejects_garbage_json(self):
        r = self.client.post(reverse("accounts:profile"), "{not json",
                             content_type="application/json")
        self.assertEqual(r.status_code, 400)


@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class PurchaseRequestTests(TestCase):
    """v1.18 فاز H مورد ۴۴ — the public buy form and its panel queue."""

    def test_creates_a_request(self):
        r = self.client.post(reverse("accounts:purchase"), {
            "name": "حمید", "phone": "09120000000",
            "email": "h@example.com", "note": "یک‌ساله",
        })
        self.assertEqual(r.status_code, 302)
        pr = PurchaseRequest.objects.get()
        self.assertEqual(pr.name, "حمید")
        self.assertEqual(pr.phone, "09120000000")
        self.assertFalse(pr.handled)

    def test_name_and_phone_are_required(self):
        self.client.post(reverse("accounts:purchase"), {"name": "", "phone": ""})
        self.assertEqual(PurchaseRequest.objects.count(), 0)

    def test_bad_email_is_rejected(self):
        self.client.post(reverse("accounts:purchase"), {
            "name": "x", "phone": "0912", "email": "nope",
        })
        self.assertEqual(PurchaseRequest.objects.count(), 0)

    def test_panel_requires_staff(self):
        User.objects.create_user("plain9", password="long-pass-abc-999", is_approved=True)
        self.client.login(username="plain9", password="long-pass-abc-999")
        r = self.client.get(reverse("panel:purchases"))
        self.assertIn(r.status_code, (302, 403))

    def test_staff_sees_and_toggles(self):
        pr = PurchaseRequest.objects.create(name="a", phone="0912")
        su = User.objects.create_superuser("root9", "r9@x.co", "long-pass-abc-999")
        self.client.force_login(su)
        page = self.client.get(reverse("panel:purchases"))
        self.assertEqual(page.status_code, 200)
        self.assertContains(page, "0912")
        self.client.post(reverse("panel:purchase_toggle", args=[pr.pk]))
        pr.refresh_from_db()
        self.assertTrue(pr.handled)

    def test_landing_shows_the_telegram_handle(self):
        with override_settings(PURCHASE_TELEGRAM="@TestHandle"):
            r = self.client.get(reverse("core:landing"))
            self.assertContains(r, "@TestHandle")
            self.assertContains(r, "t.me/TestHandle")


# --------------------------------------------------------------------------- #
# v4.8 (فاز E) — auto-registration window, last-seen, active counts
# --------------------------------------------------------------------------- #
@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class AutoRegistrationWindowTests(TestCase):
    def _register(self, code, username=" newbie".strip(), pw="a-very-long-pass-123"):
        return self.client.post(reverse("accounts:register"), {
            "username": username, "password1": pw, "password2": pw,
            "invite_code": code,
        })

    def _open_window(self, hours=24):
        from .models import SiteConfig
        cfg = SiteConfig.get_solo()
        cfg.auto_approve_until = timezone.now() + timedelta(hours=hours)
        cfg.save()

    def test_closed_window_still_requires_approval(self):
        inv = InviteCode.objects.create()
        r = self._register(inv.code, username="pend")
        self.assertRedirects(r, reverse("accounts:pending"))
        u = User.objects.get(username="pend")
        self.assertFalse(u.is_approved)

    def test_open_window_auto_approves_and_starts_premium(self):
        self._open_window(24)
        inv = InviteCode.objects.create()
        r = self._register(inv.code, username="auto")
        # Straight to login, not the pending page.
        self.assertRedirects(r, reverse("accounts:login"))
        u = User.objects.get(username="auto")
        self.assertTrue(u.is_approved)
        self.assertTrue(u.is_premium)
        self.assertTrue(u.premium_active)
        # 30-day premium, exactly like a hand-approval.
        self.assertEqual(
            u.premium_until, timezone.now().date() + timedelta(days=30)
        )

    def test_expired_window_does_not_auto_approve(self):
        from .models import SiteConfig
        cfg = SiteConfig.get_solo()
        cfg.auto_approve_until = timezone.now() - timedelta(hours=1)  # past
        cfg.save()
        inv = InviteCode.objects.create()
        r = self._register(inv.code, username="late")
        self.assertRedirects(r, reverse("accounts:pending"))
        self.assertFalse(User.objects.get(username="late").is_approved)

    def test_siteconfig_is_singleton(self):
        from .models import SiteConfig
        a = SiteConfig.get_solo()
        a.auto_approve_until = timezone.now()
        a.save()
        b = SiteConfig.get_solo()
        self.assertEqual(a.pk, b.pk)
        self.assertEqual(SiteConfig.objects.count(), 1)


@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class LastSeenTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("seen", password="long-pass-abc-999")
        self.user.is_approved = True
        self.user.save()

    def test_request_stamps_last_seen(self):
        self.assertIsNone(self.user.last_seen)
        self.client.force_login(self.user)
        self.client.get(reverse("vault:app"))
        self.user.refresh_from_db()
        self.assertIsNotNone(self.user.last_seen)

    def test_recent_last_seen_not_rewritten(self):
        # A stamp inside the throttle window must NOT be bumped on every request.
        stamp = timezone.now() - timedelta(minutes=5)
        User.objects.filter(pk=self.user.pk).update(last_seen=stamp)
        self.client.force_login(self.user)
        self.client.get(reverse("vault:app"))
        self.user.refresh_from_db()
        self.assertEqual(self.user.last_seen, stamp)

    def test_active_counts_on_dashboard(self):
        staff = User.objects.create_user(
            "boss", password="long-pass-boss-1", is_staff=True, is_approved=True
        )
        now = timezone.now()
        User.objects.filter(pk=self.user.pk).update(last_seen=now - timedelta(days=3))
        old = User.objects.create_user("old", password="long-pass-old-1", is_approved=True)
        User.objects.filter(pk=old.pk).update(last_seen=now - timedelta(days=20))
        self.client.force_login(staff)
        r = self.client.get(reverse("panel:home"))
        # 'seen' (3d) counts for both 7 and 30; 'old' (20d) only for 30.
        self.assertGreaterEqual(r.context["active_30"], 2)
        self.assertGreaterEqual(r.context["active_7"], 1)


@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class AutoApprovePanelTests(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user(
            "admin", password="long-pass-admin-1", is_staff=True, is_approved=True
        )
        self.client.force_login(self.staff)

    def test_open_and_close_window(self):
        from .models import SiteConfig
        self.client.post(reverse("panel:auto_approve"), {"hours": "12"})
        self.assertTrue(SiteConfig.get_solo().auto_approve_open)
        self.client.post(reverse("panel:auto_approve"), {"hours": "0"})
        self.assertFalse(SiteConfig.get_solo().auto_approve_open)

    def test_out_of_bounds_rejected(self):
        from .models import SiteConfig
        self.client.post(reverse("panel:auto_approve"), {"hours": "9999"})
        self.assertIsNone(SiteConfig.get_solo().auto_approve_until)

    def test_requires_staff(self):
        normal = User.objects.create_user("joe", password="long-pass-joe-1", is_approved=True)
        self.client.force_login(normal)
        r = self.client.post(reverse("panel:auto_approve"), {"hours": "12"})
        self.assertEqual(r.status_code, 302)  # bounced to login by staff_required


# --------------------------------------------------------------------------- #
# v4.8 (فاز F) — login degrades to read-only on expiry, hard-blocks on kill
# --------------------------------------------------------------------------- #
@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class ReadOnlyLoginTests(TestCase):
    def _login(self, username, pw):
        return self.client.post(reverse("accounts:login"),
                                {"username": username, "password": pw})

    def test_expired_subscription_can_still_log_in(self):
        u = User.objects.create_user("exp", password="long-pass-exp-1")
        u.is_approved = True
        u.is_premium = True
        u.premium_until = timezone.now().date() - timedelta(days=1)  # lapsed
        u.save()
        self.assertTrue(u.read_only_access)
        self.assertFalse(u.premium_active)
        r = self._login("exp", "long-pass-exp-1")
        self.assertRedirects(r, reverse("vault:app"))  # in, read-only

    def test_killswitch_hard_blocks_login(self):
        u = User.objects.create_user("kill", password="long-pass-kill-1")
        u.is_approved = True
        u.is_premium = False  # admin kill-switch
        u.save()
        self.assertFalse(u.can_open_app)
        r = self._login("kill", "long-pass-kill-1")
        self.assertEqual(r.status_code, 403)


# --------------------------------------------------------------------------- #
# v4.9 — subscription page
# --------------------------------------------------------------------------- #
@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class SubscribePageTests(TestCase):
    def _user(self, name, *, premium=True, until_days=None):
        u = User.objects.create_user(name, password="long-pass-sub-123")
        u.is_approved = True
        u.is_premium = premium
        if until_days is not None:
            u.premium_until = timezone.now().date() + timedelta(days=until_days)
        u.save()
        return u

    def test_expired_user_can_reach_the_page(self):
        # The whole point: the one thing a lapsed account must always be able
        # to do is renew.
        u = self._user("sub_ro", until_days=-1)
        self.assertTrue(u.read_only_access)
        self.client.force_login(u)
        r = self.client.get(reverse("accounts:subscribe"))
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.context["read_only"])

    def test_active_user_sees_active_status(self):
        u = self._user("sub_ok", until_days=30)
        self.client.force_login(u)
        r = self.client.get(reverse("accounts:subscribe"))
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.context["premium_active"])

    def test_anonymous_is_redirected(self):
        r = self.client.get(reverse("accounts:subscribe"))
        self.assertEqual(r.status_code, 302)

    def test_four_plans_with_computed_savings(self):
        u = self._user("sub_plans", until_days=30)
        self.client.force_login(u)
        plans = self.client.get(reverse("accounts:subscribe")).context["plans"]
        self.assertEqual([p["key"] for p in plans], ["1m", "3m", "6m", "12m"])
        # monthly is the baseline, so it never shows a saving
        self.assertEqual(plans[0]["save_pct"], 0)
        # longer plans must save progressively more
        self.assertLess(plans[1]["save_pct"], plans[3]["save_pct"])
        # per-month equivalent is the price divided by the months
        self.assertEqual(plans[3]["per_month"], round(plans[3]["price"] / 12))
        self.assertTrue(plans[3]["best"])

    def test_prices_come_from_siteconfig(self):
        from .models import SiteConfig
        cfg = SiteConfig.get_solo()
        cfg.price_1m = 250000
        cfg.telegram_id = "@CustomId"
        cfg.save()
        u = self._user("sub_cfg", until_days=30)
        self.client.force_login(u)
        r = self.client.get(reverse("accounts:subscribe"))
        self.assertEqual(r.context["plans"][0]["price"], 250000)
        self.assertEqual(r.context["telegram_id"], "@CustomId")
        self.assertEqual(r.context["telegram_url"], "https://t.me/CustomId")

    def test_gateway_disabled_by_default(self):
        u = self._user("sub_gw", until_days=30)
        self.client.force_login(u)
        r = self.client.get(reverse("accounts:subscribe"))
        self.assertFalse(r.context["gateway_enabled"])


# --------------------------------------------------------------------------- #
# v5.0 — registration automation: four routes, per-code rules, open window
# --------------------------------------------------------------------------- #
@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class RegistrationRoutesTests(TestCase):
    def _reg(self, username, code=""):
        pw = "a-very-long-pass-123"
        return self.client.post(reverse("accounts:register"), {
            "username": username, "password1": pw, "password2": pw,
            "invite_code": code,
        })

    def _cfg(self, **kw):
        from .models import SiteConfig
        cfg = SiteConfig.get_solo()
        for k, v in kw.items():
            setattr(cfg, k, v)
        cfg.save()
        return cfg

    # ---- route 1: classic invite + manual approval ---------------------- #
    def test_invite_manual_is_still_the_default(self):
        from .models import RegistrationEvent
        inv = InviteCode.objects.create()
        r = self._reg("cls", inv.code)
        self.assertRedirects(r, reverse("accounts:pending"))
        u = User.objects.get(username="cls")
        self.assertFalse(u.is_approved)
        ev = RegistrationEvent.objects.get(username="cls")
        self.assertEqual(ev.route, RegistrationEvent.ROUTE_INVITE)
        self.assertFalse(ev.auto_approved)

    # ---- route 2: the code carries its own auto-approve ----------------- #
    def test_code_with_auto_approve_skips_the_queue(self):
        from .models import RegistrationEvent
        inv = InviteCode.objects.create(auto_approve=True, premium_days=14)
        r = self._reg("auto", inv.code)
        self.assertRedirects(r, reverse("accounts:login"))
        u = User.objects.get(username="auto")
        self.assertTrue(u.is_approved)
        self.assertEqual(u.premium_until,
                         timezone.now().date() + timedelta(days=14))
        ev = RegistrationEvent.objects.get(username="auto")
        self.assertEqual(ev.route, RegistrationEvent.ROUTE_INVITE_AUTO)
        self.assertEqual(ev.premium_days, 14)

    def test_code_auto_approve_expires(self):
        inv = InviteCode.objects.create(
            auto_approve=True,
            auto_approve_until=timezone.now() - timedelta(minutes=1),  # passed
        )
        self.assertFalse(inv.auto_approve_open)
        r = self._reg("late", inv.code)
        self.assertRedirects(r, reverse("accounts:pending"))
        self.assertFalse(User.objects.get(username="late").is_approved)

    def test_code_premium_days_are_per_code(self):
        inv = InviteCode.objects.create(auto_approve=True, premium_days=90)
        self._reg("ninety", inv.code)
        self.assertEqual(User.objects.get(username="ninety").premium_until,
                         timezone.now().date() + timedelta(days=90))

    # ---- route 3: the global auto-approve window ------------------------ #
    def test_global_window_uses_its_own_day_count(self):
        from .models import RegistrationEvent
        self._cfg(auto_approve_until=timezone.now() + timedelta(hours=2),
                  auto_approve_days=5)
        inv = InviteCode.objects.create()
        self._reg("win", inv.code)
        u = User.objects.get(username="win")
        self.assertTrue(u.is_approved)
        self.assertEqual(u.premium_until, timezone.now().date() + timedelta(days=5))
        self.assertEqual(RegistrationEvent.objects.get(username="win").route,
                         RegistrationEvent.ROUTE_WINDOW)

    # ---- route 4: open registration, no invite code --------------------- #
    def test_no_code_is_refused_when_window_is_closed(self):
        r = self._reg("nocode", "")
        self.assertEqual(r.status_code, 200)          # re-rendered with errors
        self.assertFalse(User.objects.filter(username="nocode").exists())

    def test_open_window_allows_registration_without_a_code(self):
        from .models import RegistrationEvent, SiteConfig
        self._cfg(open_reg_until=timezone.now() + timedelta(hours=1),
                  open_reg_days=3, open_reg_max=10)
        r = self._reg("free", "")
        self.assertRedirects(r, reverse("accounts:login"))
        u = User.objects.get(username="free")
        self.assertTrue(u.is_approved)
        self.assertEqual(u.premium_until, timezone.now().date() + timedelta(days=3))
        self.assertEqual(RegistrationEvent.objects.get(username="free").route,
                         RegistrationEvent.ROUTE_OPEN)
        self.assertEqual(SiteConfig.get_solo().open_reg_count, 1)

    def test_open_window_can_still_require_approval(self):
        self._cfg(open_reg_until=timezone.now() + timedelta(hours=1),
                  open_reg_needs_approval=True, open_reg_max=10)
        r = self._reg("freeq", "")
        self.assertRedirects(r, reverse("accounts:pending"))
        self.assertFalse(User.objects.get(username="freeq").is_approved)

    def test_open_window_account_cap_closes_the_door(self):
        from .models import SiteConfig
        self._cfg(open_reg_until=timezone.now() + timedelta(hours=1),
                  open_reg_max=2, open_reg_count=0)
        self._reg("cap1", "")
        self._reg("cap2", "")
        self.assertFalse(SiteConfig.get_solo().open_reg_open)   # cap reached
        self._reg("cap3", "")
        self.assertFalse(User.objects.filter(username="cap3").exists())

    def test_expired_open_window_is_closed(self):
        self._cfg(open_reg_until=timezone.now() - timedelta(minutes=1),
                  open_reg_max=10)
        self._reg("expired", "")
        self.assertFalse(User.objects.filter(username="expired").exists())

    def test_open_window_still_honours_a_supplied_code(self):
        # a code given during an open window should take the code's own path
        from .models import RegistrationEvent
        self._cfg(open_reg_until=timezone.now() + timedelta(hours=1),
                  open_reg_max=10)
        inv = InviteCode.objects.create(auto_approve=True, premium_days=45)
        self._reg("both", inv.code)
        self.assertEqual(User.objects.get(username="both").premium_until,
                         timezone.now().date() + timedelta(days=45))
        self.assertEqual(RegistrationEvent.objects.get(username="both").route,
                         RegistrationEvent.ROUTE_INVITE_AUTO)


# --------------------------------------------------------------------------- #
# v5.0 — panel: open-registration control, reports, purchase intent
# --------------------------------------------------------------------------- #
@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class PanelControlTests(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user(
            "p_admin", password="long-pass-panel-1", is_staff=True, is_approved=True)
        self.client.force_login(self.staff)

    def test_open_reg_window_opens_with_all_three_limits(self):
        from .models import SiteConfig
        self.client.post(reverse("panel:open_reg"),
                         {"hours": "2", "days": "7", "max": "25"})
        cfg = SiteConfig.get_solo()
        self.assertTrue(cfg.open_reg_open)
        self.assertEqual(cfg.open_reg_days, 7)
        self.assertEqual(cfg.open_reg_max, 25)
        self.assertEqual(cfg.open_reg_count, 0)

    def test_open_reg_rejects_more_than_24_hours(self):
        from .models import SiteConfig
        self.client.post(reverse("panel:open_reg"),
                         {"hours": "48", "days": "7", "max": "25"})
        self.assertIsNone(SiteConfig.get_solo().open_reg_until)

    def test_opening_resets_the_counter(self):
        # a fresh window must get a fresh allowance, not inherit a spent one
        from .models import SiteConfig
        cfg = SiteConfig.get_solo()
        cfg.open_reg_count = 40
        cfg.save()
        self.client.post(reverse("panel:open_reg"),
                         {"hours": "1", "days": "3", "max": "10"})
        self.assertEqual(SiteConfig.get_solo().open_reg_count, 0)

    def test_open_reg_closes_immediately(self):
        from .models import SiteConfig
        self.client.post(reverse("panel:open_reg"),
                         {"hours": "2", "days": "7", "max": "25"})
        self.client.post(reverse("panel:open_reg"), {"hours": "0"})
        self.assertFalse(SiteConfig.get_solo().open_reg_open)

    def test_auto_approve_days_can_be_set(self):
        from .models import SiteConfig
        self.client.post(reverse("panel:auto_approve_days"), {"days": "45"})
        self.assertEqual(SiteConfig.get_solo().auto_approve_days, 45)

    def test_dashboard_surfaces_an_open_door(self):
        self.client.post(reverse("panel:open_reg"),
                         {"hours": "2", "days": "7", "max": "25"})
        r = self.client.get(reverse("panel:home"))
        kinds = [a["kind"] for a in r.context["attention"]]
        self.assertIn("open_reg", kinds)

    def test_dashboard_is_calm_when_nothing_pending(self):
        r = self.client.get(reverse("panel:home"))
        self.assertEqual(r.context["attention"], [])

    def test_reports_page_renders(self):
        r = self.client.get(reverse("panel:reports"))
        self.assertEqual(r.status_code, 200)

    def test_reports_counts_signup_routes(self):
        from .models import RegistrationEvent
        RegistrationEvent.objects.create(
            username="x", route=RegistrationEvent.ROUTE_OPEN, premium_days=3)
        r = self.client.get(reverse("panel:reports"))
        self.assertEqual(r.context["signup_total"], 1)

    def test_panel_control_requires_staff(self):
        normal = User.objects.create_user("p_joe", password="long-pass-joe-9",
                                          is_approved=True)
        self.client.force_login(normal)
        r = self.client.post(reverse("panel:open_reg"), {"hours": "2"})
        self.assertEqual(r.status_code, 302)


@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class PurchaseIntentTests(TestCase):
    def setUp(self):
        self.u = User.objects.create_user("buyer", password="long-pass-buy-1")
        self.u.is_approved = True
        self.u.is_premium = True
        self.u.save()
        self.client.force_login(self.u)

    def test_click_is_recorded_with_the_plan_price(self):
        from .models import PurchaseIntent, SiteConfig
        r = self.client.post(reverse("accounts:purchase_intent"), {"plan": "12m"})
        self.assertEqual(r.status_code, 204)
        pi = PurchaseIntent.objects.get(username="buyer")
        self.assertEqual(pi.plan, "12m")
        self.assertEqual(pi.price, SiteConfig.get_solo().price_12m)

    def test_unknown_plan_is_ignored_not_stored(self):
        from .models import PurchaseIntent
        r = self.client.post(reverse("accounts:purchase_intent"), {"plan": "999m"})
        self.assertEqual(r.status_code, 204)      # never blocks the click
        self.assertEqual(PurchaseIntent.objects.count(), 0)

    def test_anonymous_cannot_record(self):
        self.client.logout()
        r = self.client.post(reverse("accounts:purchase_intent"), {"plan": "1m"})
        self.assertEqual(r.status_code, 302)


# --------------------------------------------------------------------------- #
# v5.2 — encrypted backup: round-trip, tamper detection, access control
# --------------------------------------------------------------------------- #
@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class BackupTests(TestCase):
    PASS = "a-long-enough-passphrase"

    def _seed(self):
        from .models import InviteCode, RegistrationEvent
        u = User.objects.create_user("bk_user", password="long-pass-bk-1")
        u.is_approved = True
        u.is_premium = True
        u.save()
        InviteCode.objects.create(label="bk-code", premium_days=21)
        RegistrationEvent.objects.create(
            username="bk_user", route=RegistrationEvent.ROUTE_OPEN, premium_days=3)
        return u

    # ---- the test that matters: does a restore actually come back? ------- #
    def test_round_trip_restores_every_row(self):
        from .backup import decrypt_bundle, export_bundle, restore_payload
        from .models import InviteCode, RegistrationEvent

        self._seed()
        before_users = set(User.objects.values_list("username", flat=True))
        before_codes = InviteCode.objects.count()
        before_events = RegistrationEvent.objects.count()

        blob = export_bundle(self.PASS)

        # wipe the things the backup covers, as a real disaster would
        RegistrationEvent.objects.all().delete()
        InviteCode.objects.all().delete()
        User.objects.filter(username="bk_user").delete()
        self.assertEqual(InviteCode.objects.count(), 0)

        payload = decrypt_bundle(blob, self.PASS)
        restore_payload(payload)

        self.assertEqual(set(User.objects.values_list("username", flat=True)),
                         before_users)
        self.assertEqual(InviteCode.objects.count(), before_codes)
        self.assertEqual(RegistrationEvent.objects.count(), before_events)
        self.assertEqual(InviteCode.objects.first().premium_days, 21)

    def test_vault_ciphertext_survives_the_round_trip(self):
        # the whole point of the backup: the encrypted blobs must come back
        # byte-identical, or nobody can ever unlock again
        from vault.models import EncryptedVault
        from .backup import decrypt_bundle, export_bundle, restore_payload

        u = self._seed()
        v = EncryptedVault.objects.create(
            user=u, ciphertext="Y2lwaGVy", ciphertext_iv="aXY=",
            salt="c2FsdA==", wrapped_key="d2s=", wrapped_key_iv="d2tpdg==")
        original = (v.ciphertext, v.ciphertext_iv, v.salt,
                    v.wrapped_key, v.wrapped_key_iv)

        blob = export_bundle(self.PASS)
        EncryptedVault.objects.all().delete()
        restore_payload(decrypt_bundle(blob, self.PASS))

        back = EncryptedVault.objects.get(user__username="bk_user")
        self.assertEqual(
            (back.ciphertext, back.ciphertext_iv, back.salt,
             back.wrapped_key, back.wrapped_key_iv), original)

    def test_password_hash_survives_so_people_can_still_log_in(self):
        from .backup import decrypt_bundle, export_bundle, restore_payload
        u = self._seed()
        hash_before = u.password
        blob = export_bundle(self.PASS)
        User.objects.filter(username="bk_user").delete()
        restore_payload(decrypt_bundle(blob, self.PASS))
        self.assertEqual(User.objects.get(username="bk_user").password, hash_before)

    # ---- crypto behaviour ------------------------------------------------ #
    def test_wrong_passphrase_is_refused(self):
        from .backup import BackupError, decrypt_bundle, export_bundle
        self._seed()
        blob = export_bundle(self.PASS)
        with self.assertRaises(BackupError):
            decrypt_bundle(blob, "a-different-passphrase")

    def test_tampered_bundle_is_refused(self):
        # GCM authenticates: a flipped byte must fail loudly, not restore
        # subtly-wrong data
        from .backup import BackupError, decrypt_bundle, export_bundle
        self._seed()
        blob = bytearray(export_bundle(self.PASS))
        blob[-1] ^= 0x01
        with self.assertRaises(BackupError):
            decrypt_bundle(bytes(blob), self.PASS)

    def test_short_passphrase_is_rejected(self):
        from .backup import BackupError, export_bundle
        with self.assertRaises(BackupError):
            export_bundle("short")

    def test_bundle_is_not_readable_as_plain_text(self):
        # a naive "is it encrypted?" check: the username must not appear in the
        # bytes we hand to the operator
        from .backup import export_bundle
        self._seed()
        self.assertNotIn(b"bk_user", export_bundle(self.PASS))

    def test_foreign_file_is_rejected(self):
        from .backup import BackupError, decrypt_bundle
        with self.assertRaises(BackupError):
            decrypt_bundle(b'{"magic":"SOMETHING-ELSE"}\n' + b"x" * 40, self.PASS)

    # ---- access control -------------------------------------------------- #
    def test_backup_page_is_superuser_only(self):
        staff = User.objects.create_user("bk_staff", password="long-pass-st-1",
                                         is_staff=True, is_approved=True)
        self.client.force_login(staff)
        r = self.client.get(reverse("panel:backup"))
        self.assertEqual(r.status_code, 302)          # bounced to the dashboard

    def test_export_requires_the_login_password(self):
        su = User.objects.create_superuser("bk_su", password="long-pass-su-11")
        self.client.force_login(su)
        r = self.client.post(reverse("panel:backup_export"), {
            "login_password": "wrong", "passphrase": self.PASS,
            "passphrase2": self.PASS})
        self.assertEqual(r.status_code, 302)          # refused, back to the page

    def test_export_streams_an_encrypted_file(self):
        su = User.objects.create_superuser("bk_su2", password="long-pass-su-22")
        self.client.force_login(su)
        r = self.client.post(reverse("panel:backup_export"), {
            "login_password": "long-pass-su-22",
            "passphrase": self.PASS, "passphrase2": self.PASS})
        self.assertEqual(r.status_code, 200)
        self.assertIn("attachment", r["Content-Disposition"])
        self.assertIn("no-store", r["Cache-Control"])
        self.assertTrue(r.content.startswith(b'{"magic": "AEGIS-BACKUP"'))

    def test_mismatched_passphrases_are_refused(self):
        su = User.objects.create_superuser("bk_su3", password="long-pass-su-33")
        self.client.force_login(su)
        r = self.client.post(reverse("panel:backup_export"), {
            "login_password": "long-pass-su-33",
            "passphrase": self.PASS, "passphrase2": "something-else-entirely"})
        self.assertEqual(r.status_code, 302)
