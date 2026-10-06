# دیپلوی نهایی روی PythonAnywhere (پلن رایگان)

چک‌لیست کامل، به ترتیب. تخمین زمان: ۲۰–۳۰ دقیقه.

## ۱) آماده‌سازی محلی
- [ ] تست‌ها سبز باشند: `python manage.py test`
- [ ] یک اکسپورت از ولت خودت بگیر (تنظیمات → اکسپورت ولت).
- [ ] پروژه را zip کن (بدون `db.sqlite3` و `.env` — دیتای پروداکشن جداست).

## ۲) آپلود و محیط
```bash
# در Bash console پایتون‌انی‌ور:
cd ~
unzip secure_planner.zip
mkvirtualenv --python=/usr/bin/python3.10 planner
pip install -r ~/secure_planner/requirements.txt
```

## ۳) متغیرهای محیطی
فایل `~/secure_planner/.env` بساز:
```
DJANGO_SECRET_KEY=<python -c "import secrets; print(secrets.token_urlsafe(64))">
DJANGO_DEBUG=False
DJANGO_ALLOWED_HOSTS=YOURNAME.pythonanywhere.com
DJANGO_CSRF_TRUSTED_ORIGINS=https://YOURNAME.pythonanywhere.com
```
> `DJANGO_DEBUG=False` در پروداکشن حیاتی است: HSTS، کوکی‌های Secure،
> SSL redirect و استاتیکِ هش‌دار همه با همین فعال می‌شوند.

## ۴) دیتابیس و استاتیک
```bash
cd ~/secure_planner
python manage.py migrate
python manage.py createcachetable
python manage.py collectstatic --noinput
python manage.py createsuperuser
```
> `collectstatic` با storage هش‌دار اجرا می‌شود؛ **بعد از هر آپدیت کد حتماً دوباره اجرایش کن** وگرنه صفحه فایل‌های قدیمی/گم‌شده می‌بیند.

## ۵) Web App
- Web → Add a new web app → **Manual configuration → Python 3.10**
- Virtualenv: `/home/YOURNAME/.virtualenvs/planner`
- WSGI file را این‌طور کن:
```python
import os, sys
path = "/home/YOURNAME/secure_planner"
if path not in sys.path:
    sys.path.insert(0, path)
os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"
from django.core.wsgi import get_wsgi_application
application = get_wsgi_application()
```
- Static files:
  - URL: `/static/` → Directory: `/home/YOURNAME/secure_planner/staticfiles`
- Reload.

## ۶) تست پس از دیپلوی
- [ ] `https://YOURNAME.pythonanywhere.com/` → صفحه‌ی Home
- [ ] `/panel/` با اکانت سوپر‌یوزر → کد دعوت بساز
- [ ] ثبت‌نام با کد → تایید از پنل → ورود → ساخت مستر پسورد
- [ ] یک تسک بساز، صفحه را ببند و باز کن، باید بماند
- [ ] اکسپورت ولت کار کند
- [ ] روی موبایل: Add to Home Screen (PWA)

## ۷) نگهداری دوره‌ای
| کار | دوره |
|---|---|
| Reload/تمدید web app (الزام PA رایگان) | ماهانه |
| `python manage.py clearsessions` | ماهانه |
| دانلود `db.sqlite3` به‌عنوان بکاپ سرور | هفتگی |
| یادآوری به کاربران: اکسپورت ولت | هفتگی |
| بعد از هر آپدیت کد: `collectstatic` + Reload | هر دیپلوی |

## نکته‌های عیب‌یابی
- **CSRF error بعد از لاگین**: `DJANGO_CSRF_TRUSTED_ORIGINS` باید `https://` داشته باشد.
- **استاتیک ۴۰۴**: `collectstatic` را دوباره بزن و مسیر Static files را چک کن.
- **500 بدون توضیح**: error log در تب Web؛ معمولاً `.env` خوانده نشده (مسیر/نام فایل).
- سرویس‌ورکر نسخه‌ی قدیمی نشان می‌دهد؟ یک‌بار ببند و باز کن؛ در پروداکشن اسم فایل‌ها هش‌دار است و مشکل خودبه‌خود حل می‌شود.


## آدرس مخفی ادمین (v1.1.3)

پنل ادمین جنگو دیگر روی `/admin/` نیست. مسیر پیش‌فرض حالا `/control-panel-x7/` است.
برای امنیت بیشتر، در فایل `.env` یک مسیر تصادفی خودت بگذار:

```
DJANGO_ADMIN_URL=control-9f3a7b
```

سپس ادمین از `https://yourdomain/control-9f3a7b/` در دسترس است. مسیر را جایی امن
یادداشت کن. (پنل مدیریت حساب‌ها همچنان روی `/panel/` و فقط برای استاف است.)
