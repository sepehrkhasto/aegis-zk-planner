"""Cron sweep: fire due reminder slots as empty pushes. Schedule every
5 minutes, e.g. on PythonAnywhere:
    */5 * * * *  python /path/manage.py send_push_reminders
Idempotent: a slot is marked sent before pushing, dead subscriptions are
pruned, and slots older than two days are vacuumed."""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from vault.models import PushSubscription, ReminderSlot
from vault.push import send_tickle


class Command(BaseCommand):
    help = "Send Web Push tickles for due reminder slots."

    def handle(self, *args, **opts):
        now = timezone.now()
        due = list(
            ReminderSlot.objects.filter(sent=False, fire_at__lte=now)
            .select_related("user")[:500]
        )
        if not due:
            self.stdout.write("nothing due")
        # mark first: a crash mid-send must not double-notify on the next run
        ReminderSlot.objects.filter(pk__in=[s.pk for s in due]).update(sent=True)

        sent = pruned = 0
        by_user = {}
        for s in due:
            by_user.setdefault(s.user_id, s.user)
        for user in by_user.values():
            for sub in user.push_subscriptions.all():
                if send_tickle(sub):
                    sub.last_ok_at = now
                    sub.save(update_fields=["last_ok_at"])
                    sent += 1
                else:
                    sub.delete()
                    pruned += 1

        ReminderSlot.objects.filter(fire_at__lt=now - timedelta(days=2)).delete()
        self.stdout.write(f"slots={len(due)} pushes={sent} pruned={pruned}")
