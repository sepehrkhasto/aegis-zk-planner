from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("vault", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="encryptedvault",
            name="recovery_salt",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="encryptedvault",
            name="recovery_wrapped_key",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="encryptedvault",
            name="recovery_wrapped_key_iv",
            field=models.TextField(blank=True, default=""),
        ),
    ]
