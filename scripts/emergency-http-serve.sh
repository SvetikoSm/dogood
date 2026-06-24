#!/usr/bin/env bash
# ВРЕМЕННО: сайт по HTTP без редиректа на HTTPS (пока чиним 443).
# sudo bash scripts/emergency-http-serve.sh
set -euo pipefail

cat > /etc/nginx/sites-available/dogood <<'NGINX'
upstream dogood_next {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name dogood-brand.ru www.dogood-brand.ru;

    client_max_body_size 25m;

    location / {
        proxy_pass         http://dogood_next;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/dogood /etc/nginx/sites-enabled/dogood
nginx -t
systemctl restart nginx
echo "OK: откройте http://dogood-brand.ru (без s) на телефоне"
