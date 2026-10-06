from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("vault", "0002_recovery_key"),
    ]

    operations = [
        migrations.CreateModel(
            name="PushSubscription",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("endpoint", models.URLField(max_length=500, unique=True)),
                ("p256dh", models.CharField(blank=True, default="", max_length=200)),
                ("auth", models.CharField(blank=True, default="", max_length=100)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("last_ok_at", models.DateTimeField(blank=True, null=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="push_subscriptions", to=settings.AUTH_USER_MODEL)),
            ],
            options={"verbose_name": "اشتراک پوش", "verbose_name_plural": "اشتراک‌های پوش"},
        ),
        migrations.CreateModel(
            name="ReminderSlot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("fire_at", models.DateTimeField(db_index=True)),
                ("sent", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="reminder_slots", to=settings.AUTH_USER_MODEL)),
            ],
            options={"verbose_name": "زمان یادآوری", "verbose_name_plural": "زمان‌های یادآوری"},
        ),
        migrations.AddIndex(
            model_name="reminderslot",
            index=models.Index(fields=["sent", "fire_at"], name="vault_remin_sent_fi_idx"),
        ),
    ]
