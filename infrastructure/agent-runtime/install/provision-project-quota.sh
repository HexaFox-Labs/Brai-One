#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
# shellcheck source=storage-lib.sh
. "$SCRIPT_DIR/storage-lib.sh"

usage() {
  printf '%s\n' \
    "Usage: $0 ENVIRONMENT_NAME PROJECT_ID OWNER_UID OWNER_GID HARD_BYTES HARD_INODES" >&2
  exit 2
}

require_root
[ "$#" -eq 6 ] || usage
environment_name=$1
project_id=$2
owner_uid=$3
owner_gid=$4
hard_bytes=$5
hard_inodes=$6

case $environment_name in
  brai-u-?*) ;;
  *) usage ;;
esac
environment_suffix=${environment_name#brai-u-}
case $environment_suffix in
  *[!0-9a-z]*) usage ;;
esac
[ "${#environment_name}" -le 32 ] || usage
for value in "$project_id" "$owner_uid" "$owner_gid" "$hard_bytes" "$hard_inodes"; do
  is_positive_integer "$value" || usage
done
[ "$project_id" -ge 10000 ] || die "project ID is outside the Brai range"
[ "$project_id" -le 4294967295 ] ||
  die "project ID exceeds uint32"
[ "$owner_uid" -le 2147483647 ] ||
  die "owner UID exceeds the supported host range"
[ "$owner_gid" -le 2147483647 ] ||
  die "owner GID exceeds the supported host range"
[ "$owner_uid" -gt 1000 ] ||
  die "owner UID cannot encode the immutable outer root mapping"
[ "$owner_gid" -gt 1000 ] ||
  die "owner GID cannot encode the immutable outer root mapping"
[ $((hard_bytes % 4096)) -eq 0 ] ||
  die "byte hard limit must be aligned to 4096 bytes"
[ "$hard_inodes" -le 2147483647 ] ||
  die "inode hard limit exceeds the supported range"

require_commands awk find install readlink stat xfs_quota
"$SCRIPT_DIR/status-user-storage.sh"
ceiling=$(read_ceiling)
[ "$hard_bytes" -le "$ceiling" ] ||
  die "per-user byte hard limit exceeds the aggregate pool ceiling"
data_path="$BRAI_STORAGE_MOUNT/$environment_name"

existing_directory=0
if [ -e "$data_path" ]; then
  existing_directory=1
  [ ! -L "$data_path" ] || die "$data_path must not be a symlink"
  [ -d "$data_path" ] || die "$data_path must be a directory"
  [ "$(readlink -f -- "$data_path")" = "$data_path" ] ||
    die "$data_path is not canonical"
  [ "$(stat -c '%u:%g' "$data_path")" = "$owner_uid:$owner_gid" ] ||
    die "$data_path owner does not match the immutable allocation"
  [ "$(stat -c '%a' "$data_path")" = "700" ] ||
    die "$data_path mode must be exactly 0700"
else
  install -d -o "$owner_uid" -g "$owner_gid" -m 0700 "$data_path"
fi

if [ "$existing_directory" -eq 1 ]; then
  project_output=$(xfs_quota -x -D /dev/null -P /dev/null \
    -c "project -c -p $data_path $project_id" "$BRAI_STORAGE_MOUNT")
  project_mismatches=$(printf '%s\n' "$project_output" |
    awk '
      !/^Checking project / &&
      !/^Processed [0-9]+ .* paths for project / &&
      NF { print }
    ')
  first_entry=$(find "$data_path" -mindepth 1 -maxdepth 1 -print -quit)
  if [ -n "$project_mismatches" ] && [ -n "$first_entry" ]; then
    die "refusing to reassign a non-empty tree from a different project ID"
  fi
fi

xfs_quota -x -D /dev/null -P /dev/null \
  -c "project -s -p $data_path $project_id" \
  -c "limit -p bsoft=0 bhard=$hard_bytes isoft=0 ihard=$hard_inodes $project_id" \
  "$BRAI_STORAGE_MOUNT"

# These targets must exist before nspawn mounts its volatile /tmp and before
# guest systemd can run brai-prepare-data. The project-inheritance flag is
# already active, so newly created paths are covered by the same hard quota.
for runtime_path in "$data_path/tmp" "$data_path/var-tmp"; do
  if [ -e "$runtime_path" ]; then
    [ ! -L "$runtime_path" ] || die "$runtime_path must not be a symlink"
    [ -d "$runtime_path" ] || die "$runtime_path must be a directory"
    [ "$(stat -c '%u:%g' "$runtime_path")" = "$owner_uid:$owner_gid" ] ||
      die "$runtime_path owner does not match the immutable allocation"
    [ "$(stat -c '%a' "$runtime_path")" = "700" ] ||
      die "$runtime_path mode must be exactly 0700"
  else
    install -d -o "$owner_uid" -g "$owner_gid" -m 0700 "$runtime_path"
  fi
done

"$SCRIPT_DIR/measure-project-quota.sh" \
  "$environment_name" "$project_id" "$hard_bytes" "$hard_inodes" >/dev/null
printf '%s\n' "brai-user-storage: project quota provisioned and verified"
