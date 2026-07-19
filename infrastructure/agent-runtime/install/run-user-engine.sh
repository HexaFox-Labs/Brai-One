#!/bin/sh
set -eu

die() {
  printf '%s\n' "run-user-engine: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "launcher must start as root"
[ "$#" -eq 1 ] || die "usage: run-user-engine ENVIRONMENT"
environment_name=$1
case "$environment_name" in
  brai-u-?*) ;;
  *) die "invalid environment name" ;;
esac

environment_file=/etc/brai-agent-runtime/environments/$environment_name.env
[ -f "$environment_file" ] && [ ! -L "$environment_file" ] ||
  die "trusted environment binding is missing"
[ "$(stat -c '%u:%g:%a' "$environment_file")" = "0:0:600" ] ||
  die "trusted environment binding metadata differs"
set -a
. "$environment_file"
set +a

[ "${BRAI_USER_DATA:-}" = "/srv/brai-user-data/$environment_name" ] ||
  die "data path differs from the canonical environment"
case "${BRAI_USERNS_START:-}" in
  ''|*[!0-9]*) die "outer UID start is invalid" ;;
esac
engine_uid=$((BRAI_USERNS_START + 1000))
engine_gid=$engine_uid
engine_name=brai-eng-${environment_name#brai-u-}
runtime=/run/brai-user-engines/$environment_name

[ "$(stat -c '%u:%g:%a' "$BRAI_USER_DATA")" = "$engine_uid:$engine_gid:700" ] ||
  die "data root owner or mode differs"
[ "$(stat -c '%u:%g:%a' "$runtime")" = "$engine_uid:$engine_gid:700" ] ||
  die "runtime root owner or mode differs"

exec /usr/bin/setpriv \
  --reuid="$engine_uid" \
  --regid="$engine_gid" \
  --clear-groups \
  /usr/bin/env -i \
  USER="$engine_name" \
  LOGNAME="$engine_name" \
  HOME="$BRAI_USER_DATA/home" \
  XDG_RUNTIME_DIR="$runtime" \
  DOCKER_HOST="unix://$runtime/docker.sock" \
  DOCKERD_ROOTLESS_ROOTLESSKIT_NET=slirp4netns \
  DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=builtin \
  DOCKERD_ROOTLESS_ROOTLESSKIT_FLAGS=--pidns \
  DOCKERD_ROOTLESS_ROOTLESSKIT_STATE_DIR="$runtime/rootlesskit" \
  DOCKERD=/srv/opt/brai-user-engine/bin/dockerd \
  DOCKER_IGNORE_BR_NETFILTER_ERROR=1 \
  LD_LIBRARY_PATH=/srv/opt/brai-user-engine/lib \
  PATH=/srv/opt/brai-user-engine/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  /srv/opt/brai-user-engine/bin/dockerd-rootless.sh \
  --config-file=/etc/brai-agent-runtime/docker-daemon.json \
  "--host=unix://$runtime/docker.sock" \
  --group=0 \
  --exec-opt=native.cgroupdriver=cgroupfs \
  "--pidfile=$runtime/docker.pid"
