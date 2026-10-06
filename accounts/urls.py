from django.urls import path

from . import views

app_name = "accounts"

urlpatterns = [
    path("register/", views.register, name="register"),
    path("login/", views.login_view, name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("pending/", views.pending, name="pending"),
    path("profile/", views.profile_update, name="profile"),
    path("purchase/", views.purchase_request, name="purchase"),
    path("subscribe/", views.subscribe, name="subscribe"),
    path("purchase-intent/", views.purchase_intent, name="purchase_intent"),
    path("delete/", views.delete_account, name="delete_account"),
    path("feedback/", views.submit_feedback, name="submit_feedback"),
    path("broadcasts/", views.broadcasts, name="broadcasts"),
]
