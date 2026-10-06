# Web Push setup (v1.11)

1. Generate keys once:
   ```
   python manage.py gen_vapid_keys
   ```
2. Put the three printed lines into the server environment
   (`VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`).
   With no `VAPID_PUBLIC_KEY`, the feature stays hidden in the UI.
3. Run migrations: `python manage.py migrate`  (adds `vault.0003_push`).
4. Schedule the sweep every ~5 minutes (PythonAnywhere → Tasks):
   ```
   python /home/you/aegis/manage.py send_push_reminders
   ```

Privacy model: the client uploads only bare reminder *timestamps* for the
next 7 days; pushes are sent with an **empty body**; the notification text is
composed on-device by the service worker (stored in IndexedDB per language).
