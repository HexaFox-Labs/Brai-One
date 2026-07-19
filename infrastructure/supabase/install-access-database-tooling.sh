#!/usr/bin/env bash

set -euo pipefail

source_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly source_root
readonly install_root=/srv/opt/brai-access
readonly dropin_root=/etc/systemd/system/brai-db-telegram-backup.service.d
readonly shared_backup=/srv/opt/brai-db-telegram-backup.sh

fail() {
  echo "brai-access database tooling installer: $*" >&2
  exit 1
}

if [[ ${EUID} -ne 0 ]]; then
  fail "run as root"
fi

for command in cmp docker grep install stat systemctl; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    fail "required host command is missing: ${command}"
  fi
done
if [[ ! -f ${shared_backup} || -L ${shared_backup} || ! -x ${shared_backup} ]]; then
  fail "shared backup program is absent or unsafe"
fi
if [[ $(stat --format='%u:%g' "${shared_backup}") != "0:0" ]]; then
  fail "shared backup program must be root-owned"
fi
shared_mode=$(stat --format='%a' "${shared_backup}")
if [[ $((8#${shared_mode} & 8#022)) -ne 0 ]]; then
  fail "shared backup program must not be group/world writable"
fi

install -d -o root -g root -m 0755 "${install_root}" "${install_root}/bin"
install -d -o root -g root -m 0755 "${dropin_root}"
install -o root -g root -m 0755 \
  "${source_root}/brai-access-backup" \
  "${install_root}/bin/pre-migration-backup"
install -o root -g root -m 0644 \
  "${source_root}/brai-access-backup.conf" \
  "${dropin_root}/zz-brai-access.conf"

systemctl daemon-reload
"${source_root}/status-access-database-tooling.sh"
echo "brai_access_database_tooling=installed"
