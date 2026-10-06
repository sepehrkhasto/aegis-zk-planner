from django.urls import path

from . import panel

app_name = "panel"

urlpatterns = [
    path("", panel.home, name="home"),
    path("users/", panel.users, name="users"),
    path("users/<int:pk>/approve/", panel.user_approve, name="user_approve"),
    path("users/<int:pk>/toggle/", panel.user_toggle_active, name="user_toggle"),
    path("users/<int:pk>/extend/", panel.user_extend_premium, name="user_extend"),
    path("users/<int:pk>/premium/", panel.user_premium_adjust, name="user_premium_adjust"),
    path("users/<int:pk>/premium/log/", panel.user_premium_log, name="user_premium_log"),
    path("auto-approve/", panel.auto_approve_set, name="auto_approve"),
    path("auto-approve/days/", panel.auto_approve_days_set, name="auto_approve_days"),
    path("open-reg/", panel.open_reg_set, name="open_reg"),
    path("reports/", panel.reports, name="reports"),
    path("backup/", panel.backup_page, name="backup"),
    path("backup/export/", panel.backup_export, name="backup_export"),
    path("backup/import/", panel.backup_import, name="backup_import"),
    path("backup/snapshot/<str:name>/", panel.snapshot_download, name="snapshot_download"),
    path("invites/", panel.invites, name="invites"),
    path("invites/<int:pk>/toggle/", panel.invite_toggle, name="invite_toggle"),
    path("feedback/", panel.feedback, name="feedback"),
    path("feedback/<int:pk>/delete/", panel.feedback_delete, name="feedback_delete"),
    path("purchases/", panel.purchases, name="purchases"),
    path("purchases/<int:pk>/toggle/", panel.purchase_toggle, name="purchase_toggle"),
    path("purchases/<int:pk>/delete/", panel.purchase_delete, name="purchase_delete"),
    path("broadcasts/", panel.broadcasts, name="broadcasts"),
    path("broadcasts/<int:pk>/toggle/", panel.broadcast_toggle, name="broadcast_toggle"),
    path("broadcasts/<int:pk>/delete/", panel.broadcast_delete, name="broadcast_delete"),
]
