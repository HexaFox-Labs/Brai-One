#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
# shellcheck source=storage-lib.sh
. "$SCRIPT_DIR/storage-lib.sh"

require_root
[ "$#" -eq 0 ] || die "usage: $0"
require_commands findmnt systemctl

# Deliberately retain the backing file and quota data. Removing user data is a
# separate, audited teardown operation and is never part of uninstall.
if systemctl list-unit-files brai-user-storage-trim.timer |
  awk '$1 == "brai-user-storage-trim.timer" { found = 1 } END { exit !found }'
then
  systemctl disable --now brai-user-storage-trim.timer
fi
mount_unit_load_state=$(systemctl show \
  --property=LoadState \
  --value \
  "$BRAI_STORAGE_MOUNT_UNIT")
if [ "$mount_unit_load_state" != "not-found" ]; then
  systemctl disable --now "$BRAI_STORAGE_MOUNT_UNIT"
elif findmnt -rn --target "$BRAI_STORAGE_MOUNT" |
  awk -v target="$BRAI_STORAGE_MOUNT" '$1 == target { found = 1 } END { exit !found }'
then
  die "storage is mounted but its canonical systemd mount unit is unavailable"
fi

if findmnt -rn --target "$BRAI_STORAGE_MOUNT" |
  awk -v target="$BRAI_STORAGE_MOUNT" '$1 == target { found = 1 } END { exit !found }'
then
  die "$BRAI_STORAGE_MOUNT remains mounted after unit shutdown"
fi

printf '%s\n' \
  "brai-user-storage: runtime mount disabled; backing file and all user data retained"
