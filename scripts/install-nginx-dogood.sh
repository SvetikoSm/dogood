#!/usr/bin/env bash
# Install / refresh nginx config for dogood-brand.ru (SSL + gzip + cache).
# Run on VPS: cd /opt/dogood && git pull && sudo bash scripts/install-nginx-dogood.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${REPO_ROOT}/deploy/nginx-dogood.conf"
DEST="/etc/nginx/sites-available/dogood"
ENABLED="/etc/nginx/sites-enabled/dogood"
TMP="$(mktemp)"

if [[ ! -f "$SRC" ]]; then
  echo "Missing $SRC — run from /opt/dogood after git pull." >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo: sudo bash scripts/install-nginx-dogood.sh" >&2
  exit 1
fi

if [[ -f "$DEST" ]]; then
  cp -a "$DEST" "${DEST}.bak.$(date +%Y%m%d%H%M%S)"
  echo "Backed up existing config."
fi

cp "$SRC" "$TMP"

if [[ -f "$DEST" ]]; then
  OLD_KEY=$(grep -m1 'ssl_certificate_key' "$DEST" | awk '{print $2}' | tr -d ';' || true)
  if [[ -n "$OLD_KEY" && -f "$OLD_KEY" ]]; then
    OLD_FULL=$(grep -m1 'ssl_certificate ' "$DEST" | awk '{print $2}' | tr -d ';' || true)
    OLD_CHAIN="$(dirname "$OLD_KEY")/chain.pem"
    sed -i "s|ssl_certificate     .*|ssl_certificate     ${OLD_FULL};|" "$TMP"
    sed -i "s|ssl_certificate_key .*|ssl_certificate_key ${OLD_KEY};|" "$TMP"
    if [[ -f "$OLD_CHAIN" ]]; then
      sed -i "s|ssl_trusted_certificate .*|ssl_trusted_certificate ${OLD_CHAIN};|" "$TMP"
    fi
    echo "Using existing certificate paths from previous config."
  fi
fi

cp "$TMP" "$DEST"
rm -f "$TMP"
ln -sf "$DEST" "$ENABLED"

nginx -t
systemctl reload nginx

echo "Nginx reloaded. Test: curl -sI https://dogood-brand.ru | head -3"
