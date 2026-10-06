from django.conf import settings
from django.db import models


class EncryptedVault(models.Model):
    """
    One encrypted vault per user. The server stores ONLY:
      - key-derivation parameters (salt, iterations) — not secret
      - the DEK wrapped by the master-password-derived KEK — useless without
        the master password
      - the AES-256-GCM ciphertext of the whole vault JSON

    The master password, the derived KEK, and the plaintext DEK never reach
    the server. Everything here is opaque base64.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="vault",
        verbose_name="کاربر",
    )

    # Key-derivation metadata (public).
    kdf = models.CharField(max_length=32, default="PBKDF2-SHA256")
    kdf_iterations = models.PositiveIntegerField(default=600000)
    salt = models.TextField()                 # base64

    # DEK wrapped with the KEK (AES-GCM). Unwraps only with the master password.
    wrapped_key = models.TextField()          # base64 ciphertext
    wrapped_key_iv = models.TextField()       # base64 iv

    # Optional: the SAME DEK wrapped a second time by a key derived from the
    # user's printed recovery key. Lets them reset a forgotten master password
    # without the server ever seeing a secret. Empty until the user opts in.
    recovery_salt = models.TextField(blank=True, default="")           # base64
    recovery_wrapped_key = models.TextField(blank=True, default="")    # base64
    recovery_wrapped_key_iv = models.TextField(blank=True, default="") # base64

    # The encrypted vault contents.
    ciphertext = models.TextField(blank=True, default="")     # base64
    ciphertext_iv = models.TextField(blank=True, default="")  # base64

    # Optimistic-concurrency counter to avoid silent overwrites across tabs.
    revision = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "ولت رمزنگاری‌شده"
        verbose_name_plural = "ولت‌های رمزنگاری‌شده"

    def __str__(self) -> str:
        return f"Vault<{self.user}> r{self.revision}"


class PushSubscription(models.Model):
    """One browser/device subscribed to Web Push (v1.11).

    Zero-knowledge stance: pushes are sent WITHOUT a payload (a bare
    "tickle"), so the push service and this server carry no task content.
    The service worker composes the visible text locally from IndexedDB.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="push_subscriptions",
    )
    endpoint = models.URLField(max_length=500, unique=True)
    # Kept for forward-compat (payload encryption, if we ever need it).
    p256dh = models.CharField(max_length=200, blank=True, default="")
    auth = models.CharField(max_length=100, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    last_ok_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "اشتراک پوش"
        verbose_name_plural = "اشتراک‌های پوش"

    def __str__(self) -> str:
        return f"Push<{self.user}> {self.endpoint[:40]}…"


class ReminderSlot(models.Model):
    """A bare reminder timestamp for a user — deliberately content-free.

    The vault is end-to-end encrypted, so the server cannot learn task times
    by itself. The client discloses ONLY the fire times (no ids, titles, or
    kinds) for the near future; a cron sweep sends an empty push for each due
    slot. This is the entire privacy trade of the feature and it is documented
    to the user in Settings and in the Help centre.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="reminder_slots",
    )
    fire_at = models.DateTimeField(db_index=True)
    sent = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "زمان یادآوری"
        verbose_name_plural = "زمان‌های یادآوری"
        indexes = [models.Index(fields=["sent", "fire_at"])]

    def __str__(self) -> str:
        return f"Slot<{self.user}> {self.fire_at:%Y-%m-%d %H:%M} {'✓' if self.sent else ''}"
