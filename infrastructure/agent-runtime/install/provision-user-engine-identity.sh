#!/bin/sh
set -eu

die() {
  printf '%s\n' "provision-user-engine-identity: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "must run as root"
[ "$#" -eq 5 ] ||
  die "usage: provision-user-engine-identity ENVIRONMENT ENGINE_UID ENGINE_GID SUBID_START SUBID_COUNT"

environment_name=$1
engine_uid=$2
engine_gid=$3
subid_start=$4
subid_count=$5

case "$environment_name" in
  brai-u-?*) ;;
  *) die "invalid environment name" ;;
esac
suffix=${environment_name#brai-u-}
case "$suffix" in
  *[!0-9a-z]*) die "invalid environment name" ;;
esac
for value in "$engine_uid" "$engine_gid" "$subid_start" "$subid_count"; do
  case "$value" in
    ''|*[!0-9]*) die "identity values must be canonical decimal integers" ;;
  esac
done

slot=$(awk -v value="$suffix" '
  BEGIN {
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    result = 0
    for (position = 1; position <= length(value); position++) {
      digit = index(digits, substr(value, position, 1)) - 1
      if (digit < 0) exit 1
      result = result * 36 + digit
    }
    printf "%d\n", result
  }
') || die "invalid base36 environment slot"
pool_start=1879048192
range_size=131072
expected_outer_start=$((pool_start + slot * range_size))
expected_engine_uid=$((expected_outer_start + 1000))
expected_subid_start=$((expected_outer_start + 65536))
engine_name=brai-eng-$suffix
[ "$slot" -ge 0 ] && [ "$slot" -le 2046 ] ||
  die "environment slot is outside the canonical pool"
[ "$engine_uid" -eq "$expected_engine_uid" ] ||
  die "engine UID differs from the canonical slot allocation"
[ "$engine_gid" -eq "$expected_engine_uid" ] ||
  die "engine GID differs from the canonical slot allocation"
[ "$subid_start" -eq "$expected_subid_start" ] ||
  die "engine subid start differs from the canonical slot allocation"
[ "$subid_count" -eq 65536 ] ||
  die "engine subid count must be 65536"

lock=/run/lock/brai-agent-runtime-host-id-pool.lock
checker=/srv/opt/brai-agent-runtime/bin/check-host-id-pool
[ -x "$checker" ] || die "host ID pool checker is missing"
for database in /etc/subuid /etc/subgid; do
  [ -f "$database" ] && [ ! -L "$database" ] ||
    die "$database is not a trusted regular file"
done

umask 077
exec 9>"$lock"
flock -x 9

if getent group "$engine_name" >/dev/null; then
  [ "$(getent group "$engine_name")" = "$engine_name:x:$engine_gid:" ] ||
    die "engine group differs from the canonical locked principal"
else
  ! getent group "$engine_gid" >/dev/null ||
    die "engine GID is already assigned"
  groupadd --gid "$engine_gid" "$engine_name"
fi

if getent passwd "$engine_name" >/dev/null; then
  expected_passwd="$engine_name:x:$engine_uid:$engine_gid::/nonexistent:/usr/sbin/nologin"
  [ "$(getent passwd "$engine_name")" = "$expected_passwd" ] ||
    die "engine account differs from the canonical locked principal"
else
  ! getent passwd "$engine_uid" >/dev/null ||
    die "engine UID is already assigned"
  useradd \
    --uid "$engine_uid" \
    --gid "$engine_gid" \
    --no-create-home \
    --home-dir /nonexistent \
    --shell /usr/sbin/nologin \
    --no-log-init \
    "$engine_name"
fi
[ "$(passwd -S "$engine_name" | awk '{ print $2 }')" = "L" ] ||
  die "engine account password is not locked"

install_entry() {
  database=$1
  expected="$engine_uid:$subid_start:$subid_count"
  matching=$(awk -F: -v owner="$engine_uid" '$1 == owner { print }' "$database")
  if [ -n "$matching" ]; then
    [ "$matching" = "$expected" ] ||
      die "$database already contains a conflicting engine delegation"
    return
  fi

  temporary=$(mktemp "${database}.brai.XXXXXX")
  trap 'rm -f "$temporary"' EXIT HUP INT TERM
  awk '1' "$database" >"$temporary"
  printf '%s\n' "$expected" >>"$temporary"
  chown root:root "$temporary"
  chmod 0644 "$temporary"
  mv -f "$temporary" "$database"
  trap - EXIT HUP INT TERM
}

install_entry /etc/subuid
install_entry /etc/subgid
"$checker" >/dev/null
