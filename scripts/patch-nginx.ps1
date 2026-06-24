# Apply nginx config on Timeweb VPS (SSL + gzip for mobile Safari).
# Usage: .\scripts\patch-nginx.ps1

$ErrorActionPreference = "Stop"
$Server = "root@72.56.39.162"
$RemoteDir = "/opt/dogood"

$remote = @(
  "set -e"
  "cd $RemoteDir"
  "git pull origin main"
  "bash scripts/install-nginx-dogood.sh"
  "curl -sI https://dogood-brand.ru | head -n 5"
) -join "`n"

Write-Host "Installing nginx on server (enter SSH password if prompted)..."
ssh $Server $remote
Write-Host "Done."
