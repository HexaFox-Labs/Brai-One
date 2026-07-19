#!/usr/bin/env bash

set -euo pipefail

source_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly source_root
readonly install_root=/srv/opt/brai-access
readonly installed_wrapper="${install_root}/bin/pre-migration-backup"
readonly dropin_root=/etc/systemd/system/brai-db-telegram-backup.service.d
readonly installed_dropin="${dropin_root}/zz-brai-access.conf"

fail() {
  echo "brai-access database tooling status: $*" >&2
  exit 1
}

assert_installed_file() {
  local installed=$1
  local source=$2
  local expected_mode=$3

  if [[ ! -f ${installed} || -L ${installed} ]]; then
    fail "${installed} is not a regular file"
  fi
  if [[ $(stat --format='%u:%g' "${installed}") != "0:0" ]]; then
    fail "${installed} is not root-owned"
  fi
  if [[ $(stat --format='%a' "${installed}") != "${expected_mode}" ]]; then
    fail "${installed} has an unexpected mode"
  fi
  if ! cmp --silent "${source}" "${installed}"; then
    fail "${installed} differs from checked-in source"
  fi
}

if [[ ${EUID} -ne 0 ]]; then
  fail "run as root"
fi

for command in cmp grep stat systemctl; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    fail "required host command is missing: ${command}"
  fi
done

assert_installed_file \
  "${installed_wrapper}" \
  "${source_root}/brai-access-backup" \
  755
assert_installed_file \
  "${installed_dropin}" \
  "${source_root}/brai-access-backup.conf" \
  644

if ! grep --fixed-strings --quiet \
  "BRAI_REQUIRED_BACKUP_SCHEMAS=brai_factory brai_access" \
  "${installed_dropin}"; then
  fail "drop-in does not require both Brai schemas"
fi
if ! grep --fixed-strings --quiet \
  "ExecStart=/srv/opt/brai-access/bin/pre-migration-backup" \
  "${installed_dropin}"; then
  fail "drop-in does not invoke the access-owned wrapper"
fi

effective_exec_start=$(
  systemctl show \
    --property=ExecStart \
    --value \
    brai-db-telegram-backup.service
)
if [[ ${effective_exec_start} != *"/srv/opt/brai-access/bin/pre-migration-backup"* ]]; then
  fail "effective systemd ExecStart does not use the access-owned wrapper"
fi
if [[ ${effective_exec_start} == *"/srv/opt/brai-new-deploy/"* ]]; then
  fail "effective systemd ExecStart still depends on deployment tooling"
fi

effective_environment=$(
  systemctl show \
    --property=Environment \
    --value \
    brai-db-telegram-backup.service
)
if [[ ${effective_environment} != *"BRAI_REQUIRED_BACKUP_SCHEMAS=brai_factory brai_access"* ]]; then
  fail "effective systemd environment does not require both Brai schemas"
fi

echo "brai_access_database_tooling=ready"
