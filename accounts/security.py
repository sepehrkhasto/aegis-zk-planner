"""
Login-lockout counters backed by the database cache.

django-ratelimit handles broad per-IP throttling on the endpoints; this module
adds a focused per-username lockout so repeated wrong passwords against one
account get blocked (defence in depth, OWASP brute-force guidance).
"""

from django.conf import settings
from django.core.cache import cache


def client_ip(request) -> str:
    """
    Best-effort client IP. On PythonAnywhere the real client sits behind a
    proxy, so trust the first X-Forwarded-For entry, falling back to REMOTE_ADDR.
    """
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "") or "unknown"


def _key(username: str, ip: str = "") -> str:
    # Key on username *and* IP so an attacker can't lock a victim out of every
    # device just by knowing their username: the counter that trips only
    # affects the attacker's own IP. The victim's own IP keeps a clean counter.
    return f"loginfail:{(username or '').lower()}:{ip or 'noip'}"


def note_failure(username: str, ip: str = "") -> int:
    """Record a failed login for this (username, IP); returns the new count."""
    key = _key(username, ip)
    count = int(cache.get(key, 0)) + 1
    cache.set(key, count, settings.LOGIN_LOCKOUT_DURATION)
    return count


def failure_count(username: str, ip: str = "") -> int:
    return int(cache.get(_key(username, ip), 0))


def clear_failures(username: str, ip: str = "") -> None:
    cache.delete(_key(username, ip))


def is_locked(username: str, ip: str = "") -> bool:
    return failure_count(username, ip) >= settings.LOGIN_LOCKOUT_THRESHOLD
