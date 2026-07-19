#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
# shellcheck source=storage-lib.sh
. "$SCRIPT_DIR/storage-lib.sh"

usage() {
  printf '%s\n' \
    "Usage: $0 ENVIRONMENT_NAME PROJECT_ID EXPECTED_HARD_BYTES EXPECTED_HARD_INODES" >&2
  exit 2
}

require_root
[ "$#" -eq 4 ] || usage
environment_name=$1
project_id=$2
expected_bytes=$3
expected_inodes=$4
case $environment_name in
  brai-u-?*) ;;
  *) usage ;;
esac
environment_suffix=${environment_name#brai-u-}
case $environment_suffix in
  *[!0-9a-z]*) usage ;;
esac
[ "${#environment_name}" -le 32 ] || usage
for value in "$project_id" "$expected_bytes" "$expected_inodes"; do
  is_positive_integer "$value" || usage
done
[ "$project_id" -le 4294967295 ] || usage
[ "$expected_bytes" -le "$BRAI_STORAGE_MAXIMUM_BYTES" ] || usage
[ "$expected_inodes" -le 2147483647 ] || usage

require_commands awk findmnt xfs_quota
"$SCRIPT_DIR/status-user-storage.sh" >/dev/null
data_path="$BRAI_STORAGE_MOUNT/$environment_name"
[ -d "$data_path" ] || die "$data_path is missing"

project_output=$(xfs_quota -x -D /dev/null -P /dev/null \
  -c "project -c -p $data_path $project_id" "$BRAI_STORAGE_MOUNT" 2>&1)
project_check=$(printf '%s\n' "$project_output" |
  awk '
    !/^Checking project / &&
    !/^Processed [0-9]+ .* paths for project / &&
    !/^xfs_quota: skipping special file / &&
    NF { print }
  ')
[ -z "$project_check" ] ||
  die "$data_path is not a complete project-inheriting tree for $project_id"

quota_state=$(xfs_quota -x -D /dev/null -P /dev/null \
  -c "state -p" "$BRAI_STORAGE_MOUNT")
printf '%s\n' "$quota_state" | awk '
  /Project quota state/ { project = 1 }
  project && /Accounting:[[:space:]]+ON/ { accounting = 1 }
  project && /Enforcement:[[:space:]]+ON/ { enforcement = 1 }
  END { exit !(project && accounting && enforcement) }
' || die "XFS project quota accounting/enforcement is not active"

block_output=$(xfs_quota -x -D /dev/null -P /dev/null \
  -c "report -p -b -n -N -L $project_id -U $project_id" "$BRAI_STORAGE_MOUNT")
block_row=$(printf '%s\n' "$block_output" |
  awk -v id="$project_id" '$1 == id || $1 == ("#" id) { print; exit }')
inode_output=$(xfs_quota -x -D /dev/null -P /dev/null \
  -c "report -p -i -n -N -L $project_id -U $project_id" "$BRAI_STORAGE_MOUNT")
inode_row=$(printf '%s\n' "$inode_output" |
  awk -v id="$project_id" '$1 == id || $1 == ("#" id) { print; exit }')
[ -n "$block_row" ] || die "cannot measure project block limit"
[ -n "$inode_row" ] || die "cannot measure project inode limit"

measured_kib=$(printf '%s\n' "$block_row" | awk '{ print $4 }')
measured_inodes=$(printf '%s\n' "$inode_row" | awk '{ print $4 }')
is_positive_integer "$measured_kib" ||
  die "unexpected project block quota output"
is_positive_integer "$measured_inodes" ||
  die "unexpected project inode quota output"
measured_bytes=$((measured_kib * 1024))
[ "$measured_bytes" -eq "$expected_bytes" ] ||
  die "measured byte hard limit differs from persisted allocation"
[ "$measured_inodes" -eq "$expected_inodes" ] ||
  die "measured inode hard limit differs from persisted allocation"
storage_device=$(findmnt -n -o SOURCE --target "$BRAI_STORAGE_MOUNT")
case $storage_device in
  /dev/loop[0-9]*) ;;
  *) die "measured storage source is not the canonical loop device" ;;
esac

printf '%s\n' \
  "{\"dataPath\":\"$data_path\",\"storageDevice\":\"$storage_device\",\"configuredProjectId\":$project_id,\"treeProjectId\":$project_id,\"projectInheritance\":true,\"enforcementActive\":true,\"byteHardLimit\":$measured_bytes,\"inodeHardLimit\":$measured_inodes}"
