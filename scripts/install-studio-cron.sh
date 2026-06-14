#!/usr/bin/env bash
# Install cron on VPS for Studio pipeline (run as root on server).
set -euo pipefail

SECRET="${STUDIO_CRON_SECRET:-POPAPOPAPOPAPOPA1234567890123456789012345678901234567890}"
BASE="${OPS_PUBLIC_BASE_URL:-https://dogood-brand.ru}"
LINE="*/3 * * * * curl -fsS -H \"Authorization: Bearer ${SECRET}\" ${BASE}/api/studio/cron/tick >> /var/log/dogood-studio-cron.log 2>&1"

( crontab -l 2>/dev/null | grep -v 'dogood-studio-cron' || true; echo "$LINE" ) | crontab -
echo "Cron installed:"
crontab -l | grep dogood-studio-cron || true
