#!/bin/sh
set -eu

die() {
  printf '%s\n' "prepare-user-engine: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "must run as root"
[ "$#" -eq 1 ] || die "usage: prepare-user-engine ENVIRONMENT"
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
subid_start=$((BRAI_USERNS_START + 65536))
/srv/opt/brai-agent-runtime/bin/provision-user-engine-identity \
  "$environment_name" "$engine_uid" "$engine_gid" "$subid_start" 65536

[ -d "$BRAI_USER_DATA" ] && [ ! -L "$BRAI_USER_DATA" ] ||
  die "data path is not a trusted directory"
[ "$(stat -c '%u:%g:%a' "$BRAI_USER_DATA")" = "$engine_uid:$engine_gid:700" ] ||
  die "data root owner or mode differs"

ensure_data_directory() {
  path=$1
  if [ -e "$path" ]; then
    [ -d "$path" ] && [ ! -L "$path" ] ||
      die "persistent engine path is not a directory: $path"
    [ "$(stat -c '%u:%g:%a' "$path")" = "$engine_uid:$engine_gid:700" ] ||
      die "persistent engine path owner or mode differs: $path"
  else
    install -d -o "$engine_uid" -g "$engine_gid" -m 0700 "$path"
  fi
}

ensure_data_directory "$BRAI_USER_DATA/home"
if [ -e "$BRAI_USER_DATA/docker" ]; then
  [ -d "$BRAI_USER_DATA/docker" ] && [ ! -L "$BRAI_USER_DATA/docker" ] ||
    die "persistent engine path is not a directory: $BRAI_USER_DATA/docker"
  docker_metadata=$(stat -c '%u:%g:%a' "$BRAI_USER_DATA/docker")
  case "$docker_metadata" in
    "$engine_uid:$engine_gid:700"|"$engine_uid:$engine_gid:710") ;;
    *) die "persistent engine path owner or mode differs: $BRAI_USER_DATA/docker" ;;
  esac
else
  install -d -o "$engine_uid" -g "$engine_gid" -m 0700 \
    "$BRAI_USER_DATA/docker"
fi
ensure_data_directory "$BRAI_USER_DATA/docker-exec"
ensure_data_directory "$BRAI_USER_DATA/tmp"
find "$BRAI_USER_DATA/docker-exec" -mindepth 1 -delete

runtime_root=/run/brai-user-engines
runtime=$runtime_root/$environment_name
install -d -o root -g root -m 0755 "$runtime_root"
if [ -e "$runtime" ]; then
  [ -d "$runtime" ] && [ ! -L "$runtime" ] ||
    die "engine runtime path is not a directory"
  [ "$(stat -c '%u:%g:%a' "$runtime")" = "$engine_uid:$engine_gid:700" ] ||
    die "engine runtime owner or mode differs"
  find "$runtime" -mindepth 1 -delete
else
  install -d -o "$engine_uid" -g "$engine_gid" -m 0700 "$runtime"
fi
install -d -o "$engine_uid" -g "$engine_gid" -m 0700 \
  "$runtime/rootlesskit" "$runtime/systemd" "$runtime/systemd/resolve"
install -o "$engine_uid" -g "$engine_gid" -m 0600 \
  /srv/opt/brai-agent-runtime/share/user-engine-resolv.conf \
  "$runtime/systemd/resolve/stub-resolv.conf"

[ -c /dev/fuse ] || die "/dev/fuse is unavailable"
[ -x /usr/bin/newuidmap ] && [ -u /usr/bin/newuidmap ] ||
  die "setuid-root newuidmap is unavailable"
[ -x /usr/bin/newgidmap ] && [ -u /usr/bin/newgidmap ] ||
  die "setuid-root newgidmap is unavailable"
