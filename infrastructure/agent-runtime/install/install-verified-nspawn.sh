#!/bin/sh
set -eu

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH LC_ALL=C

[ "$(id -u)" -eq 0 ] || {
  printf '%s\n' "installer must run as root" >&2
  exit 1
}
for command_name in cc install
do
  command -v "$command_name" >/dev/null 2>&1 || {
    printf '%s\n' "missing build dependency: $command_name" >&2
    exit 1
  }
done

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
SOURCE=$SCRIPT_DIR/../native/verified-nspawn.c
DESTINATION=/srv/opt/brai-agent-runtime/bin/verified-nspawn
work=$(mktemp -d /tmp/brai-verified-nspawn.XXXXXX)

cleanup() {
  status=$?
  case $work in
    /tmp/brai-verified-nspawn.*) rm -rf -- "$work" ;;
    *) status=1 ;;
  esac
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

cc -std=c17 -O2 -fPIE -pie -fstack-protector-strong \
  -D_FORTIFY_SOURCE=3 -Wformat -Wformat-security -Werror=format-security \
  -Wall -Wextra -Wpedantic \
  -Wl,-z,relro,-z,now \
  -o "$work/verified-nspawn" "$SOURCE" \
  -lcrypto

install -d -o 0 -g 0 -m 0755 "$(dirname -- "$DESTINATION")"
install -o 0 -g 0 -m 0755 "$work/verified-nspawn" "$DESTINATION.new"
mv -f -- "$DESTINATION.new" "$DESTINATION"
"$DESTINATION" \
  --image=/srv/opt/brai-agent-runtime/images/user-sandbox-v1.raw \
  --verify-only
