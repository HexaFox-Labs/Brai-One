#!/bin/sh
set -eu

die() {
  printf '%s\n' "provision-runtime-host-nats: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "must run as root"

NATS_ENV=${1:-/etc/brai-new/nats.env}
RUNTIME_ENV=${2:-/etc/brai-agent-runtime/runtime-host.env}
CREDENTIALS=/etc/brai-agent-runtime/credentials
PASSWORD_FILE=$CREDENTIALS/nats-password

for file in "$NATS_ENV" "$RUNTIME_ENV"; do
  [ -f "$file" ] && [ ! -L "$file" ] ||
    die "$file must be a regular non-symlink file"
  [ "$(stat -c '%U:%G' "$file")" = "root:root" ] ||
    die "$file must be root-owned"
  case $(stat -c '%a' "$file") in
    400|600|644) ;;
    *) die "$file has an unsupported mode" ;;
  esac
done

count_key() {
  /usr/bin/awk -v key="$1" \
    'index($0, key "=") == 1 {count++} END {print count+0}' \
    "$NATS_ENV"
}

read_key() {
  /usr/bin/awk -v key="$1" \
    'index($0, key "=") == 1 {sub("^[^=]*=", ""); print}' \
    "$NATS_ENV"
}

[ "$(count_key NATS_RUNTIME_USER)" -eq 1 ] ||
  die "NATS env must contain exactly one NATS_RUNTIME_USER"
[ "$(count_key NATS_RUNTIME_PASSWORD)" -eq 1 ] ||
  die "NATS env must contain exactly one NATS_RUNTIME_PASSWORD"

runtime_user=$(read_key NATS_RUNTIME_USER)
runtime_password=$(read_key NATS_RUNTIME_PASSWORD)
case "$runtime_user" in
  ""|*[!A-Za-z0-9_.:@/-]*) die "invalid NATS runtime user" ;;
esac
case "$runtime_password" in
  ""|*[!A-Za-z0-9_-]*) die "invalid NATS runtime password" ;;
esac
[ "${#runtime_user}" -le 128 ] || die "NATS runtime user is too long"
[ "${#runtime_password}" -ge 32 ] ||
  die "NATS runtime password is too short"
[ "${#runtime_password}" -le 256 ] ||
  die "NATS runtime password is too long"

install -d -o root -g root -m 0700 "$CREDENTIALS"
umask 077

temporary_password=$(mktemp "$CREDENTIALS/.nats-password.XXXXXX")
temporary_runtime_env=$(
  mktemp "$(dirname "$RUNTIME_ENV")/.runtime-host-env.XXXXXX"
)
trap '
  rm -f "$temporary_password" "$temporary_runtime_env"
' EXIT HUP INT TERM

printf '%s\n' "$runtime_password" >"$temporary_password"
chown root:root "$temporary_password"
chmod 0600 "$temporary_password"

/usr/bin/awk \
  '!/^BRAI_RUNTIME_NATS_USER=/' \
  "$RUNTIME_ENV" >"$temporary_runtime_env"
printf '%s\n' "BRAI_RUNTIME_NATS_USER=$runtime_user" \
  >>"$temporary_runtime_env"
chown root:root "$temporary_runtime_env"
chmod "$(stat -c '%a' "$RUNTIME_ENV")" "$temporary_runtime_env"

mv -f "$temporary_password" "$PASSWORD_FILE"
mv -f "$temporary_runtime_env" "$RUNTIME_ENV"
trap - EXIT HUP INT TERM

printf '%s\n' \
  "Runtime host NATS identity is provisioned as a systemd credential."
