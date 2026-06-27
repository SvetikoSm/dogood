#!/usr/bin/env bash
# Полный деплой на VPS: env, docker build (с cache-bust), nginx, проверка картинок.
# cd /opt/dogood && sudo bash scripts/deploy-production.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${REPO_ROOT}/.env.production"

echo "=== 1. Git pull ==="
git pull origin main

echo "=== 2. Env + CACHE_BUST_ID ==="
node scripts/patch-env-production.mjs "$ENV_FILE"
BUST="$(grep '^NEXT_PUBLIC_CACHE_BUST_ID=' "$ENV_FILE" | cut -d= -f2-)"
echo "Cache bust: ${BUST}"

echo "=== 3. Docker build ==="
docker build \
  --build-arg "NEXT_PUBLIC_CACHE_BUST_ID=${BUST}" \
  -t dogood-v2 .

echo "=== 4. Docker run ==="
docker stop dogood 2>/dev/null || true
docker rm dogood 2>/dev/null || true
docker run -d --name dogood --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  --env-file "$ENV_FILE" \
  -v dogood_data:/app/data \
  dogood-v2

echo "=== 5. Wait for app ==="
for i in $(seq 1 20); do
  if curl -sfI http://127.0.0.1:3000/ | head -1 | grep -q 200; then
    echo "App ready (${i}s)"
    break
  fi
  sleep 1
done

echo "=== 6. Nginx ==="
bash scripts/install-nginx-dogood.sh

echo "=== 7. Cloudflare purge (optional) ==="
bash scripts/purge-cloudflare-cache.sh || true

echo "=== 8. Verify images ==="
bash scripts/verify-site-images.sh

echo ""
echo "DONE. Site: https://dogood-brand.ru  (cache bust ${BUST})"
