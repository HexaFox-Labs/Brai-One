#!/bin/sh
set -eu

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH LC_ALL=C

# shellcheck disable=SC2034
BRAI_STORAGE_PARENT=/srv/brai-storage
BRAI_STORAGE_BACKING=/srv/brai-storage/user-data.xfs
# shellcheck disable=SC2034
BRAI_STORAGE_MOUNT=/srv/brai-user-data
BRAI_STORAGE_CEILING_FILE=/etc/brai-agent-runtime/storage-ceiling-bytes
# shellcheck disable=SC2034
BRAI_STORAGE_MOUNT_UNIT='srv-brai\x2duser\x2ddata.mount'
BRAI_STORAGE_MINIMUM_BYTES=1073741824
BRAI_STORAGE_MAXIMUM_BYTES=1125899906842624
BRAI_STORAGE_FREE_PERCENT=10

die() {
  printf '%s\n' "brai-user-storage: $*" >&2
  exit 1
}

require_root() {
  [ "$(id -u)" -eq 0 ] || die "must run as root"
}

require_commands() {
  for command_name in "$@"; do
    command -v "$command_name" >/dev/null 2>&1 ||
      die "required command is missing: $command_name"
  done
}

is_positive_integer() {
  case ${1-} in
    ''|*[!0-9]*|0) return 1 ;;
    *) return 0 ;;
  esac
}

read_ceiling() {
  [ ! -L "$BRAI_STORAGE_CEILING_FILE" ] ||
    die "$BRAI_STORAGE_CEILING_FILE must not be a symlink"
  [ -f "$BRAI_STORAGE_CEILING_FILE" ] ||
    die "$BRAI_STORAGE_CEILING_FILE is missing"
  [ "$(stat -c '%u:%g' "$BRAI_STORAGE_CEILING_FILE")" = "0:0" ] ||
    die "$BRAI_STORAGE_CEILING_FILE must be root:root"
  ceiling_mode=$(stat -c '%a' "$BRAI_STORAGE_CEILING_FILE")
  case $ceiling_mode in
    600|640|644) ;;
    *) die "$BRAI_STORAGE_CEILING_FILE must not be writable by group/other" ;;
  esac
  ceiling=$(cat "$BRAI_STORAGE_CEILING_FILE")
  is_positive_integer "$ceiling" ||
    die "$BRAI_STORAGE_CEILING_FILE must contain one positive integer"
  [ "$ceiling" -ge "$BRAI_STORAGE_MINIMUM_BYTES" ] ||
    die "logical ceiling is below the supported 1 GiB minimum"
  [ "$ceiling" -le "$BRAI_STORAGE_MAXIMUM_BYTES" ] ||
    die "logical ceiling exceeds the supported finite maximum"
  [ $((ceiling % 4096)) -eq 0 ] ||
    die "logical ceiling must be aligned to 4096 bytes"
  printf '%s\n' "$ceiling"
}

assert_root_ext4_parent() {
  [ "$(findmnt -n -o FSTYPE --target "$BRAI_STORAGE_PARENT")" = "ext4" ] ||
    die "$BRAI_STORAGE_PARENT must be on the existing root ext4 filesystem"
  root_device=$(findmnt -n -o MAJ:MIN --target /)
  parent_device=$(findmnt -n -o MAJ:MIN --target "$BRAI_STORAGE_PARENT")
  [ "$parent_device" = "$root_device" ] ||
    die "$BRAI_STORAGE_PARENT is not on the root filesystem"
}

assert_root_owned_directory_chain() {
  directory=$1
  while :; do
    [ ! -L "$directory" ] ||
      die "$directory must not be a symlink"
    [ -d "$directory" ] ||
      die "$directory must be a directory"
    [ "$(stat -c '%u:%g' "$directory")" = "0:0" ] ||
      die "$directory must be root:root"
    directory_mode=$(stat -c '%a' "$directory")
    [ $((0$directory_mode & 022)) -eq 0 ] ||
      die "$directory must not be writable by group/other"
    [ "$directory" = "/" ] && break
    directory=$(dirname -- "$directory")
  done
}

