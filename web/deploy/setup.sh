#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID != 0 ]]; then echo 'Run setup as root.' >&2; exit 1; fi
if [[ ! -x /opt/node/bin/node ]]; then
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  cd "$work"
  base=https://nodejs.org/dist/latest-v24.x
  curl -fsSLO "$base/SHASUMS256.txt"
  archive=$(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-x64.tar.xz$/ {print $2}' SHASUMS256.txt)
  [[ -n "$archive" && "$archive" != *$'\n'* ]]
  curl -fsSLO "$base/$archive"
  awk -v file="$archive" '$2 == file' SHASUMS256.txt | sha256sum --check -
  mkdir -p /opt/node
  tar -xJf "$archive" --strip-components=1 -C /opt/node
fi
/opt/node/bin/node --version
id avalon >/dev/null 2>&1 || useradd --system --home-dir /opt/avalon --shell /usr/sbin/nologin avalon
install -d -m 755 /opt/avalon/releases
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw allow 22/tcp
  ufw allow 3000/tcp
fi
