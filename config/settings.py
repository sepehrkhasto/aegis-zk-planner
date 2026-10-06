"""
Django settings for the secure zero-knowledge planner.

Security posture (OWASP-aligned):
  - Secrets and DEBUG come from environment variables (never hard-coded).
  - Argon2 is the primary password hasher.
  - Cookies are Secure + HttpOnly + SameSite.
  - HSTS, referrer policy, nosniff, and a strict Content-Security-Policy.
  - A database cache backs rate limiting and login-lockout counters
    (survives worker reloads on a single-worker PythonAnywhere web app).

The server is a "blind" store: user content is encrypted client-side with
AES-256-GCM and only the ciphertext blob ever reaches this backend.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Load a local .env file if present (dev convenience; on PythonAnywhere you can
# also set these in the WSGI file or the .env at project root).
load_dotenv(BASE_DIR / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    raw = os.environ.get(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


# --------------------------------------------------------------------------- #
# Core
# --------------------------------------------------------------------------- #
# SECURITY: keep the real key out of source control. Set DJANGO_SECRET_KEY in
# the environment for production. The fallback is deliberately unusable-looking
# so a missing key in production fails loudly rather than silently.
INSECURE_FALLBACK_KEY = "dev-only-insecure-key-change-me-in-production"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", INSECURE_FALLBACK_KEY)

DEBUG = env_bool("DJANGO_DEBUG", default=False)

# v2.0 (فاز J audit): the comment above used to claim this "fails loudly", but
# it did not — a production deploy that forgot DJANGO_SECRET_KEY silently ran
# on a key that is public in this repository, which would let anyone forge
# session cookies. Now it actually refuses to start.
if not DEBUG and SECRET_KEY == INSECURE_FALLBACK_KEY:
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY is not set. Generate one with "
        "`python -c \"import secrets; print(secrets.token_urlsafe(64))\"` "
        "and put it in the environment (or .env) before running with DEBUG=False."
    )

# The Django admin lives at a hard-to-guess path so casual visitors (and bots
# hammering /admin/) never find it. Override in production with DJANGO_ADMIN_URL
# (no leading/trailing slash), e.g. DJANGO_ADMIN_URL="control-7f3a".
ADMIN_URL = os.environ.get("DJANGO_ADMIN_URL", "control-panel-x7").strip("/")

# e.g. "yourname.pythonanywhere.com,localhost,127.0.0.1"
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

# Dev convenience: with DEBUG on, accept any host so you can open the app from
# a phone on the same LAN (python manage.py runserver 0.0.0.0:8000 → visit
# http://<pc-ip>:8000). NOTE: the vault itself still needs a secure context
# (HTTPS or localhost) because WebCrypto is unavailable on plain http over a
# LAN IP — the app now shows a clear message in that case. See docs/fa/setup-local-windows.fa.md.
if DEBUG:
    ALLOWED_HOSTS = ["*"]

# v1.18 (فاز H مورد ۴۴): Telegram handle shown on the buy form. Set
# PURCHASE_TELEGRAM in the environment; the default is only a placeholder.
PURCHASE_TELEGRAM = os.environ.get("PURCHASE_TELEGRAM", "")

# v3.2: the whole site ships noindex by default (a private, invite-only tool
# should not surprise anyone by appearing in Google). When the product is
# ready for public launch, set SEO_ALLOW_INDEX=1 and ONLY the public landing
# flips to "index, follow" — the app, panel and auth pages stay noindex.
SEO_ALLOW_INDEX = env_bool("SEO_ALLOW_INDEX", default=False)

# CSRF trusted origins must include scheme, e.g. "https://yourname.pythonanywhere.com"
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", "")


# --------------------------------------------------------------------------- #
# Applications
# --------------------------------------------------------------------------- #
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Local apps
    "accounts",
    "core",
    "vault",
]

MIDDLEWARE = [
    # v3.3 (فاز پرفورمنس): dynamic HTML/JSON goes over the wire gzipped
    # (~4-5× smaller; the landing drops from ~31 KB to ~7 KB). Django's
    # masked CSRF tokens defuse the classic BREACH concern.
    "django.middleware.gzip.GZipMiddleware",
    "django.middleware.security.SecurityMiddleware",
    # v3.3: collectstatic has been producing .br/.gz next to every hashed
    # asset since v3.0 — but nothing served them. WhiteNoise negotiates
    # Brotli/gzip and adds immutable far-future caching for hashed files,
    # on ANY host (PythonAnywhere, Runflare, bare gunicorn). app.css:
    # 232 KB raw → 42 KB brotli, guaranteed instead of host-dependent.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    # v4.8 (فاز E): coarse last-activity stamp for the panel's active counts.
    # Sits right after auth so request.user is populated; throttled to 1/hour.
    "accounts.middleware.LastSeenMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "csp.middleware.CSPMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# --------------------------------------------------------------------------- #
# Database — SQLite is plenty for a closed 2–15 user group and lightest on PA.
# --------------------------------------------------------------------------- #
# On cloud hosts with ephemeral filesystems (e.g. Runflare) the SQLite file
# must live inside a folder that has a persistent DISK bound to it, or it will
# be wiped on every restart/redeploy. Set DJANGO_DB_DIR=/app/database on the
# host and bind a disk to /app/database. Locally this defaults to BASE_DIR,
# so nothing changes for development or PythonAnywhere.
DB_DIR = Path(os.environ.get("DJANGO_DB_DIR", BASE_DIR))
try:
    DB_DIR.mkdir(parents=True, exist_ok=True)
except OSError:
    pass

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": DB_DIR / "db.sqlite3",
    }
}


# --------------------------------------------------------------------------- #
# Cache — database-backed so rate-limit / lockout counters persist across the
# single web worker. Run:  python manage.py createcachetable
# --------------------------------------------------------------------------- #
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.db.DatabaseCache",
        "LOCATION": "app_cache_table",
    }
}


# --------------------------------------------------------------------------- #
# Authentication
# --------------------------------------------------------------------------- #
AUTH_USER_MODEL = "accounts.User"

LOGIN_URL = "accounts:login"
LOGIN_REDIRECT_URL = "vault:app"
LOGOUT_REDIRECT_URL = "accounts:login"

# Argon2 first (OWASP-recommended), with PBKDF2 kept for fallback/compat.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 12},
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


# --------------------------------------------------------------------------- #
# Internationalization — Persian / Tehran, RTL by default in templates.
# --------------------------------------------------------------------------- #
LANGUAGE_CODE = "fa"
TIME_ZONE = "Asia/Tehran"
USE_I18N = True
USE_TZ = True


# --------------------------------------------------------------------------- #
# Static files
# --------------------------------------------------------------------------- #
STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"

# WhiteNoise lets the app serve its own static files under gunicorn (needed on
# Runflare; harmless elsewhere). Activated only when the package is installed,
# so an old local venv without it keeps working unchanged.
try:
    import whitenoise  # noqa: F401
    MIDDLEWARE.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")
except ImportError:
    pass

# NOTE: the STORAGES block below is the only one. An earlier version also set
# STORAGES inside the try above, and this one silently overwrote it — which is
# why compression never actually ran. Compression now lives in the storage
# class itself (core/storage.py).

# Hashed filenames in production → safe to cache static assets for a year and
# users always get fresh files after a deploy (no more hard refresh).
STORAGES = {
    "staticfiles": {
        "BACKEND": (
            "core.storage.ForgivingManifestStaticFilesStorage"
            if not DEBUG else
            "django.contrib.staticfiles.storage.StaticFilesStorage"
        )
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# --------------------------------------------------------------------------- #
# Sessions
# --------------------------------------------------------------------------- #
SESSION_COOKIE_AGE = 60 * 60 * 8            # 8 hours
SESSION_SAVE_EVERY_REQUEST = True           # sliding expiry
SESSION_EXPIRE_AT_BROWSER_CLOSE = False


# --------------------------------------------------------------------------- #
# Security headers / transport
# In production (DJANGO_DEBUG=False) these are all enforced. On PythonAnywhere
# HTTPS is provided on the *.pythonanywhere.com domain.
# --------------------------------------------------------------------------- #
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000          # 1 year
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
else:
    SECURE_SSL_REDIRECT = False
    SESSION_COOKIE_SECURE = False
    CSRF_COOKIE_SECURE = False

# ---- Web Push (v1.11) — VAPID keys from the environment -------------------
# Generate once with `python manage.py gen_vapid_keys`. Empty = feature off
# (the UI hides the toggle when no public key is exposed).
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:admin@example.com")

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Lax"

# Additional hardening headers (safe in every environment).
X_FRAME_OPTIONS = "DENY"                       # app is never framed → block clickjacking
SECURE_CONTENT_TYPE_NOSNIFF = True             # no MIME sniffing
SECURE_REFERRER_POLICY = "same-origin"         # don't leak URLs to third parties
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"


# --------------------------------------------------------------------------- #
# Content-Security-Policy (django-csp 3.x style).
# Strict: everything self-hosted, no inline scripts/styles, no eval.
# This is why we use vanilla JS + external CSS/JS files (no Alpine/CDN).
# --------------------------------------------------------------------------- #
CSP_DEFAULT_SRC = ("'self'",)
CSP_SCRIPT_SRC = ("'self'",)
CSP_STYLE_SRC = ("'self'",)
CSP_IMG_SRC = ("'self'", "data:")
CSP_FONT_SRC = ("'self'",)
CSP_CONNECT_SRC = ("'self'",)
CSP_BASE_URI = ("'self'",)
CSP_FORM_ACTION = ("'self'",)
CSP_FRAME_ANCESTORS = ("'none'",)
CSP_OBJECT_SRC = ("'none'",)
CSP_WORKER_SRC = ("'self'",)              # service worker (PWA)
CSP_MANIFEST_SRC = ("'self'",)           # web app manifest (PWA)


# --------------------------------------------------------------------------- #
# Rate limiting (django-ratelimit) — tuned in accounts.views / accounts.security
# --------------------------------------------------------------------------- #
RATELIMIT_VIEW = "accounts.views.ratelimited"

# Login lockout policy (see accounts.security)
LOGIN_LOCKOUT_THRESHOLD = 5                 # failed attempts before lock
LOGIN_LOCKOUT_DURATION = 60 * 15            # lock for 15 minutes


# --------------------------------------------------------------------------- #
# Logging — never log request bodies / credentials.
# --------------------------------------------------------------------------- #
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "simple": {"format": "[{levelname}] {asctime} {name}: {message}", "style": "{"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "simple"},
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django.security": {"handlers": ["console"], "level": "WARNING", "propagate": False},
    },
}
