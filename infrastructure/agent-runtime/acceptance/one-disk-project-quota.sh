#!/bin/sh
set -eu

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH LC_ALL=C

[ "$(id -u)" -eq 0 ] || {
  printf '%s\n' "acceptance must run as root" >&2
  exit 1
}
for command_name in dd df findmnt fstrim mkfs.xfs mount mountpoint rm stat \
  sync truncate umount xfs_quota
do
  command -v "$command_name" >/dev/null 2>&1 || {
    printf '%s\n' "missing command: $command_name" >&2
    exit 1
  }
done

work=$(mktemp -d /tmp/brai-one-disk-acceptance.XXXXXX)
mount_path=$work/mount
backing=$work/user-data.xfs
data_path=$mount_path/brai-u-0
mounted=0

cleanup() {
  status=$?
  if [ "$mounted" -eq 1 ]; then
    if ! umount "$mount_path"; then
      printf '%s\n' \
        "acceptance cleanup could not unmount; retained $work for manual recovery" >&2
      exit 1
    fi
    mounted=0
  fi
  case $work in
    /tmp/brai-one-disk-acceptance.*) rm -rf -- "$work" ;;
    *) status=1 ;;
  esac
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

install -d -m 0700 "$mount_path"
truncate -s 1G "$backing"
chmod 0600 "$backing"
mkfs.xfs -f -L brai-accept "$backing" >/dev/null
[ $(( $(stat -c '%b' "$backing") * 512 )) -lt "$(stat -c '%s' "$backing")" ]

mount -o loop,prjquota,nodev,nosuid,nodiscard "$backing" "$mount_path"
mounted=1
case $(findmnt -n -o SOURCE --target "$mount_path") in
  /dev/loop[0-9]*) ;;
  *) printf '%s\n' "mount source is not a loop device" >&2; exit 1 ;;
esac

install -d -m 0700 "$data_path"
xfs_quota -x -D /dev/null -P /dev/null \
  -c "project -s -p $data_path 10000" \
  -c "limit -p bsoft=0 bhard=8388608 isoft=0 ihard=32 10000" \
  "$mount_path" >/dev/null

allocated_before_write=$(( $(stat -c '%b' "$backing") * 512 ))
set +e
dd if=/dev/zero of="$data_path/quota-probe.bin" \
  bs=1M count=9 status=none 2>"$work/dd-error"
write_status=$?
set -e
[ "$write_status" -ne 0 ]
[ "$(stat -c '%s' "$data_path/quota-probe.bin")" -eq 8388608 ]
sync -f "$data_path/quota-probe.bin"
allocated_after_write=$(( $(stat -c '%b' "$backing") * 512 ))
[ "$allocated_after_write" -gt "$allocated_before_write" ]

quota_row=$(xfs_quota -x -D /dev/null -P /dev/null \
  -c "report -p -b -n -N -L 10000 -U 10000" "$mount_path")
quota_id=$(printf '%s\n' "$quota_row" | awk '{ print $1 }')
quota_hard_kib=$(printf '%s\n' "$quota_row" | awk '{ print $4 }')
[ "$quota_id" = "#10000" ]
[ "$quota_hard_kib" -eq 8192 ]
available_bytes=$(df -P -B1 "$mount_path" |
  awk 'NR == 2 { print $4 }')
[ "$available_bytes" -gt 0 ]

rm -f -- "$data_path/quota-probe.bin"
sync -f "$data_path"
fstrim "$mount_path" >/dev/null
sync -f "$mount_path"
allocated_after_trim=$(( $(stat -c '%b' "$backing") * 512 ))
[ "$allocated_after_trim" -lt "$allocated_after_write" ]

printf '%s\n' \
  "one-disk acceptance passed: sparse loop XFS, exact quota stop, fstrim hole reclamation"
