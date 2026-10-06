from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils import timezone

from .models import Broadcast, Feedback, InviteCode, SiteConfig, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = (
        "username",
        "is_approved",
        "is_active",
        "is_staff",
        "date_joined",
        "last_seen",
        "registered_ip",
    )
    list_filter = ("is_approved", "is_active", "is_staff")
    actions = ["approve_selected"]

    # Extend the stock UserAdmin fieldsets with our approval fields.
    fieldsets = BaseUserAdmin.fieldsets + (
        ("تایید دسترسی", {"fields": ("is_approved", "approved_at", "registered_ip", "last_seen")}),
    )
    readonly_fields = ("approved_at", "registered_ip", "last_seen")

    @admin.action(description="تایید کاربران انتخاب‌شده")
    def approve_selected(self, request, queryset):
        updated = queryset.filter(is_approved=False).update(
            is_approved=True, approved_at=timezone.now()
        )
        self.message_user(request, f"{updated} کاربر تایید شد.")


@admin.register(InviteCode)
class InviteCodeAdmin(admin.ModelAdmin):
    list_display = (
        "code",
        "label",
        "used_count",
        "max_uses",
        "is_active",
        "expires_at",
        "created_at",
    )
    list_filter = ("is_active",)
    search_fields = ("code", "label")
    readonly_fields = ("used_count", "created_at", "created_by")

    def save_model(self, request, obj, form, change):
        if not change and obj.created_by is None:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(Feedback)
class FeedbackAdmin(admin.ModelAdmin):
    list_display = ("category", "rating", "is_read", "created_at")
    list_filter = ("category", "is_read")
    readonly_fields = ("category", "message", "rating", "created_at")
    search_fields = ("message",)


@admin.register(Broadcast)
class BroadcastAdmin(admin.ModelAdmin):
    list_display = ("title", "level", "is_active", "created_at")
    list_filter = ("level", "is_active")


@admin.register(SiteConfig)
class SiteConfigAdmin(admin.ModelAdmin):
    """v4.8 (فاز E) — the single-row site config (auto-registration window)."""
    list_display = ("__str__", "auto_approve_until", "telegram_id",
                    "gateway_enabled", "updated_at", "updated_by")
    readonly_fields = ("updated_at", "updated_by")
    fieldsets = (
        ("ثبت‌نام", {"fields": ("auto_approve_until",)}),
        ("قیمت اشتراک (تومان)", {
            "fields": ("price_1m", "price_3m", "price_6m", "price_12m"),
            "description": "قیمت‌ها بدون نیاز به دیپلوی تغییر می‌کنند.",
        }),
        ("پرداخت", {"fields": ("telegram_id", "gateway_enabled")}),
        ("سوابق", {"fields": ("updated_at", "updated_by")}),
    )

    def has_add_permission(self, request):
        # Singleton: never more than the one row.
        return not SiteConfig.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False
