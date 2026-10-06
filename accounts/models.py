import secrets

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.contrib.auth.models import UserManager as DjangoUserManager
from django.db import models
from datetime import timedelta

from django.utils import timezone


def generate_invite_code() -> str:
    """A URL-safe, hard-to-guess invite code (~32 chars)."""
    return secrets.token_urlsafe(24)


class UserManager(DjangoUserManager):
    """`createsuperuser` must yield an account that can actually log in —
    approved from the start, no manual panel step (v1.13.1, فاز A مورد ۳)."""

    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault("is_approved", True)
        extra_fields.setdefault("approved_at", timezone.now())
        return super().create_superuser(username, email, password, **extra_fields)


class User(AbstractUser):
    """
    Custom user with a second gate: `is_approved`.

    Registration requires a valid invite code (spam-proof for a closed group),
    AND an admin must flip `is_approved` before the account can log in. The
    login view enforces the approval check with a clear Persian message.
    """

    is_approved = models.BooleanField(
        default=False,
        verbose_name="تاییدشده توسط ادمین",
        help_text="تا وقتی ادمین تایید نکند، کاربر نمی‌تواند وارد شود.",
    )
    approved_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان تایید")
    registered_ip = models.GenericIPAddressField(
        null=True, blank=True, verbose_name="آی‌پی ثبت‌نام"
    )
    # Premium subscription. Access is invite-only *and* premium; an admin can
    # switch premium off at any time to instantly revoke login without deleting
    # the account or its (encrypted) data.
    is_premium = models.BooleanField(
        default=True,
        verbose_name="اشتراک پریموم فعال",
        help_text="اگر خاموش شود، کاربر تا فعال‌سازی مجدد نمی‌تواند وارد شود.",
    )
    premium_until = models.DateField(
        null=True, blank=True, verbose_name="اعتبار اشتراک تا",
        help_text="خالی = بدون تاریخ انقضا. اگر گذشته باشد، دسترسی فقط‌خواندنی می‌شود.",
    )
    # v4.8 (فاز E): a single coarse "seen" stamp that powers the panel's
    # «فعال ۷/۳۰ روزه» counts. Written at most once an hour by LastSeenMiddleware
    # and deliberately carries nothing else — no path, no IP — so it can't be
    # used to profile behaviour, in keeping with the zero-knowledge posture.
    last_seen = models.DateTimeField(
        null=True, blank=True, verbose_name="آخرین فعالیت",
    )

    objects = UserManager()

    class Meta:
        verbose_name = "کاربر"
        verbose_name_plural = "کاربران"

    def approve(self, days: int = 30) -> None:
        """Approval also starts the subscription.

        `days` is configurable because v5.0 lets each route in set its own
        length: an invite code carries its own `premium_days`, the auto-approve
        window and the open-registration window each carry theirs. The default
        stays 30 so every existing caller behaves exactly as before.

        Staff/superusers are exempt from any window: their premium is
        open-ended (`premium_until=None` → «بدون تاریخ انقضا»). v1.13.1 فاز A."""
        if not self.is_approved:
            self.is_approved = True
            self.approved_at = timezone.now()
            self.is_premium = True
            if not (self.is_staff or self.is_superuser):
                self.premium_until = timezone.now().date() + timedelta(days=days)
            self.save(update_fields=[
                "is_approved", "approved_at", "is_premium", "premium_until",
            ])

    def extend_premium(self, days: int = 30) -> None:
        """Add `days` to the subscription (from today or from the current
        expiry, whichever is later), re-enabling access if it had lapsed."""
        today = timezone.now().date()
        base = self.premium_until if (self.premium_until and self.premium_until > today) else today
        self.is_premium = True
        self.premium_until = base + timedelta(days=days)
        self.save(update_fields=["is_premium", "premium_until"])

    def adjust_premium(self, delta_days: int) -> None:
        """Add or remove subscription days (v1.10 admin tooling).

        Positive deltas behave like extend_premium. Negative deltas subtract
        from the current expiry; if that lands in the past, the subscription
        simply lapses via `premium_active` — nothing is deleted, so a later
        positive adjustment restores access with the data untouched.
        """
        if delta_days >= 0:
            self.extend_premium(delta_days)
            return
        today = timezone.now().date()
        base = self.premium_until if self.premium_until else today
        self.premium_until = base + timedelta(days=delta_days)  # delta negative
        self.save(update_fields=["premium_until"])

    @property
    def premium_days_left(self):
        """Whole days of subscription remaining; None = no expiry date set.
        Staff/superusers always return None so every UI shows «بدون تاریخ انقضا»."""
        if self.is_staff or self.is_superuser:
            return None
        if not self.premium_active or self.premium_until is None:
            return None
        return (self.premium_until - timezone.now().date()).days

    @property
    def premium_active(self) -> bool:
        """True only if premium is on and not past its expiry date.

        Staff/superusers are always premium: the gate exists to manage paying
        members, not to lock admins out of their own product. Because both the
        login view and `vault.premium_required` read this property, the staff
        bypass applies everywhere from this one place (v1.13.1, فاز A مورد ۴)."""
        if self.is_staff or self.is_superuser:
            return True
        if not self.is_premium:
            return False
        if self.premium_until is not None:
            return self.premium_until >= timezone.now().date()
        return True

    # ----------------------------------------------------------------------- #
    # v4.8 (فاز F) — read-only-after-expiry.
    #
    # We split the old "premium or nothing" gate into two questions so an
    # expired subscription no longer locks people out of their own (encrypted)
    # data. It just freezes writing.
    #
    #   • can_open_app   — may this account open the vault at all?
    #   • read_only_access — it opens, but every write is refused.
    #
    # The distinction is deliberate: `is_premium=False` is the admin
    # kill-switch (a hard, immediate revoke — unchanged from before), whereas a
    # simply *expired* `premium_until` now degrades to read-only rather than a
    # closed door. Staff/superusers are always full-access.
    # ----------------------------------------------------------------------- #
    @property
    def can_open_app(self) -> bool:
        """True if the account may open the vault — in full OR read-only mode.
        Only a *hard* block closes the door: the admin kill-switch
        (`is_premium=False`), an unapproved account, or a disabled one."""
        if self.is_staff or self.is_superuser:
            return True
        if not (self.is_active and self.is_approved):
            return False
        return self.is_premium

    @property
    def read_only_access(self) -> bool:
        """True when the vault opens but writes are frozen: the account is
        allowed in (`can_open_app`) yet the subscription has lapsed."""
        return self.can_open_app and not self.premium_active


