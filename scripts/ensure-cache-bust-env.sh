#!/usr/bin/env bash
# Прописать CACHE_BUST_ID в .env.production (Safari cache bust).
# sudo bash scripts/ensure-cache-bust-env.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-${REPO_ROOT}/.env.production}"
VALUE="${CACHE_BUST_ID:-20250627-safari}"

node "${REPO_ROOT}/scripts/patch-env-production.mjs" "$ENV_FILE"
grep "^CACHE_BUST_ID=" "$ENV_FILE"
