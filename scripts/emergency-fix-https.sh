#!/usr/bin/env bash
# Emergency: restore minimal nginx SSL (fixes broken HTTPS handshake).
set -euo pipefail
cd /opt/dogood
git pull origin main
sudo bash scripts/install-nginx-dogood.sh
curl -sI https://dogood-brand.ru | head -5