class InviteCode(models.Model):
    """
    An admin-issued code required to register. Limited uses + optional expiry.
    Because the group is small and closed, this removes the need for email
    verification entirely (handy on PythonAnywhere's restricted free tier).
    """

    code = models.CharField(
        max_length=64,
        unique=True,
        default=generate_invite_code,
        db_index=True,
        verbose_name="کد دعوت",
    )
    label = models.CharField(
        max_length=120,
        blank=True,
        verbose_name="برچسب",
        help_text="یادداشت اختیاری، مثلاً «برای علی».",
    )
    max_uses = models.PositiveIntegerField(default=1, verbose_name="حداکثر استفاده")
    used_count = models.PositiveIntegerField(default=0, verbose_name="تعداد استفاده‌شده")
    is_active = models.BooleanField(default=True, verbose_name="فعال")
    expires_at = models.DateTimeField(null=True, blank=True, verbose_name="انقضا")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_invites",
        verbose_name="ساخته‌شده توسط",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="زمان ساخت")

    # ------------------------------------------------------------------ #
    # v5.0 — per-code automation.
    #
    # Approval and subscription length used to be global, one-size rules.
    # They are now properties of the code itself, so a code handed to a
    # trusted colleague can skip the queue while a code posted publicly
    # still lands in it — without touching a global switch that affects
    # everyone.
    # ------------------------------------------------------------------ #
    auto_approve = models.BooleanField(
        default=False, verbose_name="تایید خودکار",
        help_text="اگر روشن باشد، کسی که با این کد ثبت‌نام کند بدون تایید دستی فعال می‌شود.",
    )
    auto_approve_until = models.DateTimeField(
        null=True, blank=True, verbose_name="تایید خودکار تا",
        help_text="خالی = بدون محدودیت زمانی. اگر پر باشد، بعد از این زمان دوباره تایید دستی لازم می‌شود.",
    )
    premium_days = models.PositiveIntegerField(
        default=30, verbose_name="روزهای اشتراک",
        help_text="چند روز اشتراک به کسی که با این کد ثبت‌نام می‌کند داده شود.",
    )

    class Meta:
        verbose_name = "کد دعوت"
        verbose_name_plural = "کدهای دعوت"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.code} ({self.used_count}/{self.max_uses})"

    @property
    def is_expired(self) -> bool:
        return self.expires_at is not None and timezone.now() >= self.expires_at

    @property
    def is_usable(self) -> bool:
        return self.is_active and not self.is_expired and self.used_count < self.max_uses

    @property
    def auto_approve_open(self) -> bool:
        """True when registering with this code should skip the approval queue.

        The switch and its deadline are separate on purpose: turning the switch
        off is immediate and permanent, while the deadline lets a code be
        'trusted for the next two hours' and quietly fall back to manual
        approval afterwards with nothing left to remember to undo."""
        if not self.auto_approve:
            return False
        if self.auto_approve_until is None:
            return True
        return timezone.now() < self.auto_approve_until

    def consume(self) -> None:
        """Atomically record one use of this code."""
        InviteCode.objects.filter(pk=self.pk).update(used_count=models.F("used_count") + 1)


