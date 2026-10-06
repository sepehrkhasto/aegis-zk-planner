import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="EncryptedVault",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("kdf", models.CharField(default="PBKDF2-SHA256", max_length=32)),
                ("kdf_iterations", models.PositiveIntegerField(default=600000)),
                ("salt", models.TextField()),
                ("wrapped_key", models.TextField()),
                ("wrapped_key_iv", models.TextField()),
                ("ciphertext", models.TextField(blank=True, default="")),
                ("ciphertext_iv", models.TextField(blank=True, default="")),
                ("revision", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="vault", to=settings.AUTH_USER_MODEL, verbose_name="کاربر")),
            ],
            options={
                "verbose_name": "ولت رمزنگاری\u200cشده",
                "verbose_name_plural": "ولت\u200cهای رمزنگاری\u200cشده",
            },
        ),
    ]
