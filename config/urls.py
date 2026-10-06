from django.conf import settings
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path(f"{settings.ADMIN_URL}/", admin.site.urls),
    path("panel/", include("accounts.panel_urls")),
    path("", include("core.urls")),
    path("", include("vault.urls")),
    path("accounts/", include("accounts.urls")),
]

handler403 = "core.views.error_403"
handler404 = "core.views.error_404"
handler500 = "core.views.error_500"
