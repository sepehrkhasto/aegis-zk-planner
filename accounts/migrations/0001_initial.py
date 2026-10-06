import django.contrib.auth.models
import django.contrib.auth.validators
import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models

import accounts.models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.CreateModel(
            name="User",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("password", models.CharField(max_length=128, verbose_name="password")),
                ("last_login", models.DateTimeField(blank=True, null=True, verbose_name="last login")),
                ("is_superuser", models.BooleanField(default=False, help_text="Designates that this user has all permissions without explicitly assigning them.", verbose_name="superuser status")),
                ("username", models.CharField(error_messages={"unique": "A user with that username already exists."}, help_text="Required. 150 characters or fewer. Letters, digits and @/./+/-/_ only.", max_length=150, unique=True, validators=[django.contrib.auth.validators.UnicodeUsernameValidator()], verbose_name="username")),
                ("first_name", models.CharField(blank=True, max_length=150, verbose_name="first name")),
                ("last_name", models.CharField(blank=True, max_length=150, verbose_name="last name")),
                ("email", models.EmailField(blank=True, max_length=254, verbose_name="email address")),
                ("is_staff", models.BooleanField(default=False, help_text="Designates whether the user can log into this admin site.", verbose_name="staff status")),
                ("is_active", models.BooleanField(default=True, help_text="Designates whether this user should be treated as active. Unselect this instead of deleting accounts.", verbose_name="active")),
                ("date_joined", models.DateTimeField(default=django.utils.timezone.now, verbose_name="date joined")),
                ("is_approved", models.BooleanField(default=False, help_text="تا وقتی ادمین تایید نکند، کاربر نمی\u200cتواند وارد شود.", verbose_name="تاییدشده توسط ادمین")),
                ("approved_at", models.DateTimeField(blank=True, null=True, verbose_name="زمان تایید")),
                ("registered_ip", models.GenericIPAddressField(blank=True, null=True, verbose_name="آی\u200cپی ثبت\u200cنام")),
                ("is_premium", models.BooleanField(default=True, help_text="اگر خاموش شود، کاربر تا فعال\u200cسازی مجدد نمی\u200cتواند وارد شود.", verbose_name="اشتراک پریموم فعال")),
                ("premium_until", models.DateField(blank=True, help_text="خالی = بدون تاریخ انقضا. اگر گذشته باشد، دسترسی قطع می\u200cشود.", null=True, verbose_name="اعتبار اشتراک تا")),
                ("groups", models.ManyToManyField(blank=True, help_text="The groups this user belongs to.", related_name="user_set", related_query_name="user", to="auth.group", verbose_name="groups")),
                ("user_permissions", models.ManyToManyField(blank=True, help_text="Specific permissions for this user.", related_name="user_set", related_query_name="user", to="auth.permission", verbose_name="user permissions")),
            ],
            options={
                "verbose_name": "کاربر",
                "verbose_name_plural": "کاربران",
            },
            managers=[
                ("objects", django.contrib.auth.models.UserManager()),
            ],
        ),
        migrations.CreateModel(
            name="Broadcast",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=160, verbose_name="عنوان")),
                ("body", models.TextField(blank=True, max_length=2000, verbose_name="متن")),
                ("level", models.CharField(choices=[("info", "اطلاع\u200cرسانی"), ("success", "خبر خوب"), ("warning", "هشدار")], default="info", max_length=12, verbose_name="نوع")),
                ("is_active", models.BooleanField(default=True, verbose_name="فعال")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "verbose_name": "اعلان سراسری",
                "verbose_name_plural": "اعلان\u200cهای سراسری",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="Feedback",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("category", models.CharField(choices=[("suggestion", "پیشنهاد بهبود"), ("bug", "گزارش مشکل"), ("feature", "قابلیت جدید"), ("collab", "همکاری"), ("other", "سایر")], default="suggestion", max_length=20, verbose_name="دسته")),
                ("message", models.TextField(max_length=4000, verbose_name="پیام")),
                ("rating", models.PositiveSmallIntegerField(blank=True, null=True, verbose_name="امتیاز (۱ تا ۵)")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("is_read", models.BooleanField(default=False, verbose_name="خوانده\u200cشده")),
            ],
            options={
                "verbose_name": "بازخورد",
                "verbose_name_plural": "بازخوردها",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="InviteCode",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(db_index=True, default=accounts.models.generate_invite_code, max_length=64, unique=True, verbose_name="کد دعوت")),
                ("label", models.CharField(blank=True, help_text="یادداشت اختیاری، مثلاً «برای علی».", max_length=120, verbose_name="برچسب")),
                ("max_uses", models.PositiveIntegerField(default=1, verbose_name="حداکثر استفاده")),
                ("used_count", models.PositiveIntegerField(default=0, verbose_name="تعداد استفاده\u200cشده")),
                ("is_active", models.BooleanField(default=True, verbose_name="فعال")),
                ("expires_at", models.DateTimeField(blank=True, null=True, verbose_name="انقضا")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="زمان ساخت")),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_invites", to=settings.AUTH_USER_MODEL, verbose_name="ساخته\u200cشده توسط")),
            ],
            options={
                "verbose_name": "کد دعوت",
                "verbose_name_plural": "کدهای دعوت",
                "ordering": ["-created_at"],
            },
        ),
    ]
