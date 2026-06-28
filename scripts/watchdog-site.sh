#!/usr/bin/env bash
# Проверка сайта каждые 5 мин (cron). При сбое — restart docker + nginx.
set -euo pipefail

BASE="${SITE_URL:-https://dogood-brand.ru}"
LOG="/var/log/dogood-watchdog.log"
REPO="/opt/dogood"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*" | tee -a "$LOG"; }

check_url() {
  local url="$1"
  curl -sf --max-time 20 -o /dev/null "$url"
}

TMP="$(mktemp)"
if ! curl -sf --max-time 25 "$BASE/" -o "$TMP"; then
  log "FAIL html $BASE/"
  NEED_RESTART=1
else
  sz="$(wc -c < "$TMP")"
  if [[ "$sz" -lt 10000 ]]; then
    log "FAIL html too small (${sz} bytes)"
    NEED_RESTART=1
  fi
  CSS="$(grep -oE '/_next/static/css/[^"]+\.css' "$TMP" | head -1 || true)"
  if [[ -z "$CSS" ]] || ! check_url "$BASE$CSS"; then
    log "FAIL css ${CSS:-missing}"
    NEED_RESTART=1
  fi
  if ! check_url "$BASE/products/life/main.webp"; then
    log "FAIL image /products/life/main.webp"
    NEED_RESTART=1
  fi
fi
rm -f "$TMP"

if [[ "${NEED_RESTART:-0}" == "1" ]]; then
  log "Restarting dogood + nginx"
  docker restart dogood || true
  sleep 8
  systemctl restart nginx || true
  if curl -sf --max-time 25 "$BASE/" -o /dev/null; then
    log "Recovery OK"
  else
    log "Recovery FAILED — manual check needed"
  fi
fi
