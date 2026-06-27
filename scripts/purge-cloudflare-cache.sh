#!/usr/bin/env bash
# Purge Cloudflare cache if CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID in .env.production
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env.production"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Skip CF purge: no .env.production"
  exit 0
fi

# shellcheck disable=SC1090
source <(grep -E '^(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ZONE_ID)=' "$ENV_FILE" | sed 's/^/export /')

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ZONE_ID:-}" ]]; then
  echo "Skip CF purge: add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID to .env.production"
  exit 0
fi

echo "Purging Cloudflare cache for zone ${CLOUDFLARE_ZONE_ID}..."
curl -sf -X POST \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}' \
  | grep -q '"success":true' && echo "Cloudflare purge OK" || {
  echo "Cloudflare purge failed" >&2
  exit 1
}