class PremiumLog(models.Model):
    """Audit trail for every premium change (v1.10). Answers "who gave this
    user those 60 days and why" months later — the difference between a toy
    admin page and one you can trust with paying customers."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="premium_logs", verbose_name="کاربر",
    )
    admin = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="premium_actions",
        verbose_name="ادمین",
    )
    delta_days = models.IntegerField(verbose_name="تغییر (روز)")  # +/- days
    reason = models.CharField(max_length=200, blank=True, verbose_name="دلیل")
    until_after = models.DateField(null=True, blank=True, verbose_name="اعتبار پس از تغییر")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "تغییر اشتراک"
        verbose_name_plural = "تاریخچه‌ی اشتراک"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        sign = "+" if self.delta_days >= 0 else ""
        return f"{self.user.username}: {sign}{self.delta_days}d ({self.created_at:%Y-%m-%d})"


class Feedback(models.Model):
    """Anonymous feedback / suggestions / collaboration interest. Deliberately
    NOT linked to a user, so it can't be traced back — only a coarse category
    and free text. Staff can read these in the panel."""

    CATEGORY_CHOICES = [
        ("suggestion", "پیشنهاد بهبود"),
        ("bug", "گزارش مشکل"),
        ("feature", "قابلیت جدید"),
        ("collab", "همکاری"),
        ("other", "سایر"),
    ]
    category = models.CharField(
        max_length=20, choices=CATEGORY_CHOICES, default="suggestion",
        verbose_name="دسته",
    )
    message = models.TextField(max_length=4000, verbose_name="پیام")
    rating = models.PositiveSmallIntegerField(
        null=True, blank=True, verbose_name="امتیاز (۱ تا ۵)",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False, verbose_name="خوانده‌شده")

    class Meta:
        verbose_name = "بازخورد"
        verbose_name_plural = "بازخوردها"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.get_category_display()} — {self.created_at:%Y-%m-%d}"


class Broadcast(models.Model):
    """A global announcement from an admin, shown in every user's notification
    center. Not encrypted (it's public to all members), so the server can store
    and serve it directly. Read-state is tracked client-side."""

    LEVEL_CHOICES = [
        ("info", "اطلاع‌رسانی"),
        ("success", "خبر خوب"),
        ("warning", "هشدار"),
    ]
    title = models.CharField(max_length=160, verbose_name="عنوان")
    body = models.TextField(max_length=2000, blank=True, verbose_name="متن")
    level = models.CharField(max_length=12, choices=LEVEL_CHOICES, default="info", verbose_name="نوع")
    is_active = models.BooleanField(default=True, verbose_name="فعال")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "اعلان سراسری"
        verbose_name_plural = "اعلان‌های سراسری"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.title} ({self.get_level_display()})"


class PurchaseRequest(models.Model):
    """v1.18 (فاز H مورد ۴۴): someone asking to buy a subscription.

    Deliberately minimal and public-facing: three plain contact fields, no
    account required, nothing that touches a vault. Staff see them in the
    panel and follow up on Telegram."""

    name = models.CharField(max_length=80, verbose_name="نام")
    email = models.EmailField(blank=True, verbose_name="ایمیل")
    phone = models.CharField(max_length=30, verbose_name="شماره تماس")
    note = models.CharField(max_length=300, blank=True, verbose_name="توضیح")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="زمان ثبت")
    handled = models.BooleanField(default=False, verbose_name="رسیدگی شد")

    class Meta:
        verbose_name = "درخواست خرید"
        verbose_name_plural = "درخواست‌های خرید"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.name} · {self.phone}"


_FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹"


def fa_num(n) -> str:
    """Format an integer with thousands separators in Persian digits."""
    return "".join(_FA_DIGITS[int(c)] if c.isdigit() else c for c in f"{int(n):,}")


class SiteConfig(models.Model):
    """v4.8 (فاز E): a single global settings row (always pk=1).

    Right now it holds only the *auto-registration window*: while
    `auto_approve_until` is in the future, new sign-ups skip the manual
    approval queue and are approved (and given the same 30-day premium as a
    hand-approval) the instant they register. Outside the window everything
    behaves exactly as before — invite-gated, then admin-approved.
    """

    auto_approve_until = models.DateTimeField(
        null=True, blank=True, verbose_name="ثبت‌نام خودکار تا",
        help_text="تا این زمان، ثبت‌نام‌های جدید بدون نیاز به تایید دستی فعال می‌شوند.",
    )
    auto_approve_days = models.PositiveIntegerField(
        default=30, verbose_name="روزهای اشتراک (تایید خودکار)",
        help_text="چند روز اشتراک به کسی که در پنجره‌ی تایید خودکار ثبت‌نام می‌کند داده شود.",
    )

    # ------------------------------------------------------------------ #
    # v5.0 — the open registration window: no invite code at all.
    #
    # This is the widest door the product has. It exists for testing,
    # seeding the first users, and short promotional pushes ("open for the
    # next two hours"). Because it is genuinely the largest attack surface
    # here, it ships with three brakes rather than one:
    #
    #   • a deadline, capped at 24h (a normal window is minutes or hours)
    #   • a hard cap on how many accounts it may create
    #   • a counter, so the cap is enforced and afterwards auditable
    #
    # Approval stays independently switchable: an open window can still feed
    # the manual queue if you only want to drop the invite requirement.
    # ------------------------------------------------------------------ #
    open_reg_until = models.DateTimeField(
        null=True, blank=True, verbose_name="ثبت‌نام بدون کد دعوت تا",
        help_text="تا این زمان، ثبت‌نام بدون کد دعوت ممکن است. حداکثر ۲۴ ساعت.",
    )
    open_reg_needs_approval = models.BooleanField(
        default=False, verbose_name="ثبت‌نام باز نیاز به تایید دارد",
        help_text="اگر روشن باشد، بدون کد دعوت ثبت‌نام می‌شود ولی باز هم تایید دستی لازم است.",
    )
    open_reg_days = models.PositiveIntegerField(
        default=7, verbose_name="روزهای اشتراک (ثبت‌نام باز)",
        help_text="چند روز اشتراک به کسی که بدون کد دعوت ثبت‌نام می‌کند داده شود.",
    )
    open_reg_max = models.PositiveIntegerField(
        default=50, verbose_name="سقف حساب‌های ثبت‌نام باز",
        help_text="وقتی این تعداد حساب در پنجره ساخته شد، پنجره خودکار بسته می‌شود.",
    )
    open_reg_count = models.PositiveIntegerField(
        default=0, verbose_name="ساخته‌شده در پنجره‌ی فعلی",
    )
    # v4.9 — subscription pricing, editable in the admin so prices never
    # require a deploy. Stored in Toman as whole numbers (no float money).
    # These are prices, not entitlements: paying is arranged out-of-band and
    # an admin extends the account, so nothing here touches a vault.
    price_1m = models.PositiveIntegerField(
        default=69000, verbose_name="قیمت ۱ ماهه (تومان)")
    price_3m = models.PositiveIntegerField(
        default=189000, verbose_name="قیمت ۳ ماهه (تومان)")
    price_6m = models.PositiveIntegerField(
        default=339000, verbose_name="قیمت ۶ ماهه (تومان)")
    price_12m = models.PositiveIntegerField(
        default=599000, verbose_name="قیمت ۱۲ ماهه (تومان)")
    telegram_id = models.CharField(
        max_length=64, default="", blank=True, verbose_name="آیدی تلگرام پشتیبانی",
        help_text="برای دکمه‌ی «خرید از تلگرام» در صفحه‌ی اشتراک.")
    gateway_enabled = models.BooleanField(
        default=False, verbose_name="درگاه پرداخت فعال است",
        help_text="تا وقتی خاموش است، دکمه‌ی درگاه «به‌زودی» نشان داده می‌شود.")

    updated_at = models.DateTimeField(auto_now=True, verbose_name="آخرین تغییر")
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+", verbose_name="تغییر توسط",
    )

    class Meta:
        verbose_name = "تنظیمات سایت"
        verbose_name_plural = "تنظیمات سایت"

    def __str__(self) -> str:
        return "تنظیمات سایت"

    def save(self, *args, **kwargs):
        self.pk = 1                      # enforce a single row
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        # A singleton is never deleted — clearing the window is done by setting
        # auto_approve_until back to None, not by removing the row.
        pass

    @classmethod
    def get_solo(cls) -> "SiteConfig":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    @property
    def auto_approve_open(self) -> bool:
        return (
            self.auto_approve_until is not None
            and timezone.now() < self.auto_approve_until
        )

    @property
    def open_reg_open(self) -> bool:
        """True when someone may register with no invite code at all.

        All three brakes are checked together, so whichever trips first
        closes the door: the deadline, or the account cap."""
        if self.open_reg_until is None:
            return False
        if timezone.now() >= self.open_reg_until:
            return False
        return self.open_reg_count < self.open_reg_max

    @property
    def open_reg_left(self) -> int:
        """How many accounts the open window will still admit."""
        return max(0, self.open_reg_max - self.open_reg_count)

    def plans(self):
        """The four subscription options, with the arithmetic already done.

        Each plan reports its monthly equivalent and how much it saves against
        paying month-to-month — the two numbers someone actually compares.
        Computed here rather than in the template so the page can't drift from
        the prices, and so the same figures are available anywhere else."""
        base = self.price_1m
        rows = [
            ("1m", 1, self.price_1m, "۱ ماهه", "1 month"),
            ("3m", 3, self.price_3m, "۳ ماهه", "3 months"),
            ("6m", 6, self.price_6m, "۶ ماهه", "6 months"),
            ("12m", 12, self.price_12m, "۱۲ ماهه", "12 months"),
        ]
        out = []
        for key, months, price, fa, en in rows:
            per_month = round(price / months) if months else price
            full = base * months
            save_pct = round((full - price) / full * 100) if full and price < full else 0
            out.append({
                "key": key, "months": months, "price": price,
                "per_month": per_month, "save_pct": save_pct,
                "label_fa": fa, "label_en": en,
                "best": key == "12m",
                # Pre-formatted for display: Persian digits with thousands
                # separators. The page renders Persian by default and the
                # English applier swaps these for Latin, same as every other
                # string on a server-rendered page.
                "price_fa": fa_num(price),
                "price_en": f"{price:,}",
                "per_month_fa": fa_num(per_month),
                "per_month_en": f"{per_month:,}",
                "months_fa": fa_num(months),
                "save_fa": fa_num(save_pct),
            })
        return out


class RegistrationEvent(models.Model):
    """v5.0 — how each account got in.

    Registration now has four routes with different trust levels, so "who is
    this person and why were they let in?" stops being answerable from the
    user row alone. One row per sign-up records the route, the invite code if
    any, whether approval was skipped, and how many days were granted.

    This is an audit trail, not analytics: it holds no vault data and nothing
    about what the person does afterwards.
    """

    ROUTE_INVITE = "invite"          # invite code, manual approval (the classic path)
    ROUTE_INVITE_AUTO = "invite_auto"  # invite code whose own auto-approve was open
    ROUTE_WINDOW = "window"          # invite code + the global auto-approve window
    ROUTE_OPEN = "open"              # no invite code at all — the open window
    ROUTES = [
        (ROUTE_INVITE, "کد دعوت + تایید دستی"),
        (ROUTE_INVITE_AUTO, "کد دعوت با تایید خودکار"),
        (ROUTE_WINDOW, "پنجره‌ی تایید خودکار"),
        (ROUTE_OPEN, "ثبت‌نام باز (بدون کد)"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL,
        related_name="registration_events", verbose_name="کاربر",
    )
    username = models.CharField(max_length=150, verbose_name="نام کاربری")
    route = models.CharField(max_length=20, choices=ROUTES, verbose_name="مسیر ثبت‌نام")
    invite_code = models.CharField(max_length=64, blank=True, verbose_name="کد دعوت")
    auto_approved = models.BooleanField(default=False, verbose_name="تایید خودکار شد")
    premium_days = models.PositiveIntegerField(default=0, verbose_name="روزهای اشتراک")
    registered_ip = models.GenericIPAddressField(null=True, blank=True, verbose_name="IP")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="زمان")

    class Meta:
        verbose_name = "رویداد ثبت‌نام"
        verbose_name_plural = "رویدادهای ثبت‌نام"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["-created_at"])]

    def __str__(self) -> str:
        return f"{self.username} · {self.get_route_display()}"


class PurchaseIntent(models.Model):
    """v5.0 — someone reached for a plan.

    The subscription page previously sent people to Telegram and left no trace,
    so "how many wanted to buy, and which plan?" was unanswerable. This records
    the reach, not the sale: a click on the Telegram button with the plan that
    was selected at that moment.

    Deliberately thin — the account and the plan. No page analytics, no
    fingerprint, nothing about the vault.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL,
        related_name="purchase_intents", verbose_name="کاربر",
    )
    username = models.CharField(max_length=150, blank=True, verbose_name="نام کاربری")
    plan = models.CharField(max_length=8, verbose_name="پلن")
    price = models.PositiveIntegerField(default=0, verbose_name="قیمت (تومان)")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="زمان")

    class Meta:
        verbose_name = "قصد خرید"
        verbose_name_plural = "قصدهای خرید"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["-created_at"])]

    def __str__(self) -> str:
        return f"{self.username or '—'} · {self.plan}"
