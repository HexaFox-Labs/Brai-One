#!/bin/sh
set -eu

PATH=/opt/brai/docker/bin:/opt/brai/node/bin:/opt/brai/codex/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH LC_ALL=C

account=$(getent passwd brai)
[ "$account" = "brai:x:1000:1000::/data/home:/bin/bash" ] || {
  printf '%s\n' "unexpected brai account" >&2
  exit 1
}
[ "$(cat /etc/subuid)" = "brai:65536:65536" ]
[ "$(cat /etc/subgid)" = "brai:65536:65536" ]
[ "$(stat -c '%u:%a' /usr/bin/newuidmap)" = "0:4755" ]
[ "$(stat -c '%u:%a' /usr/bin/newgidmap)" = "0:4755" ]
[ "$(systemctl is-enabled systemd-networkd.service)" = "enabled" ]
[ "$(systemctl is-enabled systemd-resolved.service)" = "enabled" ]
[ "$(readlink /etc/resolv.conf)" = "../run/systemd/resolve/stub-resolv.conf" ]

for executable in \
  /opt/brai/docker/bin/dockerd-rootless.sh \
  /usr/libexec/docker/cli-plugins/docker-buildx \
  /usr/bin/rootlesskit \
  /usr/bin/slirp4netns \
  /usr/bin/fuse-overlayfs \
  /usr/bin/newuidmap \
  /usr/bin/newgidmap \
  /usr/bin/sqlite3 \
  /usr/lib/postgresql/16/bin/initdb \
  /usr/libexec/brai/brai-exec-gate \
  /usr/local/bin/brai-codex-exec \
  /opt/brai/node/bin/node \
  /opt/brai/codex/bin/codex
do
  [ -x "$executable" ] || {
    printf '%s\n' "missing guest executable: $executable" >&2
    exit 1
  }
done

[ "$(/opt/brai/node/bin/node --version)" = "v22.22.3" ]
[ "$(/opt/brai/codex/bin/codex --version)" = "codex-cli 0.144.5" ]
[ "$(/opt/brai/docker/bin/docker --version | awk '{ gsub(/,/, "", $3); print $3 }')" = "29.1.3" ]
grep -q '"data-root": "/data/docker"' \
  /etc/brai-agent-runtime/docker-daemon.json
grep -q '"exec-root": "/run/docker-exec"' \
  /etc/brai-agent-runtime/docker-daemon.json
grep -q '"storage-driver": "fuse-overlayfs"' \
  /etc/brai-agent-runtime/docker-daemon.json
[ ! -e /usr/lib/systemd/user/brai-rootless-docker.service ]

printf '%s\n' \
  '{"brai":{"username":"brai","uid":1000,"gid":1000},"executables":{"dockerd-rootless.sh":true,"rootlesskit":true,"slirp4netns":true,"fuse-overlayfs":true,"newuidmap":true,"newgidmap":true},"networkDriver":"slirp4netns","storageDriver":"fuse-overlayfs","subuidRanges":[{"start":65536,"count":65536}],"subgidRanges":[{"start":65536,"count":65536}],"newuidmap":{"exists":true,"ownerUid":0,"mode":2541},"newgidmap":{"exists":true,"ownerUid":0,"mode":2541},"toolchain":{"nodePath":"/opt/brai/node/bin/node","nodeVersion":"v22.22.3","codexPath":"/opt/brai/codex/bin/codex","codexVersion":"codex-cli 0.144.5","dockerPath":"/opt/brai/docker/bin/docker","dockerVersion":"29.1.3","rootlesskitPath":"/usr/bin/rootlesskit","sqlitePath":"/usr/bin/sqlite3","postgresInitdbPath":"/usr/lib/postgresql/16/bin/initdb"},"persistenceRoot":"/data"}'
