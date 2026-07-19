#!/usr/bin/env bash

set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Запустите этот скрипт от root." >&2
  exit 1
fi

project_root=$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." &&
    pwd
)
database_hardening_file="${project_root}/infrastructure/supabase/hardening/0001_restrict_database_public_defaults.sql"
pg_net_hardening_file="${project_root}/infrastructure/supabase/hardening/0001_restrict_pg_net_public_usage.sql"

for hardening_file in \
  "${database_hardening_file}" \
  "${pg_net_hardening_file}"
do
  if [[ ! -r ${hardening_file} ]]; then
    echo "Не найден SQL hardening: ${hardening_file}" >&2
    exit 1
  fi
done

docker exec -i supabase-db \
  psql \
  -U postgres \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -f - <"${database_hardening_file}"

docker exec -i supabase-db \
  psql \
  -U supabase_admin \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -f - <"${pg_net_hardening_file}"

echo "runtime_role_hardening=applied"
