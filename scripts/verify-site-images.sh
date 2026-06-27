#!/usr/bin/env bash
# Проверка ключевых URL (HTML + все webp каталога и формы).
set -euo pipefail

BASE="${SITE_URL:-https://dogood-brand.ru}"
FAIL=0

check() {
  local url="$1"
  local code
  code="$(curl -sf -o /dev/null -w '%{http_code}' --max-time 20 "$url" || echo "000")"
  if [[ "$code" == "200" ]]; then
    echo "OK  $code  $url"
  else
    echo "FAIL $code  $url" >&2
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Verify ${BASE} ==="
check "${BASE}/"
check "${BASE}/products/life/main.webp"
check "${BASE}/products/speed/main.webp"
check "${BASE}/products/rainy/main.webp"
check "${BASE}/order-form-styles/life/2.webp"
check "${BASE}/order-form-styles/speed/2.webp"
check "${BASE}/order-form-styles/rainy/2.webp"

for style in life speed rainy; do
  for n in 1 2 3 4; do
    for ext in webp jpg jpeg png; do
      u="${BASE}/products/${style}/${n}.${ext}"
      code="$(curl -sf -o /dev/null -w '%{http_code}' --max-time 10 "$u" 2>/dev/null || echo "000")"
      if [[ "$code" == "200" ]]; then
        echo "OK  $code  $u"
      fi
    done
  done
done

# WebP magic (RIFF....WEBP)
magic="$(curl -sf --max-time 15 "${BASE}/products/life/main.webp" | head -c 12 | xxd -p 2>/dev/null || true)"
if [[ "$magic" == *"52494646"* && "$magic" == *"57454250"* ]] || [[ "$magic" == 52494646*57454250* ]]; then
  echo "OK  webp magic bytes for main.webp"
else
  echo "WARN webp magic unexpected: ${magic}" >&2
fi

if [[ "$FAIL" -gt 0 ]]; then
  echo "FAILED: ${FAIL} required URL(s)" >&2
  exit 1
fi
echo "All required checks passed."
