#!/usr/bin/env bash
# Install Cloudflare WARP in local-proxy mode so this VPS can reach
# api.telegram.org (provider DPI blackholes direct Telegram routes).
#
# After this, curl/node should use:
#   HTTPS_PROXY=http://127.0.0.1:40000
# Docker containers on the default bridge reach the host proxy at:
#   http://172.17.0.1:40000
# (via the dogood-warp-bridge socat service this script installs below —
# warp-svc itself only ever binds 127.0.0.1, so without that bridge the
# docker0 address above is unreachable and the app can send nothing).
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
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

systemctl enable --now warp-svc >/dev/null 2>&1 || true
# Daemon needs a moment after first install before registration works.
for i in 1 2 3 4 5 6 7 8 9 10; do
  if warp-cli --accept-tos status >/dev/null 2>&1 || warp-cli status >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# Register if needed (idempotent-ish: ignore "already registered").
warp-cli --accept-tos registration new >/dev/null 2>&1 \
  || warp-cli registration new >/dev/null 2>&1 \
  || true

warp-cli --accept-tos mode proxy >/dev/null 2>&1 \
  || warp-cli set-mode proxy >/dev/null 2>&1 \
  || true
warp-cli --accept-tos proxy port "$PROXY_PORT" >/dev/null 2>&1 \
  || warp-cli set-proxy-port "$PROXY_PORT" >/dev/null 2>&1 \
  || true

warp-cli --accept-tos connect >/dev/null 2>&1 \
  || warp-cli connect >/dev/null 2>&1 \
  || true

sleep 3
echo "[warp] status:"
warp-cli --accept-tos status 2>/dev/null || warp-cli status 2>/dev/null || true

echo "[warp] probe Telegram via local proxy :$PROXY_PORT"
code=$(curl -sS -m 25 -x "http://127.0.0.1:${PROXY_PORT}" \
  -o /dev/null -w "%{http_code}" https://api.telegram.org/ || echo 000)
echo "[warp] api.telegram.org via proxy -> HTTP $code"
if [ "$code" != "302" ] && [ "$code" != "200" ]; then
  echo "[warp] WARNING: proxy probe failed (got $code). Telegram bots may still be unreachable."
  exit 1
fi

install -d -m 755 /etc/dogood
cat > /etc/dogood/telegram-proxy.env <<EOF
TELEGRAM_HTTPS_PROXY=http://127.0.0.1:${PROXY_PORT}
TELEGRAM_HTTPS_PROXY_DOCKER=http://172.17.0.1:${PROXY_PORT}
EOF
echo "[warp] wrote /etc/dogood/telegram-proxy.env"

# warp-svc only binds 127.0.0.1, so the docker bridge address above is
# useless on its own — the dogood container connects out on 172.17.0.1 and
# gets nothing. Bridge that port onto the docker0 gateway with socat so the
# container's outbound sendMessage/sendPhoto calls actually reach the proxy.
echo "[warp] bridging proxy port to the docker bridge (172.17.0.1:${PROXY_PORT})"
command -v socat >/dev/null 2>&1 || apt-get install -y -qq socat >/dev/null

cat > /etc/systemd/system/dogood-warp-bridge.service <<EOF
[Unit]
Description=Expose WARP proxy (127.0.0.1:${PROXY_PORT}) to the Docker bridge for the dogood container
After=network-online.target warp-svc.service
Wants=network-online.target

[Service]
ExecStart=/usr/bin/socat TCP-LISTEN:${PROXY_PORT},bind=172.17.0.1,fork,reuseaddr TCP:127.0.0.1:${PROXY_PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now dogood-warp-bridge >/dev/null 2>&1 || true
command -v ufw >/dev/null 2>&1 && ufw allow in on docker0 to 172.17.0.1 port "${PROXY_PORT}" proto tcp >/dev/null 2>&1 || true

sleep 1
bridge_code=$(curl -sS -m 15 -x "http://172.17.0.1:${PROXY_PORT}" \
  -o /dev/null -w "%{http_code}" https://api.telegram.org/ || echo 000)
echo "[warp] api.telegram.org via docker-bridge proxy -> HTTP $bridge_code"
if [ "$bridge_code" != "302" ] && [ "$bridge_code" != "200" ]; then
  echo "[warp] WARNING: docker-bridge proxy probe failed (got $bridge_code). The dogood container will not be able to send Telegram messages."
  exit 1
fi
