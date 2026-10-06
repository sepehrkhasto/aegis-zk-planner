from django.urls import path

from . import views

app_name = "vault"

urlpatterns = [
    path("app/", views.app, name="app"),
    path("api/state/", views.state, name="state"),
    path("api/init/", views.init_vault, name="init"),
    path("api/save/", views.save_vault, name="save"),
    path("api/rekey/", views.rekey, name="rekey"),
    path("api/recovery/", views.set_recovery, name="set_recovery"),
    path("api/restore/", views.restore, name="restore"),
    path("api/push/subscribe/", views.push_subscribe, name="push_subscribe"),
    path("api/push/unsubscribe/", views.push_unsubscribe, name="push_unsubscribe"),
    path("api/push/slots/", views.push_slots, name="push_slots"),
]
