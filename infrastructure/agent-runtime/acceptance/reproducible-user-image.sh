#!/bin/sh
set -eu

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH LC_ALL=C

[ "$(id -u)" -eq 0 ] || {
  printf '%s\n' "reproducibility acceptance must run as root" >&2
  exit 1
}
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
BUILDER=$SCRIPT_DIR/../image/build-user-sandbox-image.sh
work=$(mktemp -d /var/tmp/brai-image-reproducibility.XXXXXX)

cleanup() {
  status=$?
  case $work in
    /var/tmp/brai-image-reproducibility.*) rm -rf -- "$work" ;;
    *) status=1 ;;
  esac
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

first=$work/first/user-sandbox-v1.raw
second=$work/second/user-sandbox-v1.raw
"$BUILDER" --output "$first"
"$BUILDER" --output "$second"
first_digest=$(sha256sum "$first" | awk '{ print $1 }')
second_digest=$(sha256sum "$second" | awk '{ print $1 }')
[ "$first_digest" = "$second_digest" ] || {
  printf '%s\n' \
    "same pinned source produced different image bytes: $first_digest != $second_digest" >&2
  exit 1
}
cmp "$first" "$second"
printf '%s\n' "reproducible shared image acceptance passed: $first_digest"
