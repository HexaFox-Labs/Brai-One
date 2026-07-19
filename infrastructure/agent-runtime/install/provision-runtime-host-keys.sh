#!/bin/sh
set -eu

die() {
  printf '%s\n' "provision-runtime-host-keys: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "must run as root"

KEY_ID=${1:-}
ACCESS_ENV=${2:-/etc/brai-new/access.env}
RUNTIME_ENV=/etc/brai-agent-runtime/runtime-host.env
case "$KEY_ID" in
  ""|*[!A-Za-z0-9._:@/-]*)
    die "invalid receipt signing key ID"
    ;;
esac
[ "${#KEY_ID}" -le 128 ] || die "receipt signing key ID is too long"
case "$KEY_ID" in
  [A-Za-z0-9]*) ;;
  *) die "receipt signing key ID must start with an alphanumeric" ;;
esac

CREDENTIALS=/etc/brai-agent-runtime/credentials
PRIVATE_KEY=$CREDENTIALS/runtime-receipt-private-key.pem
PUBLIC_KEY=$CREDENTIALS/runtime-receipt-public-key.pem
LAUNCH_PUBLIC_KEY=$CREDENTIALS/launch-contract-public-key.pem

install -d -o root -g root -m 0700 "$CREDENTIALS"
umask 077

if [ ! -e "$PRIVATE_KEY" ]; then
  temporary_private=$(mktemp "$CREDENTIALS/.runtime-private.XXXXXX")
  trap 'rm -f "$temporary_private"' EXIT HUP INT TERM
  /usr/bin/openssl genpkey -algorithm Ed25519 -out "$temporary_private"
  chown root:root "$temporary_private"
  chmod 0600 "$temporary_private"
  mv "$temporary_private" "$PRIVATE_KEY"
  trap - EXIT HUP INT TERM
fi

[ -f "$PRIVATE_KEY" ] && [ ! -L "$PRIVATE_KEY" ] ||
  die "private receipt key must be a regular non-symlink file"
[ "$(stat -c '%U:%G:%a' "$PRIVATE_KEY")" = "root:root:600" ] ||
  die "private receipt key must be root:root 0600"

temporary_public=$(mktemp "$CREDENTIALS/.runtime-public.XXXXXX")
trap 'rm -f "$temporary_public"' EXIT HUP INT TERM
/usr/bin/openssl pkey -in "$PRIVATE_KEY" -pubout -out "$temporary_public"
chown root:root "$temporary_public"
chmod 0644 "$temporary_public"
mv "$temporary_public" "$PUBLIC_KEY"
trap - EXIT HUP INT TERM

[ -f "$ACCESS_ENV" ] && [ ! -L "$ACCESS_ENV" ] ||
  die "access env must already exist as a regular non-symlink file"
[ -f "$RUNTIME_ENV" ] && [ ! -L "$RUNTIME_ENV" ] ||
  die "runtime host env must already exist as a regular non-symlink file"
access_mode=$(stat -c '%a' "$ACCESS_ENV")
access_owner=$(stat -c '%U:%G' "$ACCESS_ENV")
[ "$access_owner" = "root:root" ] ||
  die "access env must be root-owned"
case "$access_mode" in
  400|600) ;;
  *) die "access env containing the launch private key must be 0400 or 0600" ;;
esac

launch_key_id_count=$(
  /usr/bin/awk \
    '/^BRAI_ACCESS_LAUNCH_SIGNING_KEY_ID=/{count++} END{print count+0}' \
    "$ACCESS_ENV"
)
launch_private_count=$(
  /usr/bin/awk \
    '/^BRAI_ACCESS_LAUNCH_SIGNING_PRIVATE_KEY_BASE64=/{count++} END{print count+0}' \
    "$ACCESS_ENV"
)
[ "$launch_key_id_count" -eq 1 ] ||
  die "access env must contain exactly one launch signing key ID"
[ "$launch_private_count" -eq 1 ] ||
  die "access env must contain exactly one launch private key"
launch_key_id=$(
  /usr/bin/awk \
    '/^BRAI_ACCESS_LAUNCH_SIGNING_KEY_ID=/{
       sub(/^BRAI_ACCESS_LAUNCH_SIGNING_KEY_ID=/, "");
       print
     }' \
    "$ACCESS_ENV"
)
launch_private_base64=$(
  /usr/bin/awk \
    '/^BRAI_ACCESS_LAUNCH_SIGNING_PRIVATE_KEY_BASE64=/{
       sub(/^BRAI_ACCESS_LAUNCH_SIGNING_PRIVATE_KEY_BASE64=/, "");
       print
     }' \
    "$ACCESS_ENV"
)
case "$launch_key_id" in
  ""|*[!A-Za-z0-9._:-]*)
    die "invalid access launch signing key ID"
    ;;
esac
[ "${#launch_key_id}" -le 128 ] ||
  die "access launch signing key ID is too long"
case "$launch_key_id" in
  [A-Za-z0-9]*) ;;
  *) die "access launch signing key ID must start with an alphanumeric" ;;
esac
case "$launch_private_base64" in
  ""|*[!A-Za-z0-9+/=]*)
    die "access launch private key is not canonical base64"
    ;;
esac

