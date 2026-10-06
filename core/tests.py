"""Tests for the public pages (core app).

v3.2 (فاز صفحه‌ی اصلی): the landing grew three sections (proof / compare /
FAQ), Open Graph tags for Telegram link previews, a one-switch SEO flag, and
— most importantly — the Vazirmatn font finally ships in the repo instead of
being a seven-file wish. These tests pin all of that down.
"""

from pathlib import Path

from django.conf import settings
from django.test import TestCase, override_settings
from django.urls import reverse


@override_settings(SECURE_SSL_REDIRECT=False)
class WhoamiAndBuyTests(TestCase):
    """v3.4.2 (فاز ۳): the heart opens a terminal, and the buy section is a
    single Telegram action instead of a form."""

    def test_the_heart_opens_the_terminal_page(self):
        r = self.client.get(reverse("core:whoami"))
        self.assertEqual(r.status_code, 200)
        # the name must be in the HTML itself, not only produced by the typing
        # script — the page has to work before/without JavaScript
        self.assertContains(r, "Sepehr")
        self.assertContains(r, "$ whoami")

    def test_the_landing_heart_points_at_it(self):
        r = self.client.get(reverse("core:landing"))
        self.assertContains(r, reverse("core:whoami"))

    def test_the_old_team_page_is_gone(self):
        self.assertEqual(self.client.get("/team/").status_code, 404)

    def test_buy_section_is_telegram_only(self):
        """The form asked visitors of a privacy product for a phone number
        before they had any reason to trust it. One clear action instead."""
        with override_settings(PURCHASE_TELEGRAM="@TestHandle"):
            r = self.client.get(reverse("core:landing"))
        self.assertNotContains(r, "lp-buyform")
        self.assertNotContains(r, 'name="phone"')
        self.assertContains(r, "lp-tgcard")
        self.assertContains(r, "t.me/")


@override_settings(SECURE_SSL_REDIRECT=False)
class LandingV32Tests(TestCase):
    def test_landing_ships_the_new_sections(self):
        r = self.client.get(reverse("core:landing"))
        self.assertEqual(r.status_code, 200)
        # the zero-knowledge proof panes
        self.assertContains(r, "lp-proof")
        self.assertContains(r, "lp-cipher")
        # the honest comparison table
        self.assertContains(r, "lp-cmp__table")
        # the native-details FAQ
        self.assertContains(r, "lp-faq")
        self.assertContains(r, "<details", count=6)
        # footer states a version — the exact number is guarded (and kept in
        # lockstep with the service worker) by the JS suite, so pinning the
        # literal here only produced false failures on every legitimate bump.
        self.assertRegex(r.content.decode(), r"نسخه‌ی\s*[۰-۹]+\.[۰-۹]+")

    def test_landing_serves_social_preview_tags(self):
        """A link pasted into Telegram must unfurl into a product card, not a
        bare grey URL — every purchase conversation happens there."""
        r = self.client.get(reverse("core:landing"))
        self.assertContains(r, 'property="og:title"')
        self.assertContains(r, 'property="og:description"')
        self.assertContains(r, 'property="og:image"')
        self.assertContains(r, 'name="description"')
        # og:image must be ABSOLUTE or crawlers ignore it
        self.assertContains(r, "http://testserver/static/")

    def test_robots_default_stays_noindex(self):
        """The flag defaults OFF: today's behavior does not change until the
        launch decision is made explicitly."""
        r = self.client.get(reverse("core:landing"))
        self.assertContains(r, "noindex")

    @override_settings(SEO_ALLOW_INDEX=True)
    def test_robots_flips_with_the_one_launch_switch(self):
        r = self.client.get(reverse("core:landing"))
        self.assertContains(r, 'content="index, follow"')
        self.assertNotContains(r, "noindex")

    @override_settings(SEO_ALLOW_INDEX=True)
    def test_the_switch_only_opens_the_landing_not_private_pages(self):
        """index/follow is a landing-only override; auth pages must stay
        invisible to crawlers even after launch."""
        r = self.client.get(reverse("accounts:login"))
        self.assertContains(r, "noindex")

    def test_showcase_tabs_are_accessible(self):
        r = self.client.get(reverse("core:landing"))
        self.assertContains(r, 'role="tablist"')
        self.assertContains(r, 'aria-selected="true"', count=1)
        self.assertContains(r, 'aria-selected="false"', count=4)
        self.assertContains(r, 'role="tabpanel"', count=5)

    def test_the_variable_font_actually_ships(self):
        """The design assumed Vazirmatn; the repo shipped an empty folder and
        @font-face rules pointing at nothing. Never again."""
        f = Path(settings.BASE_DIR) / "static" / "fonts" / "Vazirmatn-Variable.woff2"
        self.assertTrue(f.exists(), "font file missing from static/fonts/")
        self.assertGreater(f.stat().st_size, 50_000)
        self.assertEqual(f.read_bytes()[:4], b"wOF2")


class FontResilienceTests(TestCase):
    """v3.2.1: a MISSING font must degrade to the system fallback — never to a
    500 page. Verified live (font deleted → collectstatic OK → landing 200);
    these tests pin the two mechanisms that make that true."""

    def test_missing_manifest_entry_never_raises_in_templates(self):
        from core.storage import ForgivingManifestStaticFilesStorage
        self.assertFalse(
            ForgivingManifestStaticFilesStorage.manifest_strict,
            "manifest_strict=True turns a missing asset into a 500 page",
        )

    def test_css_postprocessing_forgives_a_missing_url(self):
        from core.storage import ForgivingManifestStaticFilesStorage
        s = ForgivingManifestStaticFilesStorage()
        # a file that does not exist anywhere: must come back unchanged,
        # not explode collectstatic
        self.assertEqual(
            s.hashed_name("fonts/DoesNotExist.woff2"),
            "fonts/DoesNotExist.woff2",
        )

    def test_font_face_prefers_a_locally_installed_copy(self):
        css = (Path(settings.BASE_DIR) / "static" / "css" / "app.css").read_text(
            encoding="utf-8"
        )
        self.assertIn('local("Vazirmatn")', css)


@override_settings(SECURE_SSL_REDIRECT=False)
class PerformanceContractTests(TestCase):
    """v3.3.0: the numbers the performance phase measured, pinned so they
    can only regress loudly."""

    def test_landing_hits_the_database_at_most_once(self):
        # measured: 0 queries. Ceiling of 1 leaves room for session touches.
        with self.assertNumQueries(0):
            self.client.get(reverse("core:landing"))

    def test_login_page_hits_the_database_at_most_once(self):
        with self.assertNumQueries(0):
            self.client.get(reverse("accounts:login"))

    def test_dynamic_html_is_gzipped_for_gzip_clients(self):
        r = self.client.get(reverse("core:landing"), HTTP_ACCEPT_ENCODING="gzip")
        self.assertEqual(r.headers.get("Content-Encoding"), "gzip")
        # raw landing HTML is ~31 KB; on the wire it must be a fraction
        self.assertLess(len(r.content), 12_000)

    def test_service_worker_is_never_cacheable(self):
        r = self.client.get("/sw.js")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers.get("Cache-Control"), "no-cache")
        self.assertEqual(r.headers.get("Service-Worker-Allowed"), "/")

    def test_manifest_has_a_short_cache(self):
        r = self.client.get("/manifest.webmanifest")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers.get("Cache-Control"), "max-age=3600")
