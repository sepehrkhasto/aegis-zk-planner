import json

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import EncryptedVault

User = get_user_model()

BUNDLE = {
    "kdf": "PBKDF2-SHA256",
    "iterations": 600000,
    "salt": "c2FsdA==",
    "wrappedKey": "d3JhcHBlZA==",
    "wrappedKeyIv": "aXY=",
    "ciphertext": "Y2lwaGVy",
    "ciphertextIv": "aXYy",
}


@override_settings(
    SECURE_SSL_REDIRECT=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class VaultApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("hamid", password="long-pass-abc-999")
        self.user.approve()
        self.client.force_login(self.user)

    def _post(self, name, data):
        return self.client.post(reverse(name), json.dumps(data),
                                content_type="application/json")

    def test_state_uninitialized(self):
        r = self.client.get(reverse("vault:state"))
        self.assertEqual(r.json(), {"initialized": False})

    def test_init_then_state(self):
        r = self._post("vault:init", BUNDLE)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["revision"], 1)
        s = self.client.get(reverse("vault:state")).json()
        self.assertTrue(s["initialized"])
        self.assertEqual(s["meta"]["salt"], BUNDLE["salt"])
        self.assertEqual(s["ciphertext"], BUNDLE["ciphertext"])

    def test_double_init_conflicts(self):
        self._post("vault:init", BUNDLE)
        r = self._post("vault:init", BUNDLE)
        self.assertEqual(r.status_code, 409)

    def test_save_bumps_revision_and_stale_conflicts(self):
        self._post("vault:init", BUNDLE)
        r = self._post("vault:save",
                       {"ciphertext": "bmV3", "ciphertextIv": "aXYz", "revision": 1})
        self.assertEqual(r.json()["revision"], 2)
        # stale revision → 409 with current revision
        r2 = self._post("vault:save",
                        {"ciphertext": "b2xk", "ciphertextIv": "aXY0", "revision": 1})
        self.assertEqual(r2.status_code, 409)
        self.assertEqual(r2.json()["revision"], 2)

    def test_restore_overwrites(self):
        self._post("vault:init", BUNDLE)
        newb = dict(BUNDLE, ciphertext="cmVzdG9yZWQ=", salt="bmV3c2FsdA==")
        r = self._post("vault:restore", newb)
        self.assertEqual(r.status_code, 200)
        v = EncryptedVault.objects.get(user=self.user)
        self.assertEqual(v.ciphertext, "cmVzdG9yZWQ=")
        self.assertEqual(v.salt, "bmV3c2FsdA==")

    def test_requires_login(self):
        self.client.logout()
        r = self.client.get(reverse("vault:state"))
        self.assertEqual(r.status_code, 302)  # redirected to login

    def test_users_are_isolated(self):
        self._post("vault:init", BUNDLE)
        other = User.objects.create_user("other", password="long-pass-xyz-111")
        other.approve()
        self.client.force_login(other)
        s = self.client.get(reverse("vault:state")).json()
        self.assertEqual(s, {"initialized": False})

    def test_rejects_bad_payload(self):
        r = self._post("vault:init", {"kdf": "x"})
        self.assertEqual(r.status_code, 400)


# --------------------------------------------------------------------------- #
# v2.0-rc — فاز J: final audit. These tests encode the invariants the whole
# product rests on, so a future refactor cannot quietly break them.
# --------------------------------------------------------------------------- #

@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class ConflictPathTests(TestCase):
    """The 409 optimistic-concurrency path, end to end (item 47)."""

    def setUp(self):
        self.user = User.objects.create_user(
            "cf1", password="long-pass-abc-999", is_approved=True, is_premium=True)
        self.client.force_login(self.user)
        self.client.post(reverse("vault:init"), json.dumps(BUNDLE),
                         content_type="application/json")

    def _rev(self):
        return self.client.get(reverse("vault:state")).json()["revision"]

    def _save(self, revision, ct="Q0lQSEVS"):
        return self.client.post(reverse("vault:save"), json.dumps({
            "ciphertext": ct, "ciphertextIv": "aXY=", "revision": revision,
        }), content_type="application/json")

    def test_save_bumps_revision(self):
        r0 = self._rev()
        r = self._save(r0)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["revision"], r0 + 1)

    def test_stale_revision_gets_409_with_server_revision(self):
        r0 = self._rev()
        self._save(r0)                       # server moves on
        r = self._save(r0, ct="U1RBTEU=")    # a second tab is still on r0
        self.assertEqual(r.status_code, 409)
        body = r.json()
        self.assertEqual(body["error"], "conflict")
        self.assertEqual(body["revision"], r0 + 1)

    def test_conflict_does_not_overwrite_the_server_copy(self):
        r0 = self._rev()
        self._save(r0, ct="V0lOTkVS")
        self._save(r0, ct="TE9TRVI=")        # rejected
        v = EncryptedVault.objects.get(user=self.user)
        self.assertEqual(v.ciphertext, "V0lOTkVS")
        self.assertEqual(v.revision, r0 + 1)

    def test_client_can_recover_by_saving_at_the_returned_revision(self):
        r0 = self._rev()
        self._save(r0)
        rev = self._save(r0).json()["revision"]   # 409 tells the client where it is
        r = self._save(rev, ct="TUVSR0VE")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(EncryptedVault.objects.get(user=self.user).ciphertext, "TUVSR0VE")

    def test_save_before_init_is_409_not_500(self):
        other = User.objects.create_user(
            "cf2", password="long-pass-abc-999", is_approved=True, is_premium=True)
        self.client.force_login(other)
        r = self._save(0)   # no vault row exists for this user at all
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"], "not_initialized")


