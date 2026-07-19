#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
# shellcheck source=storage-lib.sh
. "$SCRIPT_DIR/storage-lib.sh"

require_root
case ${1-} in
  '') backing_only=0 ;;
  --backing-only) backing_only=1 ;;
  *) die "usage: $0 [--backing-only]" ;;
esac

require_commands awk blkid cat df findmnt losetup readlink stat systemctl
assert_root_owned_directory_chain /etc/brai-agent-runtime
ceiling=$(read_ceiling)
assert_root_ext4_parent
assert_root_owned_directory_chain "$BRAI_STORAGE_PARENT"
assert_backing_file "$ceiling"
assert_free_floor "$BRAI_STORAGE_PARENT" "outer root ext4 filesystem"
assert_outer_growth_headroom

if [ "$backing_only" -eq 1 ]; then
  printf '%s\n' "brai-user-storage: backing file verified"
  exit 0
fi

target=$(findmnt -n -o TARGET --target "$BRAI_STORAGE_MOUNT")
[ "$target" = "$BRAI_STORAGE_MOUNT" ] ||
  die "$BRAI_STORAGE_MOUNT is not an exact mount point"
source_device=$(findmnt -n -o SOURCE --target "$BRAI_STORAGE_MOUNT")
case $source_device in
  /dev/loop[0-9]*) ;;
  *) die "$BRAI_STORAGE_MOUNT source is not a loop device" ;;
esac
[ "$(findmnt -n -o FSTYPE --target "$BRAI_STORAGE_MOUNT")" = "xfs" ] ||
  die "$BRAI_STORAGE_MOUNT is not XFS"
mount_options=$(findmnt -n -o OPTIONS --target "$BRAI_STORAGE_MOUNT")
case ",$mount_options," in
  *,prjquota,*|*,pquota,*) ;;
  *) die "$BRAI_STORAGE_MOUNT lacks enforced project quota" ;;
esac

loop_output=$(losetup -j "$BRAI_STORAGE_BACKING" --noheadings --output NAME)
loop_matches=$(printf '%s\n' "$loop_output" |
  awk 'NF { count += 1; name = $1 } END { if (count == 1) print name }')
[ "$loop_matches" = "$source_device" ] ||
  die "mounted loop device does not uniquely map to $BRAI_STORAGE_BACKING"
assert_free_floor "$BRAI_STORAGE_MOUNT" "inner XFS pool"
systemctl is-enabled --quiet brai-user-storage-trim.timer ||
  die "brai-user-storage-trim.timer is not enabled"
systemctl is-active --quiet brai-user-storage-trim.timer ||
  die "brai-user-storage-trim.timer is not active"
printf '%s\n' "brai-user-storage: mounted one-disk pool verified"
