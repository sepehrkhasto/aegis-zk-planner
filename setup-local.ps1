# setup-local.ps1 — Aegis Planner local dev setup (Windows / PowerShell / Python 3.11)
# Run once from the project root:  .\setup-local.ps1
# Afterwards, start the server any time with:  .\setup-local.ps1 -Run

param([switch]$Run)

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".venv")) {
    Write-Host "==> Creating virtualenv (.venv)..." -ForegroundColor Cyan
    py -3.11 -m venv .venv
}

Write-Host "==> Activating virtualenv..." -ForegroundColor Cyan
. .\.venv\Scripts\Activate.ps1

Write-Host "==> Installing dependencies..." -ForegroundColor Cyan
python -m pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet

# Local dev environment. NEVER use these values in production —
# set real values in the host's environment (see DEPLOY.md).
$env:DJANGO_DEBUG = "1"
if (-not $env:DJANGO_SECRET_KEY) { $env:DJANGO_SECRET_KEY = "dev-only-not-for-production" }

Write-Host "==> Applying migrations (includes 0002_recovery_key for v1.9)..." -ForegroundColor Cyan
python manage.py migrate

if (-not $Run) {
    Write-Host ""
    Write-Host "Setup complete. Next steps:" -ForegroundColor Green
    Write-Host "  1) python manage.py createsuperuser   (first time only)"
    Write-Host "  2) .\setup-local.ps1 -Run             (start the dev server)"
    Write-Host ""
}

if ($Run) {
    Write-Host "==> Starting dev server at http://127.0.0.1:8000 ..." -ForegroundColor Green
    python manage.py runserver
}
