# Deploy DoGood to the Timeweb VPS: git pull + docker rebuild + Studio cron + Telegram poller.
#   .\scripts\deploy-timeweb.ps1
# Uses the ~/.ssh/dogood_timeweb key when present (no password prompts);
# otherwise you will be prompted for the root password on each scp/ssh.

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Server = "root@72.56.39.162"
$SshKey = Join-Path $env:USERPROFILE ".ssh\dogood_timeweb"
$SshOpts = @()
if (Test-Path $SshKey) { $SshOpts = @("-i", $SshKey) }

Set-Location $ProjectRoot

$EnvLocal = Join-Path $ProjectRoot ".env.local"
if (-not (Test-Path $EnvLocal)) { throw ".env.local not found at $EnvLocal" }

Write-Host "Uploading env + helper scripts to server..."
scp @SshOpts $EnvLocal "${Server}:/tmp/dogood-secrets.env"
scp @SshOpts (Join-Path $PSScriptRoot "patch-env-production.mjs") "${Server}:/tmp/patch-env-production.mjs"
scp @SshOpts (Join-Path $PSScriptRoot "install-studio-cron.sh") "${Server}:/tmp/install-studio-cron.sh"

# Optional clean single-line SA JSON. If absent, we rely on GOOGLE_SERVICE_ACCOUNT_JSON in .env.local.
$SaJson = Join-Path $env:USERPROFILE "Downloads\_sa-extracted.json"
$SaArg = '""'
if (Test-Path $SaJson) {
  scp @SshOpts $SaJson "${Server}:/tmp/dogood-sa.json"
  $SaArg = "/tmp/dogood-sa.json"
}

# Single-quoted here-string: PowerShell passes it verbatim; all $VARS and quotes are for bash on the server.
$remote = @'
set -e
cd /opt/dogood
# VPS must match origin exactly. Local edits (e.g. cron script) blocked pull
# even when `git stash` reported nothing to save — reset is the reliable fix.
# Untracked files (.env.production, data/) are kept; only tracked files reset.
git fetch origin main
git reset --hard origin/main
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
# The provider blocks most Telegram subnets outbound: pin api.telegram.org to a
# reachable IP (host + container) and keep it fresh via a systemd timer.
bash scripts/tg-ip-pin.sh install
# Telegram cannot reach this VPS inbound (webhooks time out), so both bots run
# through a server-side getUpdates poller instead. It deletes the webhooks itself.
bash scripts/install-telegram-poller.sh
bash scripts/install-nginx-dogood.sh || true
docker ps --filter name=dogood
curl -sI http://127.0.0.1:3000 | head -n 3
# Route smoke checks (no custom headers: they get mangled by PS->ssh quoting).
# Expected: yookassa 200/400, client-webhook 401/503. Only 404 means a bad deploy.
curl -s -o /dev/null -w "yookassa-webhook:%{http_code}\n" -X POST -d '{}' http://127.0.0.1:3000/api/payments/yookassa/webhook
curl -s -o /dev/null -w "client-webhook:%{http_code}\n" -X POST -d '{}' http://127.0.0.1:3000/api/telegram/client-webhook
'@
$remote = $remote.Replace('__SA_ARG__', $SaArg)

Write-Host "Deploying on server..."
ssh @SshOpts $Server $remote
# ssh is a native command, so $ErrorActionPreference does not catch its failure:
# check the exit code explicitly or a failed deploy still prints "Done".
if ($LASTEXITCODE -ne 0) {
  throw "DEPLOY FAILED (ssh exit $LASTEXITCODE). Nothing was released - read the server output above."
}
Write-Host "Deploy OK. Check https://dogood-brand.ru"
