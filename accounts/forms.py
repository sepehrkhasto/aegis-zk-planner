from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.password_validation import validate_password
from django.utils import timezone

from .models import InviteCode

User = get_user_model()


class RegistrationForm(UserCreationForm):
    """
    Registration requires a valid invite code. New accounts are created with
    is_approved=False and stay locked out until an admin approves them.
    """

    invite_code = forms.CharField(
        label="کد دعوت",
        max_length=64,
        required=False,          # v5.0: required unless an open window is running
        widget=forms.TextInput(attrs={"autocomplete": "off", "dir": "ltr"}),
        help_text="کد دعوتی که ادمین برایت فرستاده را وارد کن.",
    )

    class Meta:
        model = User
        fields = ("username",)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["username"].label = "نام کاربری"
        self.fields["password1"].label = "رمز ورود"
        self.fields["password2"].label = "تکرار رمز ورود"
        self.fields["password1"].help_text = "حداقل ۱۲ کاراکتر. این رمز فقط برای ورود است."
        self.fields["password1"].widget.attrs["data-eye"] = "1"
        self.fields["password2"].widget.attrs["data-eye"] = "1"
        self.fields["password1"].widget.attrs["dir"] = "ltr"
        self.fields["password2"].widget.attrs["dir"] = "ltr"
        # We validate the invite code once, in clean_invite_code(), and stash
        # the object so save() can consume it.
        self._invite_obj: InviteCode | None = None
        # v5.0 — during an open-registration window the code is genuinely
        # optional, so the field stops being required and says so. Outside the
        # window nothing changes: no code, no account.
        from .models import SiteConfig
        self._open_reg = SiteConfig.get_solo().open_reg_open
        if self._open_reg:
            self.fields["invite_code"].label = "کد دعوت (اختیاری)"
            self.fields["invite_code"].help_text = (
                "ثبت‌نام همین حالا باز است و کد لازم نیست. اگر کد داری وارد کن."
            )

    def clean_username(self):
        username = self.cleaned_data["username"].strip()
        if User.objects.filter(username__iexact=username).exists():
            # Deliberately generic — "unavailable" rather than "already taken" —
            # so it reveals a little less about who is registered. (Registration
            # is invite-gated anyway, so enumeration risk is already low.)
            raise forms.ValidationError(
                "این نام کاربری در دسترس نیست؛ لطفاً نام دیگری انتخاب کنید."
            )
        return username

    def clean_invite_code(self):
        code = (self.cleaned_data.get("invite_code") or "").strip()
        if not code:
            if self._open_reg:
                return ""        # open window: no code needed
            raise forms.ValidationError("کد دعوت لازم است.")
        try:
            invite = InviteCode.objects.get(code=code)
        except InviteCode.DoesNotExist:
            raise forms.ValidationError("کد دعوت نامعتبر است.")
        if not invite.is_usable:
            raise forms.ValidationError("این کد دعوت منقضی یا مصرف‌شده است.")
        self._invite_obj = invite
        return code

    def save(self, commit=True, registered_ip=None):
        user = super().save(commit=False)
        user.is_approved = False          # admin must approve
        user.registered_ip = registered_ip
        if commit:
            from django.db import transaction

            if self._invite_obj is None:
                # v5.0 — open-registration path: there is no code to consume,
                # but the window's account cap must hold under concurrency, so
                # the counter is incremented and re-checked inside the same
                # transaction that creates the user. Without the lock two
                # simultaneous sign-ups could both pass a cap with one slot
                # left.
                from .models import SiteConfig

                with transaction.atomic():
                    cfg = SiteConfig.objects.select_for_update().get(pk=1)
                    if not cfg.open_reg_open:
                        raise forms.ValidationError(
                            "ثبت‌نام باز همین حالا بسته شد. برای ورود کد دعوت لازم است."
                        )
                    user.save()
                    cfg.open_reg_count = cfg.open_reg_count + 1
                    cfg.save(update_fields=["open_reg_count"])
                return user

            # Lock the invite row, re-check usability, and consume it in the
            # same transaction as creating the user. This closes the race where
            # two people redeem a max_uses=1 code at the same instant. On
            # SQLite (PythonAnywhere free tier) the atomic write lock already
            # serializes this; select_for_update makes it correct on Postgres
            # or MySQL too.
            with transaction.atomic():
                invite = (
                    InviteCode.objects.select_for_update()
                    .get(pk=self._invite_obj.pk)
                )
                if not invite.is_usable:
                    raise forms.ValidationError(
                        "این کد دعوت منقضی یا مصرف‌شده است."
                    )
                user.save()
                invite.used_count = invite.used_count + 1
                invite.save(update_fields=["used_count"])
        return user


class LoginForm(forms.Form):
    username = forms.CharField(
        label="نام کاربری",
        max_length=150,
        widget=forms.TextInput(attrs={"autocomplete": "username", "dir": "ltr"}),
    )
    password = forms.CharField(
        label="رمز ورود",
        widget=forms.PasswordInput(attrs={"autocomplete": "current-password", "data-eye": "1", "dir": "ltr"}),
    )
