"""
v4.8 (فاز E) — LastSeenMiddleware.

Powers the panel's «فعال در ۷/۳۰ روز اخیر» counts with the smallest possible
footprint: a single timestamp per user, refreshed at most once an hour. It is
deliberately *not* a log — no path, no IP, no user-agent — so it adds nothing
that could profile how someone uses the app, in keeping with the project's
zero-knowledge posture. The vault itself stays ciphertext the server can never
read; this only records that an approved account was seen.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone

# Refresh at most once per this window: a busy session becomes one cheap
# single-column UPDATE per hour instead of one write on every request.
THROTTLE = timedelta(hours=1)


class LastSeenMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            now = timezone.now()
            last = getattr(user, "last_seen", None)
            if last is None or (now - last) >= THROTTLE:
                # NOTE: `request.user` is a SimpleLazyObject, so `type(user)`
                # is NOT the User model. Resolve the concrete model class via
                # get_user_model() (called at runtime, not import time, to stay
                # clear of the app registry) and update a single column.
                get_user_model().objects.filter(pk=user.pk).update(last_seen=now)
                user.last_seen = now
        return self.get_response(request)
