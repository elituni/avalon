#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n $(git status --porcelain) ]]; then
  echo 'Commit or stash your changes before deploying.' >&2
  exit 1
fi
for cmd in git npm rsync ssh; do command -v "$cmd" >/dev/null; done
npm --prefix discord-bot ci --ignore-scripts
npm test
target=${1:-avalon-droplet}
ssh_config=${AVALON_SSH_CONFIG:-$HOME/.ssh/config}
ssh_args=(-F "$ssh_config" -o BatchMode=yes -o ConnectTimeout=10)
# Check prerequisites before uploading or changing the running service.
ssh "${ssh_args[@]}" "$target" 'test -x /opt/node/bin/node && test -s /etc/avalon-bot.env && command -v systemd-notify >/dev/null'
revision=$(git rev-parse HEAD)
release="$(date -u +%Y%m%dT%H%M%SZ)-${revision:0:12}"
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
git archive HEAD package.json shared discord-bot | tar -x -C "$staging"
printf '%s\n' "$revision" > "$staging/REVISION"
ssh "${ssh_args[@]}" "$target" "mkdir -p /opt/avalon-bot/releases/$release"
export AVALON_RSYNC_SSH_CONFIG="$ssh_config"
cat > "$staging/rsync-ssh" <<'SSH'
#!/usr/bin/env bash
exec ssh -F "$AVALON_RSYNC_SSH_CONFIG" -o BatchMode=yes -o ConnectTimeout=10 "$@"
SSH
chmod +x "$staging/rsync-ssh"
rsync -az --chmod=D755,F644 --exclude=rsync-ssh -e "$staging/rsync-ssh" "$staging/" "$target:/opt/avalon-bot/releases/$release/"
ssh "${ssh_args[@]}" "$target" bash -s -- "$release" <<'REMOTE'
set -euo pipefail
release="/opt/avalon-bot/releases/$1"
previous=$(readlink -f /opt/avalon-bot/current || true)
id avalon-bot >/dev/null 2>&1 || useradd --system --home-dir /var/lib/avalon-bot --shell /usr/sbin/nologin avalon-bot
chmod 600 /etc/avalon-bot.env
chown root:root /etc/avalon-bot.env
PATH="/opt/node/bin:$PATH" /opt/node/bin/npm --prefix "$release/discord-bot" ci --omit=dev --ignore-scripts
install -m 644 "$release/discord-bot/deploy/avalon-bot.service" /etc/systemd/system/avalon-bot.service
ln -sfn "$release" /opt/avalon-bot/current.next
mv -Tf /opt/avalon-bot/current.next /opt/avalon-bot/current
systemctl daemon-reload
systemctl reset-failed avalon-bot 2>/dev/null || true
systemctl enable avalon-bot
# Type=notify waits for an authenticated Discord gateway connection.
if systemctl restart avalon-bot && systemctl is-active --quiet avalon-bot; then
  printf 'Deployed bot revision: '
  cat "$release/REVISION"
  exit 0
fi
journalctl -u avalon-bot -n 30 --no-pager
if [[ -n "$previous" && "$previous" != /opt/avalon-bot/current && -d "$previous" ]]; then
  ln -sfn "$previous" /opt/avalon-bot/current
  install -m 644 "$previous/discord-bot/deploy/avalon-bot.service" /etc/systemd/system/avalon-bot.service
  systemctl daemon-reload
  systemctl reset-failed avalon-bot 2>/dev/null || true
  systemctl restart avalon-bot
  echo 'Bot startup failed; restored previous release.' >&2
else
  systemctl stop avalon-bot
  echo 'Bot startup failed; stopped first deployment.' >&2
fi
exit 1
REMOTE
