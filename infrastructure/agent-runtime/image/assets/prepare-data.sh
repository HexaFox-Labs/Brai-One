#!/bin/sh
set -eu

[ "$(id -u)" -eq 1000 ] || {
  printf '%s\n' "prepare-data must run as brai (UID 1000)" >&2
  exit 1
}
[ -d /data ] && [ ! -L /data ] || {
  printf '%s\n' "/data is not the trusted bind mount" >&2
  exit 1
}

umask 077
for path in \
  /data/home \
  /data/workspace \
  /data/projects \
  /data/config \
  /data/config/docker-client \
  /data/cache \
  /data/local \
  /data/local/share \
  /data/tmp \
  /data/var-tmp \
  /data/docker \
  /data/docker-exec \
  /data/postgres \
  /data/backups
do
  if [ -L "$path" ]; then
    printf '%s\n' "refusing symlink in persistent runtime path: $path" >&2
    exit 1
  fi
  install -d -m 0700 "$path"
done
