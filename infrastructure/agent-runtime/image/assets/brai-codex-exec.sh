#!/bin/sh
set -eu

[ "$(id -u)" -eq 1000 ] || {
  printf '%s\n' "brai-codex-exec must run as the unprivileged brai account" >&2
  exit 1
}
export HOME=/data/home
export XDG_CONFIG_HOME=/data/config
export XDG_CACHE_HOME=/data/cache
export XDG_DATA_HOME=/data/local/share
export TMPDIR=/data/tmp
export SQLITE_TMPDIR=/data/tmp
export DOCKER_CONFIG=/data/config/docker-client
export DOCKER_HOST=unix:///run/user/1000/docker.sock
export PATH=/opt/brai/docker/bin:/opt/brai/node/bin:/opt/brai/codex/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077

exec /opt/brai/codex/bin/codex exec \
  --dangerously-bypass-approvals-and-sandbox \
  --skip-git-repo-check \
  --ephemeral \
  --json \
  -C /data/workspace \
  -
