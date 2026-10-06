from django.contrib import admin

from .models import EncryptedVault


@admin.register(EncryptedVault)
class EncryptedVaultAdmin(admin.ModelAdmin):
    """Read-only. Deliberately does NOT expose ciphertext for editing — the
    admin can see a vault exists, but its contents are unreadable ciphertext."""

    list_display = ("user", "kdf", "kdf_iterations", "revision", "updated_at")
    readonly_fields = (
        "user",
        "kdf",
        "kdf_iterations",
        "salt",
        "revision",
        "created_at",
        "updated_at",
    )
    fields = readonly_fields  # hides the ciphertext/wrapped_key blobs entirely

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
