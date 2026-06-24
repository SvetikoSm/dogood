#!/usr/bin/env bash
# ВРЕМЕННО: HTTP без редиректа + HTTPS (если жив). Телефон: http://dogood-brand.ru
# sudo bash scripts/emergency-http-serve.sh
set -euo pipefail

cat > /etc/nginx/sites-available/dogood <<'NGINX'
upstream dogood_next {
    server 127.0.0.1:3000;
}

# HTTP — без редиректа (для мобильного, пока 443 нестабилен)
server {
    listen 80;
    server_name dogood-brand.ru www.dogood-brand.ru;

    client_max_body_size 25m;

    gzip on;
    gzip_vary on;
    gzip_min_length 256;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    location / {
        proxy_pass         http://dogood_next;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}

# HTTPS — оставляем, если работает
server {
    listen 443 ssl;
    server_name dogood-brand.ru www.dogood-brand.ru;

    ssl_certificate     /etc/letsencrypt/live/dogood-brand.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dogood-brand.ru/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam           /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 25m;

    gzip on;
    gzip_vary on;
    gzip_min_length 256;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    location / {
        proxy_pass         http://dogood_next;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/dogood /etc/nginx/sites-enabled/dogood
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl restart nginx

echo "=== HTTP ==="
curl -sI http://dogood-brand.ru | head -3
echo "=== HTTPS ==="
curl -sI --max-time 10 https://dogood-brand.ru | head -3 || echo "HTTPS пока не отвечает — используйте http://"
echo ""
echo "На телефоне откройте: http://dogood-brand.ru (без s)"
