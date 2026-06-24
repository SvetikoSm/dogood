#!/usr/bin/env bash
# Полное восстановление HTTPS на VPS. Запуск: sudo bash scripts/restore-https.sh
set -euo pipefail

echo "=== 1. Docker ==="
docker ps --filter name=dogood || true
curl -sfI http://127.0.0.1:3000 | head -3 || echo "WARN: app :3000 not responding"

echo "=== 2. Restore nginx from OLDEST backup (до наших правок) ==="
CONF="/etc/nginx/sites-available/dogood"
BACKUP=$(ls -t "${CONF}.bak."* 2>/dev/null | tail -1 || true)
if [[ -n "$BACKUP" && -f "$BACKUP" ]]; then
  cp -a "$BACKUP" "$CONF"
  echo "Restored from $BACKUP"
else
  echo "No backup — writing minimal config"
  cat > "$CONF" <<'NGINX'
upstream dogood_next {
    server 127.0.0.1:3000;
}

server {
    listen 443 ssl;
    server_name dogood-brand.ru www.dogood-brand.ru;

    ssl_certificate     /etc/letsencrypt/live/dogood-brand.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dogood-brand.ru/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 25m;

    location / {
        proxy_pass http://dogood_next;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name dogood-brand.ru www.dogood-brand.ru;
    return 301 https://$host$request_uri;
}
NGINX
fi

ln -sf "$CONF" /etc/nginx/sites-enabled/dogood
nginx -t
systemctl restart nginx

echo "=== 3. Firewall ==="
ufw status 2>/dev/null || true
iptables -L INPUT -n 2>/dev/null | head -10 || true

echo "=== 4. Local HTTPS test ==="
curl -sI https://127.0.0.1 -k -H "Host: dogood-brand.ru" | head -5 || true
curl -sI https://dogood-brand.ru | head -5 || true

echo "=== 5. Cert expiry ==="
openssl x509 -in /etc/letsencrypt/live/dogood-brand.ru/fullchain.pem -noout -dates 2>/dev/null || true

echo "DONE"
