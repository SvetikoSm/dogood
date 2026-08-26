#!/usr/bin/env bash
# Install Cloudflare WARP in local-proxy mode so this VPS can reach
# api.telegram.org (provider DPI blackholes direct Telegram routes).
#
# After this, curl/node should use:
#   HTTPS_PROXY=http://127.0.0.1:40000
# Docker containers on the default bridge reach the host proxy at:
#   http://172.17.0.1:40000
set -euo pipefail

PROXY_PORT=40000

if ! command -v warp-cli >/dev/null 2>&1; then
  echo "[warp] installing cloudflare-warp..."
  apt-get update -qq
  apt-get install -y -qq curl gnupg lsb-release ca-certificates >/dev/null
  curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg \
    | gpg --yes --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" \
    > /etc/apt/sources.list.d/cloudflare-client.list
  apt-get update -qq
  apt-get install -y -qq cloudflare-warp
fi

# New CLI variants differ slightly; try both registration styles.
if ! warp-cli --accept-tos status >/dev/null 2>&1; then
  warp-cli --accept-tos registration new >/dev/null 2>&1 \
    || warp-cli registration new >/dev/null 2>&1 \
    || true
fi

# Prefer proxy mode so only apps that opt in go through WARP.
warp-cli --accept-tos mode proxy >/dev/null 2>&1 \
  || warp-cli set-mode proxy >/dev/null 2>&1 \
  || true
warp-cli --accept-tos proxy port "$PROXY_PORT" >/dev/null 2>&1 \
  || warp-cli set-proxy-port "$PROXY_PORT" >/dev/null 2>&1 \
  || true

warp-cli --accept-tos connect >/dev/null 2>&1 \
  || warp-cli connect >/dev/null 2>&1 \
  || true

sleep 2
echo "[warp] status:"
warp-cli --accept-tos status 2>/dev/null || warp-cli status 2>/dev/null || true

echo "[warp] probe Telegram via local proxy :$PROXY_PORT"
code=$(curl -sS -m 20 -x "http://127.0.0.1:${PROXY_PORT}" \
  -o /dev/null -w "%{http_code}" https://api.telegram.org/ || echo 000)
echo "[warp] api.telegram.org via proxy -> HTTP $code"
if [ "$code" != "302" ] && [ "$code" != "200" ]; then
  echo "[warp] WARNING: proxy probe failed (got $code). Telegram bots may still be unreachable."
  exit 1
fi

# Persist proxy URL for poller / docker.
install -d -m 755 /etc/dogood
cat > /etc/dogood/telegram-proxy.env <<EOF
TELEGRAM_HTTPS_PROXY=http://127.0.0.1:${PROXY_PORT}
# From inside the dogood container (docker bridge → host):
TELEGRAM_HTTPS_PROXY_DOCKER=http://172.17.0.1:${PROXY_PORT}
EOF
echo "[warp] wrote /etc/dogood/telegram-proxy.env"
