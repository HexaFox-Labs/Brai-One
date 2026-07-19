#!/bin/sh
set -eu

die() {
  printf '%s\n' "check-user-engine: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "must run as root"
[ "$#" -eq 1 ] || die "usage: check-user-engine ENVIRONMENT"
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

case "${BRAI_USERNS_START:-}" in
  ''|*[!0-9]*) die "outer UID start is invalid" ;;
esac
engine_uid=$((BRAI_USERNS_START + 1000))
socket=/run/brai-user-engines/$environment_name/docker.sock

attempt=0
while [ "$attempt" -lt 360 ]; do
  if [ -S "$socket" ]; then
    metadata=$(stat -c '%u:%g:%a' "$socket")
    case "$metadata" in
      "$engine_uid:$engine_uid:660"|"$engine_uid:$engine_uid:1660") ;;
      *) die "Docker socket owner or mode differs: $metadata" ;;
    esac
    if [ "$(curl -fsS --unix-socket "$socket" http://localhost/_ping)" = "OK" ]; then
      info=$(curl -fsS --unix-socket "$socket" http://localhost/info)
      printf '%s' "$info" | grep -F '"DockerRootDir":"/data/docker"' >/dev/null ||
        die "Docker data root escaped the user quota volume"
      printf '%s' "$info" | grep -F '"name=rootless"' >/dev/null ||
        die "Docker engine is not rootless"
      exit 0
    fi
  fi
  attempt=$((attempt + 1))
  sleep 0.25
done

die "Docker engine did not become ready"
