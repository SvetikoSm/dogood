# Deploy DoGood to the Timeweb VPS: git pull + docker rebuild + Studio cron + Telegram webhook.
# You will be prompted for the root SSH password a few times (each scp + the ssh run).
#   .\scripts\deploy-timeweb.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Server = "root@72.56.39.162"

Set-Location $ProjectRoot

$EnvLocal = Join-Path $ProjectRoot ".env.local"
if (-not (Test-Path $EnvLocal)) { throw ".env.local not found at $EnvLocal" }

Write-Host "Uploading env + helper scripts to server..."
scp $EnvLocal "${Server}:/tmp/dogood-secrets.env"
scp (Join-Path $PSScriptRoot "patch-env-production.mjs") "${Server}:/tmp/patch-env-production.mjs"
scp (Join-Path $PSScriptRoot "install-studio-cron.sh") "${Server}:/tmp/install-studio-cron.sh"

# Optional clean single-line SA JSON. If absent, we rely on GOOGLE_SERVICE_ACCOUNT_JSON in .env.local.
$SaJson = Join-Path $env:USERPROFILE "Downloads\_sa-extracted.json"
$SaArg = '""'
if (Test-Path $SaJson) {
  scp $SaJson "${Server}:/tmp/dogood-sa.json"
  $SaArg = "/tmp/dogood-sa.json"
}

# Single-quoted here-string: PowerShell passes it verbatim; all $VARS and quotes are for bash on the server.
$remote = @'
set -e
cd /opt/dogood
# Discard local edits on the VPS that block git pull (cron script etc. come from the repo).
git stash push -u -m "deploy-auto-stash $(date -Iseconds)" || true
git pull origin main
node /tmp/patch-env-production.mjs .env.production __SA_ARG__ /tmp/dogood-secrets.env
rm -f /tmp/dogood-sa.json /tmp/dogood-secrets.env
docker build -t dogood-v2 .
docker stop dogood 2>/dev/null || true
docker rm dogood 2>/dev/null || true
docker run -d --name dogood --restart unless-stopped -p 127.0.0.1:3000:3000 --env-file .env.production -v dogood_data:/app/data dogood-v2
# Studio DB schema self-migrates on first request; wait for boot, then sync templates from Drive.
sleep 8
SECRET=$(grep '^STUDIO_CRON_SECRET=' .env.production | cut -d= -f2-)
curl -fsS -X POST -H "Authorization: Bearer $SECRET" http://127.0.0.1:3000/api/studio/templates/sync-drive || echo 'template sync failed - rerun after boot'
bash /tmp/install-studio-cron.sh
TB=$(grep '^TELEGRAM_BOT_TOKEN=' .env.production | cut -d= -f2-)
TW=$(grep '^TELEGRAM_WEBHOOK_SECRET=' .env.production | cut -d= -f2-)
curl -fsS "https://api.telegram.org/bot${TB}/setWebhook?url=https://dogood-brand.ru/api/telegram/webhook&secret_token=${TW}" || true
# Fair-event client bot webhook (only if the token is configured)
CT=$(grep '^TELEGRAM_CLIENT_BOT_TOKEN=' .env.production | cut -d= -f2-)
CW=$(grep '^TELEGRAM_CLIENT_WEBHOOK_SECRET=' .env.production | cut -d= -f2-)
if [ -n "$CT" ]; then
  curl -fsS "https://api.telegram.org/bot${CT}/setWebhook?url=https://dogood-brand.ru/api/telegram/client-webhook&secret_token=${CW}" || true
fi
bash scripts/install-nginx-dogood.sh || true
docker ps --filter name=dogood
curl -sI http://127.0.0.1:3000 | head -n 3
# Fail loudly if the new fair routes are missing (deploy incomplete).
curl -fsS -o /dev/null -w "yookassa-webhook:%{http_code}\n" -X POST http://127.0.0.1:3000/api/payments/yookassa/webhook -H "Content-Type: application/json" -d '{}' || echo 'yookassa-webhook:MISSING'
curl -fsS -o /dev/null -w "client-webhook:%{http_code}\n" -X POST http://127.0.0.1:3000/api/telegram/client-webhook -H "Content-Type: application/json" -d '{}' || echo 'client-webhook:MISSING'
'@
$remote = $remote.Replace('__SA_ARG__', $SaArg)

Write-Host "Deploying on server (enter the root password when prompted)..."
ssh $Server $remote
Write-Host "Done. Check https://dogood-brand.ru"
