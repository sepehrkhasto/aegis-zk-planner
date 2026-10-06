from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="PremiumLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("delta_days", models.IntegerField(verbose_name="تغییر (روز)")),
                ("reason", models.CharField(blank=True, max_length=200, verbose_name="دلیل")),
                ("until_after", models.DateField(blank=True, null=True, verbose_name="اعتبار پس از تغییر")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("admin", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="premium_actions", to=settings.AUTH_USER_MODEL, verbose_name="ادمین")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="premium_logs", to=settings.AUTH_USER_MODEL, verbose_name="کاربر")),
            ],
            options={
                "verbose_name": "تغییر اشتراک",
                "verbose_name_plural": "تاریخچه‌ی اشتراک",
                "ordering": ["-created_at"],
            },
        ),
    ]