assert_backing_file() {
  expected_ceiling=$1
  [ ! -L "$BRAI_STORAGE_BACKING" ] ||
    die "$BRAI_STORAGE_BACKING must not be a symlink"
  [ -f "$BRAI_STORAGE_BACKING" ] ||
    die "$BRAI_STORAGE_BACKING must be one regular file"
  [ "$(readlink -f -- "$BRAI_STORAGE_BACKING")" = "$BRAI_STORAGE_BACKING" ] ||
    die "$BRAI_STORAGE_BACKING is not canonical"
  [ "$(stat -c '%u:%g' "$BRAI_STORAGE_BACKING")" = "0:0" ] ||
    die "$BRAI_STORAGE_BACKING must be root:root"
  [ "$(stat -c '%a' "$BRAI_STORAGE_BACKING")" = "600" ] ||
    die "$BRAI_STORAGE_BACKING mode must be exactly 0600"
  logical_bytes=$(stat -c '%s' "$BRAI_STORAGE_BACKING")
  allocated_bytes=$(( $(stat -c '%b' "$BRAI_STORAGE_BACKING") * 512 ))
  [ "$logical_bytes" -eq "$expected_ceiling" ] ||
    die "backing logical size differs from the configured ceiling"
  [ "$allocated_bytes" -le "$logical_bytes" ] ||
    die "backing allocation exceeds its logical ceiling"
  [ "$(blkid -p -s TYPE -o value "$BRAI_STORAGE_BACKING")" = "xfs" ] ||
    die "$BRAI_STORAGE_BACKING does not contain XFS"
}

assert_root_unit_file() {
  unit_path=$1
  [ ! -L "$unit_path" ] ||
    die "$unit_path must not be a symlink"
  [ -f "$unit_path" ] ||
    die "$unit_path is not installed"
  [ "$(stat -c '%u:%g' "$unit_path")" = "0:0" ] ||
    die "$unit_path must be root:root"
  [ "$(stat -c '%a' "$unit_path")" = "644" ] ||
    die "$unit_path mode must be exactly 0644"
}

assert_free_floor() {
  path=$1
  description=$2
  df_values=$(df -P -B1 "$path" | awk 'NR == 2 { print $2 " " $4 }')
  total_bytes=${df_values%% *}
  available_bytes=${df_values#* }
  is_positive_integer "$total_bytes" ||
    die "cannot measure $description total space"
  is_positive_integer "$available_bytes" ||
    die "cannot measure $description free space"
  [ "$total_bytes" -gt 0 ] ||
    die "$description reports zero capacity"
  [ $((available_bytes * 100)) -ge $((total_bytes * BRAI_STORAGE_FREE_PERCENT)) ] ||
    die "$description is below the ${BRAI_STORAGE_FREE_PERCENT}% free-space floor"
}

assert_outer_growth_headroom() {
  outer_df_values=$(df -P -B1 "$BRAI_STORAGE_PARENT" |
    awk 'NR == 2 { print $2 " " $4 }')
  outer_total_bytes=${outer_df_values%% *}
  outer_available_bytes=${outer_df_values#* }
  is_positive_integer "$outer_total_bytes" ||
    die "cannot measure outer total space"
  is_positive_integer "$outer_available_bytes" ||
    die "cannot measure outer growth headroom"
  outer_reserve_bytes=$((
    (outer_total_bytes * BRAI_STORAGE_FREE_PERCENT + 99) / 100
  ))
  if [ "$outer_available_bytes" -gt "$outer_reserve_bytes" ]; then
    outer_growth_headroom_bytes=$((
      outer_available_bytes - outer_reserve_bytes
    ))
  else
    outer_growth_headroom_bytes=0
  fi
  unallocated_pool_bytes=$((logical_bytes - allocated_bytes))
  [ "$unallocated_pool_bytes" -le "$outer_growth_headroom_bytes" ] ||
    die "remaining sparse-pool growth would cross the outer ext4 free-space floor"
}
