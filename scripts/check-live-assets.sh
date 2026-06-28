#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-https://dogood-brand.ru}"
TMP="$(mktemp)"
curl -sf --max-time 20 "$BASE/" -o "$TMP"
echo "HTML bytes: $(wc -c < "$TMP")"

CSS="$(grep -oE '/_next/static/css/[^"]+\.css' "$TMP" | head -1)"
echo "CSS: $CSS"
curl -sfI --max-time 15 "$BASE$CSS" | head -3

FAIL=0
while read -r js; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE$js")"
  if [[ "$code" != "200" ]]; then
    echo "FAIL $code $js"
    FAIL=$((FAIL + 1))
  fi
done < <(grep -oE '/_next/static/chunks/[^"]+\.js' "$TMP" | sort -u)

if [[ "$FAIL" -eq 0 ]]; then
  echo "All JS chunks OK"
else
  echo "Broken chunks: $FAIL"
  exit 1
fi

rm -f "$TMP"