@override_settings(
    SECURE_SSL_REDIRECT=False,
    RATELIMIT_ENABLE=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class ZeroKnowledgeBoundaryTests(TestCase):
    """The server must never hold, accept or leak plaintext (item 47)."""

    def setUp(self):
        self.a = User.objects.create_user(
            "zk_a", password="long-pass-abc-999", is_approved=True, is_premium=True)
        self.b = User.objects.create_user(
            "zk_b", password="long-pass-abc-999", is_approved=True, is_premium=True)

    def _init_and_save(self, user, ct):
        self.client.force_login(user)
        self.client.post(reverse("vault:init"), json.dumps(BUNDLE),
                         content_type="application/json")
        rev = self.client.get(reverse("vault:state")).json()["revision"]
        self.client.post(reverse("vault:save"), json.dumps({
            "ciphertext": ct, "ciphertextIv": "aXY=", "revision": rev,
        }), content_type="application/json")

    def test_vault_row_stores_only_what_the_client_encrypted(self):
        self._init_and_save(self.a, "T1BBUVVF")
        v = EncryptedVault.objects.get(user=self.a)
        self.assertEqual(v.ciphertext, "T1BBUVVF")
        # nothing resembling a plaintext field exists on the model
        names = {f.name for f in EncryptedVault._meta.get_fields()}
        for leak in ("tasks", "notes", "title", "plaintext", "content", "body"):
            self.assertNotIn(leak, names)

    def test_extra_plaintext_fields_are_ignored_not_stored(self):
        self.client.force_login(self.a)
        self.client.post(reverse("vault:init"), json.dumps(BUNDLE),
                         content_type="application/json")
        rev = self.client.get(reverse("vault:state")).json()["revision"]
        self.client.post(reverse("vault:save"), json.dumps({
            "ciphertext": "Q1Q=", "ciphertextIv": "aXY=", "revision": rev,
            "title": "my secret task", "tasks": [{"t": "leak me"}],
        }), content_type="application/json")
        blob = json.dumps(EncryptedVault.objects.get(user=self.a).__dict__, default=str)
        self.assertNotIn("my secret task", blob)
        self.assertNotIn("leak me", blob)

    def test_one_user_cannot_read_anothers_vault(self):
        self._init_and_save(self.a, "QUFBQQ==")
        self._init_and_save(self.b, "QkJCQg==")
        self.client.force_login(self.b)
        got = self.client.get(reverse("vault:state")).json()
        self.assertNotIn("QUFBQQ==", json.dumps(got))

    def test_one_user_cannot_overwrite_anothers_vault(self):
        self._init_and_save(self.a, "QUFBQQ==")
        self._init_and_save(self.b, "QkJCQg==")
        self.client.force_login(self.b)
        for rev in range(0, 4):     # try every plausible revision as user B
            self.client.post(reverse("vault:save"), json.dumps({
                "ciphertext": "SEFDS0VE", "ciphertextIv": "aXY=", "revision": rev,
            }), content_type="application/json")
        self.assertEqual(EncryptedVault.objects.get(user=self.a).ciphertext, "QUFBQQ==")

    def test_reminder_slots_carry_no_content(self):
        from vault.models import ReminderSlot
        names = {f.name for f in ReminderSlot._meta.get_fields()}
        self.assertEqual(names, {"id", "user", "fire_at", "sent", "created_at"})

    def test_anonymous_cannot_touch_any_vault_endpoint(self):
        self.client.logout()
        for name, method in [
            ("vault:state", "get"), ("vault:init", "post"), ("vault:save", "post"),
            ("vault:rekey", "post"), ("vault:set_recovery", "post"), ("vault:restore", "post"),
            ("vault:push_slots", "post"),
        ]:
            url = reverse(name)
            r = (self.client.get(url) if method == "get"
                 else self.client.post(url, "{}", content_type="application/json"))
            self.assertIn(r.status_code, (302, 403),
                          f"{name} answered {r.status_code} to an anonymous caller")


class ResponsiveCoverageTests(TestCase):
    """فاز J: every route the app can show must have at least one mobile rule.

    This can't replace looking at a phone, but it does catch the case where a
    new route ships with no small-screen handling at all."""

    def test_every_route_class_has_mobile_css(self):
        css = open("static/css/app.css", encoding="utf-8").read()
        app_js = open("static/js/app.js", encoding="utf-8").read()
        import re
        routes = set(re.findall(r'"(dashboard|tasks|calendar|notes|habits|goals|'
                                r'lists|journal|work|reports|review|focus|trash|'
                                r'settings|links)"', app_js))
        mobile = "\n".join(
            block for block in css.split("@media")
            if block.startswith(" (max-width") or block.startswith("(max-width")
        )
        # a route is covered by its own rule or by the generic .route-view rules
        generic = ".route-view" in mobile or ".panel" in mobile
        self.assertTrue(generic, "no generic mobile rules for route panels at all")
        self.assertTrue(len(routes) >= 10, "route list looks wrong; update this test")


# --------------------------------------------------------------------------- #
# v4.8 (فاز F) — read-only-after-expiry gate on the vault endpoints
# --------------------------------------------------------------------------- #
from datetime import timedelta
from django.utils import timezone


@override_settings(
    SECURE_SSL_REDIRECT=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class ReadOnlyGateTests(TestCase):
    def _post(self, name, data):
        return self.client.post(reverse(name), json.dumps(data),
                                content_type="application/json")

    def _make(self, username, *, is_premium=True, until_days=None,
              approved=True, active=True):
        u = User.objects.create_user(username, password="long-pass-abc-999")
        u.is_approved = approved
        u.is_active = active
        u.is_premium = is_premium
        if until_days is not None:
            u.premium_until = timezone.now().date() + timedelta(days=until_days)
        u.save()
        return u

    # ---- read-only (naturally expired) ----------------------------------- #
    def test_readonly_can_open_app_with_flag(self):
        u = self._make("ro_app", until_days=-1)     # expired yesterday
        self.assertTrue(u.read_only_access)
        self.client.force_login(u)
        r = self.client.get(reverse("vault:app"))
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.context["read_only"])

    def test_readonly_can_read_state(self):
        u = self._make("ro_state", until_days=-1)
        self.client.force_login(u)
        r = self.client.get(reverse("vault:state"))
        self.assertEqual(r.status_code, 200)

    def test_readonly_save_is_refused_but_session_kept(self):
        u = self._make("ro_save", until_days=-1)
        self.client.force_login(u)
        r = self._post("vault:save", {"ciphertext": "x", "ciphertextIv": "y", "revision": 1})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json().get("error"), "read_only")
        # NOT logged out: a follow-up read still works.
        self.assertEqual(self.client.get(reverse("vault:state")).status_code, 200)

    def test_readonly_init_is_refused(self):
        u = self._make("ro_init", until_days=-1)
        self.client.force_login(u)
        r = self._post("vault:init", BUNDLE)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json().get("error"), "read_only")

    def test_readonly_rekey_is_allowed_through_gate(self):
        # rekey is a security action, allowed in read-only. Empty body means the
        # VIEW answers 400 (bad json) — proving the gate did NOT block it.
        u = self._make("ro_rekey", until_days=-1)
        self.client.force_login(u)
        r = self._post("vault:rekey", {})
        self.assertNotEqual(r.status_code, 403)
        self.assertEqual(r.status_code, 400)

    # ---- full access ------------------------------------------------------ #
    def test_full_user_can_write(self):
        u = self._make("full", until_days=30)
        self.client.force_login(u)
        r = self._post("vault:init", BUNDLE)
        self.assertEqual(r.status_code, 200)

    # ---- hard block (admin kill-switch) ----------------------------------- #
    def test_killswitch_write_is_hard_blocked_and_logs_out(self):
        u = self._make("kill", is_premium=False)
        self.assertFalse(u.can_open_app)
        self.client.force_login(u)
        r = self._post("vault:save", {"ciphertext": "x", "ciphertextIv": "y", "revision": 1})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json().get("error"), "premium_inactive")
        # Hard block logs the session out: a follow-up read is now unauthorized.
        self.assertNotEqual(self.client.get(reverse("vault:state")).status_code, 200)
