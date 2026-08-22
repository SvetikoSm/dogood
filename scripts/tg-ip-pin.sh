#!/usr/bin/env bash
# Pins api.telegram.org to a reachable IP in /etc/hosts (host + dogood container).
#
# Why: the VPS provider blocks most Telegram subnets; DNS usually returns a dead
# address, so getUpdates/sendMessage hang with connect timeouts. We probe a list
# of known api.telegram.org IPs over real HTTPS and pin the first one that works.
# Installed as a systemd timer (every 5 min) so the pin heals itself when blocks
# or Telegram's addresses change.
#
# Usage:  tg-ip-pin.sh          - probe and (re)pin once
#         tg-ip-pin.sh install  - install/refresh the systemd timer, then pin
set -u
HOST=api.telegram.org
CANDIDATES="149.154.167.220 149.154.166.110 149.154.167.99 149.154.165.120 149.154.166.120 91.108.4.170 91.108.56.100"

if [ "${1:-}" = "install" ]; then
  # When run from the repo checkout, refresh the installed copy first.
  if [ -f "$0" ] && [ "$0" != "/usr/local/bin/tg-ip-pin.sh" ]; then
    tr -d '\r' < "$0" > /usr/local/bin/tg-ip-pin.sh
  fi
  chmod +x /usr/local/bin/tg-ip-pin.sh
  cat > /etc/systemd/system/dogood-tg-ip-pin.service <<'EOF'
[Unit]
Description=Pin api.telegram.org to a reachable IP (provider blocks most Telegram subnets)

[Service]
Type=oneshot
ExecStart=/usr/local/bin/tg-ip-pin.sh
EOF
  cat > /etc/systemd/system/dogood-tg-ip-pin.timer <<'EOF'
[Unit]
Description=Re-check api.telegram.org reachability every 5 minutes

[Timer]
OnBootSec=30
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now dogood-tg-ip-pin.timer >/dev/null 2>&1
  exec /usr/local/bin/tg-ip-pin.sh
fi

# Candidates first (ordered by what historically works), then whatever DNS says.
DNS_IPS=$(getent ahostsv4 "$HOST" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')

pick=""
for ip in $CANDIDATES $DNS_IPS; do
  code=$(curl -s -o /dev/null -m 6 --resolve "$HOST:443:$ip" -w '%{http_code}' "https://$HOST/" || true)
  case "$code" in
    2*|3*|4*) pick="$ip"; break ;;
  esac
done

if [ -z "$pick" ]; then
  echo "tg-ip-pin: no reachable $HOST IP right now, keeping current pin"
  exit 0
fi

# Host /etc/hosts (used by the poller - plain Node on the host).
if ! grep -Eq "^$pick[[:space:]]+$HOST([[:space:]]|\$)" /etc/hosts; then
  sed -i "/[[:space:]]$HOST\$/d" /etc/hosts
  echo "$pick $HOST" >> /etc/hosts
  echo "tg-ip-pin: host pinned $HOST -> $pick"
fi

# Container /etc/hosts (used by the app for replies/photo downloads).
# The file is a bind mount: sed -i would rename and fail, so rewrite via cat.
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^dogood$'; then
  docker exec -u 0 dogood sh -c "
    if ! grep -Eq '^$pick[[:space:]]+$HOST' /etc/hosts; then
      grep -v ' $HOST\$' /etc/hosts > /tmp/hosts.new || true
      echo '$pick $HOST' >> /tmp/hosts.new
      cat /tmp/hosts.new > /etc/hosts && rm -f /tmp/hosts.new
      echo 'tg-ip-pin: container pinned $HOST -> $pick'
    fi
  "
fi
