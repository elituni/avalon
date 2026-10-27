#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n $(git status --porcelain) ]]; then
  echo 'Commit or stash your changes before deploying.' >&2
  exit 1
fi
target=${1:-avalon-droplet}
ssh_config=${AVALON_SSH_CONFIG:-$HOME/.ssh/config}
ssh_args=(-F "$ssh_config" -o BatchMode=yes -o ConnectTimeout=10)
for cmd in git npm rsync ssh; do command -v "$cmd" >/dev/null; done
npm --prefix web test
revision=$(git rev-parse HEAD)
release="$(date -u +%Y%m%dT%H%M%SZ)-${revision:0:12}"
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
# Only these tracked files are shipped: no secrets, Git metadata, or local dependencies.
git archive HEAD package.json web shared | tar -x -C "$staging"
printf '%s\n' "$revision" > "$staging/REVISION"
ssh "${ssh_args[@]}" "$target" "mkdir -p /opt/avalon/releases/$release"
export AVALON_RSYNC_SSH_CONFIG="$ssh_config"
cat > "$staging/rsync-ssh" <<'SSH'
#!/usr/bin/env bash
exec ssh -F "$AVALON_RSYNC_SSH_CONFIG" -o BatchMode=yes -o ConnectTimeout=10 "$@"
SSH
chmod +x "$staging/rsync-ssh"
rsync -az --chmod=D755,F644 --exclude=rsync-ssh -e "$staging/rsync-ssh" "$staging/" "$target:/opt/avalon/releases/$release/"
ssh "${ssh_args[@]}" "$target" bash -s -- "$release" <<'REMOTE'
set -euo pipefail
release="/opt/avalon/releases/$1"
previous=$(readlink -f /opt/avalon/current || true)
bash "$release/web/deploy/setup.sh"
install -m 644 "$release/web/deploy/avalon.service" /etc/systemd/system/avalon.service
ln -sfn "$release" /opt/avalon/current.next
mv -Tf /opt/avalon/current.next /opt/avalon/current
systemctl daemon-reload
systemctl enable avalon
systemctl restart avalon
for attempt in {1..15}; do
  if systemctl is-active --quiet avalon && curl --max-time 3 -fsS http://127.0.0.1:3000/api/health; then
    printf '\nDeployed revision: '
    cat "$release/REVISION"
    exit 0
  fi
  sleep 1
done
journalctl -u avalon -n 30 --no-pager
if [[ -n "$previous" && "$previous" != /opt/avalon/current && -d "$previous" ]]; then
  ln -sfn "$previous" /opt/avalon/current
  previous_service="$previous/web/deploy/avalon.service"
  [[ -f "$previous_service" ]] || previous_service="$previous/deploy/avalon.service"
  install -m 644 "$previous_service" /etc/systemd/system/avalon.service
  systemctl daemon-reload
  systemctl restart avalon
  echo 'Health check failed; restored previous release.' >&2
else
  systemctl stop avalon
  echo 'Health check failed; stopped failed first deployment.' >&2
fi
exit 1
REMOTE