temporary_launch_private=$(mktemp "$CREDENTIALS/.launch-private.XXXXXX")
temporary_launch_canonical=$(mktemp "$CREDENTIALS/.launch-canonical.XXXXXX")
temporary_launch_public=$(mktemp "$CREDENTIALS/.launch-public.XXXXXX")
temporary_launch_check=$(mktemp "$CREDENTIALS/.launch-check.XXXXXX")
trap '
  rm -f \
    "$temporary_launch_private" \
    "$temporary_launch_canonical" \
    "$temporary_launch_public" \
    "$temporary_launch_check"
' EXIT HUP INT TERM
printf '%s' "$launch_private_base64" |
  /usr/bin/base64 -d >"$temporary_launch_private" ||
  die "access launch private key base64 cannot be decoded"
[ "$(/usr/bin/base64 -w0 "$temporary_launch_private")" = \
  "$launch_private_base64" ] ||
  die "access launch private key base64 is not canonical"
last_private_byte=$(
  /usr/bin/tail -c 1 "$temporary_launch_private" |
    /usr/bin/od -An -tx1 |
    /usr/bin/tr -d ' '
)
[ "$last_private_byte" = "0a" ] ||
  die "access launch private PEM must end with one LF"
[ "$(/usr/bin/head -n 1 "$temporary_launch_private")" = \
  "-----BEGIN PRIVATE KEY-----" ] ||
  die "access launch private key is not PKCS#8 PEM"
[ "$(/usr/bin/tail -n 1 "$temporary_launch_private")" = \
  "-----END PRIVATE KEY-----" ] ||
  die "access launch private key has an invalid PEM footer"
/usr/bin/openssl pkey \
  -in "$temporary_launch_private" \
  -out "$temporary_launch_canonical" ||
  die "access launch private key is invalid"
/usr/bin/cmp -s \
  "$temporary_launch_private" \
  "$temporary_launch_canonical" ||
  die "access launch private key PEM is not canonical"
/usr/bin/openssl pkey \
  -in "$temporary_launch_private" \
  -pubout \
  -out "$temporary_launch_public" ||
  die "cannot derive launch contract public key"
/usr/bin/openssl pkey \
  -pubin \
  -in "$temporary_launch_public" \
  -text_pub \
  -noout >"$temporary_launch_check" ||
  die "derived launch contract public key is invalid"
/usr/bin/grep -q '^ED25519 Public-Key:' "$temporary_launch_check" ||
  die "access launch signing key must be Ed25519"
chown root:root "$temporary_launch_public"
chmod 0644 "$temporary_launch_public"
mv "$temporary_launch_public" "$LAUNCH_PUBLIC_KEY"
rm -f \
  "$temporary_launch_private" \
  "$temporary_launch_canonical" \
  "$temporary_launch_check"
trap - EXIT HUP INT TERM

public_base64=$(/usr/bin/base64 -w0 "$PUBLIC_KEY")
temporary_env=$(mktemp "$(dirname "$ACCESS_ENV")/.access-env.XXXXXX")
trap 'rm -f "$temporary_env"' EXIT HUP INT TERM
/usr/bin/awk \
  '!/^BRAI_RUNTIME_RECEIPT_SIGNING_KEY_ID=/ &&
   !/^BRAI_RUNTIME_RECEIPT_SIGNING_PUBLIC_KEY_BASE64=/' \
  "$ACCESS_ENV" >"$temporary_env"
printf '%s\n' \
  "BRAI_RUNTIME_RECEIPT_SIGNING_KEY_ID=$KEY_ID" \
  "BRAI_RUNTIME_RECEIPT_SIGNING_PUBLIC_KEY_BASE64=$public_base64" \
  >>"$temporary_env"
chown root:root "$temporary_env"
chmod "$access_mode" "$temporary_env"
mv "$temporary_env" "$ACCESS_ENV"
trap - EXIT HUP INT TERM

runtime_mode=$(stat -c '%a' "$RUNTIME_ENV")
runtime_owner=$(stat -c '%U:%G' "$RUNTIME_ENV")
[ "$runtime_owner" = "root:root" ] ||
  die "runtime host env must be root-owned"
temporary_runtime_env=$(
  mktemp "$(dirname "$RUNTIME_ENV")/.runtime-host-env.XXXXXX"
)
trap 'rm -f "$temporary_runtime_env"' EXIT HUP INT TERM
/usr/bin/awk \
  '!/^BRAI_RUNTIME_RECEIPT_KEY_ID=/ &&
   !/^BRAI_RUNTIME_LAUNCH_KEY_ID=/' \
  "$RUNTIME_ENV" >"$temporary_runtime_env"
printf '%s\n' \
  "BRAI_RUNTIME_LAUNCH_KEY_ID=$launch_key_id" \
  "BRAI_RUNTIME_RECEIPT_KEY_ID=$KEY_ID" \
  >>"$temporary_runtime_env"
chown root:root "$temporary_runtime_env"
chmod "$runtime_mode" "$temporary_runtime_env"
mv "$temporary_runtime_env" "$RUNTIME_ENV"
trap - EXIT HUP INT TERM

printf '%s\n' \
  "Runtime receipt keypair and launch verification public key are provisioned without copying either private key."
