# Patch .env on server + git pull + docker rebuild.
# Needs SSH password for root@72.56.39.162
#   .\scripts\deploy-timeweb.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Server = "root@72.56.39.162"
$RemoteDir = "/opt/dogood"
$SaJson = Join-Path $env:USERPROFILE "Downloads\_sa-extracted.json"

Set-Location $ProjectRoot

if (-not (Test-Path $SaJson)) {
  Write-Host "Extracting SA JSON from transcript..."
  node scripts/_extract-sa-from-transcript.mjs
}

Write-Host "Uploading SA + patch script to server..."
scp $SaJson "${Server}:/tmp/dogood-sa.json"
scp (Join-Path $ProjectRoot ".env.local") "${Server}:/tmp/dogood-secrets.env"
scp (Join-Path $PSScriptRoot "patch-env-production.mjs") "${Server}:/tmp/patch-env-production.mjs"
scp (Join-Path $PSScriptRoot "install-studio-cron.sh") "${Server}:/tmp/install-studio-cron.sh"

$remote = @(
  "set -e"
  "cd $RemoteDir"
  "git pull origin main"
  "node /tmp/patch-env-production.mjs .env.production /tmp/dogood-sa.json /tmp/dogood-secrets.env"
  "rm -f /tmp/dogood-sa.json /tmp/dogood-secrets.env"
  "docker build -t dogood-v2 ."
  "docker stop dogood 2>/dev/null; true"
  "docker rm dogood 2>/dev/null; true"
  "docker run -d --name dogood --restart unless-stopped -p 127.0.0.1:3000:3000 --env-file .env.production -v dogood_data:/app/data dogood-v2"
  "docker exec dogood npm run studio:db:push"
  "SECRET=\$(grep '^STUDIO_CRON_SECRET=' .env.production | cut -d= -f2-)"
  "curl -fsS -X POST -H \"Authorization: Bearer \$SECRET\" http://127.0.0.1:3000/api/studio/templates/sync-drive || true"
  "bash /tmp/install-studio-cron.sh"
  "TB=\$(grep '^TELEGRAM_BOT_TOKEN=' .env.production | cut -d= -f2-)"
  "TW=\$(grep '^TELEGRAM_WEBHOOK_SECRET=' .env.production | cut -d= -f2-)"
  "curl -fsS \"https://api.telegram.org/bot\${TB}/setWebhook?url=https://dogood-brand.ru/api/telegram/webhook&secret_token=\${TW}\" || true"
  "bash scripts/install-nginx-dogood.sh || true"
  "docker ps --filter name=dogood"
  "curl -sI http://127.0.0.1:3000 | head -n 3"
) -join "`n"

Write-Host "Deploying on server..."
ssh $Server $remote
Write-Host "Done. Check https://dogood-brand.ru"
