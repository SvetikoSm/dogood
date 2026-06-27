#!/usr/bin/env bash
# Восстановление HTTPS: certbot-конфиг из репозитория + restart nginx.
# Запуск на VPS: cd /opt/dogood && git pull && sudo bash scripts/restore-https.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="/etc/nginx/sites-available/dogood"
ENABLED="/etc/nginx/sites-enabled/dogood"
SRC="${REPO_ROOT}/deploy/nginx-dogood.conf"
ENV_FILE="${REPO_ROOT}/.env.production"

echo "=== 0. Env CACHE_BUST_ID (Safari) ==="
if [[ -f "$ENV_FILE" ]]; then
  node "${REPO_ROOT}/scripts/patch-env-production.mjs" "$ENV_FILE"
  grep "^CACHE_BUST_ID=" "$ENV_FILE" || true
fi

echo "=== 1. App (Docker) ==="
docker ps --filter name=dogood || true
if ! curl -sfI http://127.0.0.1:3000 | head -3; then
  echo "ERROR: приложение на :3000 не отвечает. Сначала: docker ps" >&2
  exit 1
fi

echo "=== 2. Сертификаты ==="
for f in \
  /etc/letsencrypt/live/dogood-brand.ru/fullchain.pem \
  /etc/letsencrypt/live/dogood-brand.ru/privkey.pem \
  /etc/letsencrypt/options-ssl-nginx.conf \
  /etc/letsencrypt/ssl-dhparams.pem
do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: нет файла $f" >&2
    echo "Попробуйте: certbot --nginx -d dogood-brand.ru -d www.dogood-brand.ru" >&2
    exit 1
  fi
done
openssl x509 -in /etc/letsencrypt/live/dogood-brand.ru/fullchain.pem -noout -dates

echo "=== 3. Nginx config ==="
if [[ -f "$CONF" ]]; then
  cp -a "$CONF" "${CONF}.bak.$(date +%Y%m%d%H%M%S)"
fi
cp "$SRC" "$CONF"
ln -sf "$CONF" "$ENABLED"

# Убрать лишние default-сайты, если мешают
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

nginx -t
systemctl restart nginx
sleep 1

echo "=== 4. Порт 443 ==="
ss -tlnp | grep ':443' || true

echo "=== 5. Проверка HTTPS ==="
curl -sI https://127.0.0.1 -k -H "Host: dogood-brand.ru" | head -5 || true
echo "---"
curl -sI --max-time 15 https://dogood-brand.ru | head -5 || echo "WARN: внешний curl не ответил"

echo ""
echo "DONE. Если с телефона не открывается — sudo reboot и снова этот скрипт."
