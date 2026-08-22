#!/usr/bin/env bash
# Installs/updates the systemd service that long-polls Telegram for both bots.
# Needed because Telegram cannot reach this VPS with webhooks (inbound
# connections from Telegram's datacenters time out); polling is outbound-only.
set -e

cat > /etc/systemd/system/dogood-tg-poller.service <<'EOF'
[Unit]
Description=DoGood Telegram poller (webhook bypass: Telegram cannot reach this VPS inbound)
After=network-online.target docker.service
Wants=network-online.target

[Service]
WorkingDirectory=/opt/dogood
ExecStart=/usr/bin/env node /opt/dogood/scripts/telegram-server-poller.mjs /opt/dogood/.env.production
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable dogood-tg-poller >/dev/null 2>&1 || true
systemctl restart dogood-tg-poller
sleep 2
systemctl --no-pager -l status dogood-tg-poller | head -n 6
