from pathlib import Path

from django.conf import settings
from django.http import HttpResponse
from django.shortcuts import redirect, render


def landing(request):
    """Public home page. Authenticated users go straight to the app."""
    if request.user.is_authenticated:
        return redirect("vault:app")
    # v3.2: Open Graph needs ABSOLUTE URLs. This is what makes the link look
    # like a real product when it is shared in Telegram (where every purchase
    # conversation happens) instead of a bare grey URL.
    from django.templatetags.static import static as static_url
    return render(request, "core/landing.html", {
        "purchase_telegram": settings.PURCHASE_TELEGRAM,
        "seo_index": settings.SEO_ALLOW_INDEX,
        "og_image": request.build_absolute_uri(static_url("pwa/icon-512.png")),
        "og_url": request.build_absolute_uri("/"),
    })


def about(request):
    """Public page explaining the zero-knowledge security model."""
    return render(request, "core/about.html")


def whoami(request):
    """v3.4.2 — what the heart in the footer opens.

    The old /team/ page tried to be an "about the team" page for a team of
    one. This is the honest version: a terminal, one command, one name.
    """
    return render(request, "core/whoami.html")


# --- Persian error pages ---------------------------------------------------- #
def error_403(request, exception=None):
    return render(request, "errors/403.html", status=403)


def error_404(request, exception=None):
    return render(request, "errors/404.html", status=404)


def error_500(request):
    return render(request, "errors/500.html", status=500)


def _static_file(relpath, content_type):
    path = Path(settings.BASE_DIR) / "static" / relpath
    return HttpResponse(path.read_bytes(), content_type=content_type)


def service_worker(request):
    resp = _static_file("pwa/sw.js", "application/javascript")
    resp["Service-Worker-Allowed"] = "/"
    # v3.3: the worker file must never be stale — a cached sw.js means a
    # version bump (aegis-vXYZ) silently fails to roll out through proxies.
    resp["Cache-Control"] = "no-cache"
    return resp


def manifest(request):
    resp = _static_file("pwa/manifest.webmanifest", "application/manifest+json")
    resp["Cache-Control"] = "max-age=3600"  # v3.3: cheap to revalidate hourly
    return resp
