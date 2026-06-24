# Apply nginx config on Timeweb VPS (SSL + gzip for mobile Safari).
# Usage: .\scripts\patch-nginx.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Server = "root@72.56.39.162"
$RemoteDir = "/opt/dogood"

Set-Location $ProjectRoot

Write-Host "Uploading nginx install script..."
scp (Join-Path $PSScriptRoot "install-nginx-dogood.sh") "${Server}:/tmp/install-nginx-dogood.sh"
scp (Join-Path $ProjectRoot "deploy/nginx-dogood.conf") "${Server}:/tmp/nginx-dogood.conf"

$remote = @(
  "set -e"
  "cd $RemoteDir"
  "git pull origin main"
  "cp /tmp/nginx-dogood.conf deploy/nginx-dogood.conf"
  "cp /tmp/install-nginx-dogood.sh scripts/install-nginx-dogood.sh"
  "chmod +x scripts/install-nginx-dogood.sh"
  "bash scripts/install-nginx-dogood.sh"
  "curl -sI https://dogood-brand.ru | head -n 5"
) -join "`n"

Write-Host "Installing nginx on server (enter SSH password if prompted)..."
ssh $Server $remote
Write-Host "Done."
