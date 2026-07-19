#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
# shellcheck source=storage-lib.sh
. "$SCRIPT_DIR/storage-lib.sh"

usage() {
  printf '%s\n' "Usage: $0 LOGICAL_CEILING_BYTES" >&2
  exit 2
}

require_root
[ "$#" -eq 1 ] || usage
ceiling=$1
is_positive_integer "$ceiling" || usage
[ "$ceiling" -ge "$BRAI_STORAGE_MINIMUM_BYTES" ] ||
  die "logical ceiling is below the supported 1 GiB minimum"
[ "$ceiling" -le "$BRAI_STORAGE_MAXIMUM_BYTES" ] ||
  die "logical ceiling exceeds the supported finite maximum"
[ $((ceiling % 4096)) -eq 0 ] ||
  die "logical ceiling must be aligned to 4096 bytes"
require_commands blkid cat findmnt mkfs.xfs stat systemctl truncate

if [ -e "$BRAI_STORAGE_PARENT" ]; then
  [ ! -L "$BRAI_STORAGE_PARENT" ] ||
    die "$BRAI_STORAGE_PARENT must not be a symlink"
  [ -d "$BRAI_STORAGE_PARENT" ] ||
    die "$BRAI_STORAGE_PARENT must be a directory"
  [ "$(readlink -f -- "$BRAI_STORAGE_PARENT")" = "$BRAI_STORAGE_PARENT" ] ||
    die "$BRAI_STORAGE_PARENT is not canonical"
  [ "$(stat -c '%u:%g' "$BRAI_STORAGE_PARENT")" = "0:0" ] ||
    die "$BRAI_STORAGE_PARENT must be root:root"
  [ "$(stat -c '%a' "$BRAI_STORAGE_PARENT")" = "700" ] ||
    die "$BRAI_STORAGE_PARENT mode must be exactly 0700"
else
  install -d -o root -g root -m 0700 "$BRAI_STORAGE_PARENT"
fi

if [ -e "$BRAI_STORAGE_MOUNT" ]; then
  [ ! -L "$BRAI_STORAGE_MOUNT" ] ||
    die "$BRAI_STORAGE_MOUNT must not be a symlink"
  [ -d "$BRAI_STORAGE_MOUNT" ] ||
    die "$BRAI_STORAGE_MOUNT must be a directory"
  [ "$(readlink -f -- "$BRAI_STORAGE_MOUNT")" = "$BRAI_STORAGE_MOUNT" ] ||
    die "$BRAI_STORAGE_MOUNT is not canonical"
  [ "$(stat -c '%u:%g' "$BRAI_STORAGE_MOUNT")" = "0:0" ] ||
    die "$BRAI_STORAGE_MOUNT must be root:root"
  [ "$(stat -c '%a' "$BRAI_STORAGE_MOUNT")" = "755" ] ||
    die "$BRAI_STORAGE_MOUNT mode must be exactly 0755 while unmounted"
else
  install -d -o root -g root -m 0755 "$BRAI_STORAGE_MOUNT"
fi

assert_root_ext4_parent
assert_root_owned_directory_chain "$BRAI_STORAGE_PARENT"

created_backing=0
cleanup_failed_install() {
  status=$?
  if [ "$status" -ne 0 ] && [ "$created_backing" -eq 1 ]; then
    rm -f -- "$BRAI_STORAGE_BACKING"
  fi
  exit "$status"
}
trap cleanup_failed_install EXIT
trap 'exit 1' HUP INT TERM

if [ -e "$BRAI_STORAGE_BACKING" ]; then
  assert_backing_file "$ceiling"
else
  umask 077
  set -C
  : >"$BRAI_STORAGE_BACKING"
  set +C
  created_backing=1
  chown root:root "$BRAI_STORAGE_BACKING"
  chmod 0600 "$BRAI_STORAGE_BACKING"
  truncate -s "$ceiling" "$BRAI_STORAGE_BACKING"
  mkfs.xfs -f -L brai-udata "$BRAI_STORAGE_BACKING" >/dev/null
  assert_backing_file "$ceiling"
fi
assert_outer_growth_headroom

if [ -e /etc/brai-agent-runtime ]; then
  [ ! -L /etc/brai-agent-runtime ] ||
    die "/etc/brai-agent-runtime must not be a symlink"
  [ -d /etc/brai-agent-runtime ] ||
    die "/etc/brai-agent-runtime must be a directory"
else
  install -d -o root -g root -m 0755 /etc/brai-agent-runtime
fi
assert_root_owned_directory_chain /etc/brai-agent-runtime
if [ -e "$BRAI_STORAGE_CEILING_FILE" ]; then
  [ "$(read_ceiling)" -eq "$ceiling" ] ||
    die "refusing to change the installed logical ceiling in place"
else
  temporary_ceiling=$(mktemp /etc/brai-agent-runtime/.storage-ceiling.XXXXXX)
  printf '%s\n' "$ceiling" >"$temporary_ceiling"
  chown root:root "$temporary_ceiling"
  chmod 0644 "$temporary_ceiling"
  mv -n "$temporary_ceiling" "$BRAI_STORAGE_CEILING_FILE"
  if [ -e "$temporary_ceiling" ]; then
    rm -f -- "$temporary_ceiling"
    die "concurrent ceiling-file installation detected"
  fi
fi

assert_root_unit_file /etc/systemd/system/brai-user-storage-setup.service
assert_root_unit_file "/etc/systemd/system/$BRAI_STORAGE_MOUNT_UNIT"
assert_root_unit_file /etc/systemd/system/brai-user-storage-trim.service
assert_root_unit_file /etc/systemd/system/brai-user-storage-trim.timer

created_backing=0
trap - EXIT HUP INT TERM
systemctl daemon-reload
systemctl enable --now "$BRAI_STORAGE_MOUNT_UNIT"
systemctl enable --now brai-user-storage-trim.timer
"$SCRIPT_DIR/status-user-storage.sh"
printf '%s\n' "brai-user-storage: installed and verified"
