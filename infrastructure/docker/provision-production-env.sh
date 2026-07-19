#!/usr/bin/env bash

set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Запустите этот скрипт от root." >&2
  exit 1
fi

umask 077

config_dir=/etc/brai-new
nats_file="${config_dir}/nats.env"
migrations_file="${config_dir}/migrations.env"
access_migrations_file="${config_dir}/access-migrations.env"
access_bootstrap_file="${config_dir}/access-bootstrap.env"
access_file="${config_dir}/access.env"

fail() {
  echo "production env provisioning failed: $*" >&2
  exit 1
}

for required_command in \
  basename \
  chown \
  chmod \
  cut \
  getent \
  mkdir \
  mktemp \
  mv \
  node \
  openssl \
  sed \
  stat \
  tail
do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    fail "required host command is missing: ${required_command}"
  fi
done

assert_protected_existing_file() {
  local file=$1

  if [[ ! -e ${file} ]]; then
    return
  fi
  if [[ ! -f ${file} || -L ${file} ]]; then
    fail "${file} is not a regular non-symlink file"
  fi
  if [[ $(stat --format='%u:%g' "${file}") != "0:0" ]]; then
    fail "${file} is not root-owned"
  fi
  local mode
  mode=$(stat --format='%a' "${file}")
  if [[ $((8#${mode} & 8#077)) -ne 0 ]]; then
    fail "${file} is readable or writable outside root"
  fi
}

assert_supabase_deploy_source() {
  local file=$1

  if [[ ! -f ${file} || -L ${file} ]]; then
    fail "${file} is not a regular non-symlink file"
  fi
  local owner_uid owner_gid mode approved_gid
  owner_uid=$(stat --format='%u' "${file}")
  owner_gid=$(stat --format='%g' "${file}")
  mode=$(stat --format='%a' "${file}")
  approved_gid=$(getent group brai-db-admin | cut --delimiter=: --fields=3)
  if [[ ${owner_uid} != 0 ]]; then
    fail "${file} is not root-owned"
  fi
  if [[ ${mode} == 600 && ${owner_gid} == 0 ]]; then
    return
  fi
  if [[ ${mode} != 640 || -z ${approved_gid} || ${owner_gid} != "${approved_gid}" ]]; then
    fail "${file} must be root:root 0600 or root:brai-db-admin 0640"
  fi
}

read_env_value() {
  local file=$1
  local key=$2

  if [[ -f ${file} ]]; then
    sed -n "s/^${key}=//p" "${file}" | tail -n 1
  fi
}

read_database_password() {
  local file=$1
  local key=$2
  local expected_role=$3
  local database_url

  database_url=$(read_env_value "${file}" "${key}")
  if [[ -z ${database_url} ]]; then
    return
  fi

  DATABASE_URL="${database_url}" \
    EXPECTED_ROLE="${expected_role}" \
    node -e '
      const url = new URL(process.env.DATABASE_URL);
      if (decodeURIComponent(url.username) !== process.env.EXPECTED_ROLE) {
        process.exit(0);
      }
      process.stdout.write(decodeURIComponent(url.password));
    '
}

random_hex() {
  openssl rand -hex "$1"
}

ed25519_private_key_base64() {
  node -e '
    const { generateKeyPairSync } = require("node:crypto");
    const { privateKey } = generateKeyPairSync("ed25519");
    process.stdout.write(
      Buffer.from(
        privateKey.export({ format: "pem", type: "pkcs8" }),
      ).toString("base64"),
    );
  '
}

url_with_role() {
  local source_url=$1
  local role=$2
  local password=$3

  DATABASE_URL="${source_url}" \
    DATABASE_ROLE="${role}" \
    DATABASE_PASSWORD="${password}" \
    node -e '
      const url = new URL(process.env.DATABASE_URL);
      url.username = process.env.DATABASE_ROLE;
      url.password = process.env.DATABASE_PASSWORD;
      process.stdout.write(url.toString());
    '
}

write_env_file() {
  local target=$1
  shift
  local temporary

  temporary=$(mktemp "${config_dir}/.$(basename "${target}").XXXXXX")
  printf '%s\n' "$@" >"${temporary}"
  chown root:root "${temporary}"
  chmod 0600 "${temporary}"
  mv -f "${temporary}" "${target}"
}

if [[ -L ${config_dir} || (-e ${config_dir} && ! -d ${config_dir}) ]]; then
  fail "${config_dir} is not a regular directory"
fi
mkdir -p "${config_dir}"
if [[ $(stat --format='%u:%g' "${config_dir}") != "0:0" ]]; then
  fail "${config_dir} is not root-owned"
fi
chmod 0700 "${config_dir}"

for protected_file in \
  "${nats_file}" \
  "${migrations_file}" \
  "${access_migrations_file}" \
  "${access_bootstrap_file}" \
  "${access_file}" \
  "${config_dir}/gateway.env" \
  "${config_dir}/factory.env"
do
  assert_protected_existing_file "${protected_file}"
done

gateway_user=$(read_env_value "${nats_file}" NATS_GATEWAY_USER)
gateway_password=$(read_env_value "${nats_file}" NATS_GATEWAY_PASSWORD)
factory_user=$(read_env_value "${nats_file}" NATS_FACTORY_USER)
factory_password=$(read_env_value "${nats_file}" NATS_FACTORY_PASSWORD)
access_user=$(read_env_value "${nats_file}" NATS_ACCESS_USER)
access_password=$(read_env_value "${nats_file}" NATS_ACCESS_PASSWORD)
runtime_user=$(read_env_value "${nats_file}" NATS_RUNTIME_USER)
runtime_password=$(read_env_value "${nats_file}" NATS_RUNTIME_PASSWORD)
access_launch_key_id=$(
  read_env_value \
    "${access_file}" \
    BRAI_ACCESS_LAUNCH_SIGNING_KEY_ID
)
access_launch_private_key=$(
  read_env_value \
    "${access_file}" \
    BRAI_ACCESS_LAUNCH_SIGNING_PRIVATE_KEY_BASE64
)
runtime_receipt_key_id=$(
  read_env_value \
    "${access_file}" \
    BRAI_RUNTIME_RECEIPT_SIGNING_KEY_ID
)
runtime_receipt_public_key=$(
  read_env_value \
    "${access_file}" \
    BRAI_RUNTIME_RECEIPT_SIGNING_PUBLIC_KEY_BASE64
)
if [[ -n ${runtime_receipt_key_id} && -z ${runtime_receipt_public_key} ]] ||
  [[ -z ${runtime_receipt_key_id} && -n ${runtime_receipt_public_key} ]]; then
  fail "runtime receipt key ID and public key must be present together"
fi
gateway_user=${gateway_user:-$(read_env_value "${config_dir}/gateway.env" NATS_USER)}
gateway_password=${gateway_password:-$(read_env_value "${config_dir}/gateway.env" NATS_PASSWORD)}
factory_user=${factory_user:-$(read_env_value "${config_dir}/factory.env" NATS_USER)}
factory_password=${factory_password:-$(read_env_value "${config_dir}/factory.env" NATS_PASSWORD)}
access_user=${access_user:-$(read_env_value "${access_file}" NATS_USER)}
access_password=${access_password:-$(read_env_value "${access_file}" NATS_PASSWORD)}
runtime_database_password=$(
  read_env_value \
    "${migrations_file}" \
    BRAI_FACTORY_RUNTIME_DATABASE_PASSWORD
)
if [[ -z ${runtime_database_password} ]]; then
  runtime_database_password=$(
    read_database_password \
      "${config_dir}/factory.env" \
      DATABASE_URL \
      brai_factory_runtime
  )
fi
access_migrator_database_password=$(
  read_env_value \
    "${access_bootstrap_file}" \
    BRAI_ACCESS_MIGRATOR_DATABASE_PASSWORD
)
access_runtime_database_password=$(
  read_env_value \
    "${access_bootstrap_file}" \
    BRAI_ACCESS_RUNTIME_DATABASE_PASSWORD
)
if [[ -z ${access_migrator_database_password} ]]; then
  access_migrator_database_password=$(
    read_database_password \
      "${access_migrations_file}" \
      BRAI_ACCESS_MIGRATION_DATABASE_URL \
      brai_access_migrator
  )
fi
if [[ -z ${access_runtime_database_password} ]]; then
  access_runtime_database_password=$(
    read_database_password \
      "${access_file}" \
      BRAI_ACCESS_DATABASE_URL \
      brai_access_runtime
  )
fi

gateway_user=${gateway_user:-gateway_$(random_hex 8)}
gateway_password=${gateway_password:-$(random_hex 32)}
factory_user=${factory_user:-factory_$(random_hex 8)}
factory_password=${factory_password:-$(random_hex 32)}
access_user=${access_user:-access_$(random_hex 8)}
access_password=${access_password:-$(random_hex 32)}
runtime_user=${runtime_user:-runtime_$(random_hex 8)}
runtime_password=${runtime_password:-$(random_hex 32)}
access_launch_key_id=${access_launch_key_id:-access-launch:$(random_hex 8)}
if [[ -z ${access_launch_private_key} ]]; then
  access_launch_private_key=$(ed25519_private_key_base64)
fi
runtime_database_password=${runtime_database_password:-$(random_hex 32)}
access_migrator_database_password=${access_migrator_database_password:-$(random_hex 32)}
access_runtime_database_password=${access_runtime_database_password:-$(random_hex 32)}

supabase_deploy_env=/etc/brai/supabase-deploy.env

if [[ ! -r ${supabase_deploy_env} ]]; then
  echo "Не найден защищённый источник Supabase: ${supabase_deploy_env}" >&2
  exit 1
fi
assert_supabase_deploy_source "${supabase_deploy_env}"

# shellcheck disable=SC1090
source "${supabase_deploy_env}"

if [[ -z ${SUPABASE_SELF_HOSTED_DATABASE_URL:-} ]]; then
  echo "SUPABASE_SELF_HOSTED_DATABASE_URL не задан." >&2
  exit 1
fi

container_admin_database_url=$(
  DATABASE_URL="${SUPABASE_SELF_HOSTED_DATABASE_URL}" node -e '
    const url = new URL(process.env.DATABASE_URL);
    url.hostname = "supabase-db";
    url.port = "5432";
    url.username = "postgres";
    process.stdout.write(url.toString());
  '
)
factory_runtime_database_url=$(
  url_with_role \
    "${container_admin_database_url}" \
    brai_factory_runtime \
    "${runtime_database_password}"
)
access_migrator_database_url=$(
  url_with_role \
    "${container_admin_database_url}" \
    brai_access_migrator \
    "${access_migrator_database_password}"
)
access_runtime_database_url=$(
  url_with_role \
    "${container_admin_database_url}" \
    brai_access_runtime \
    "${access_runtime_database_password}"
)

write_env_file "${nats_file}" \
  "NATS_GATEWAY_USER=${gateway_user}" \
  "NATS_GATEWAY_PASSWORD=${gateway_password}" \
  "NATS_FACTORY_USER=${factory_user}" \
  "NATS_FACTORY_PASSWORD=${factory_password}" \
  "NATS_ACCESS_USER=${access_user}" \
  "NATS_ACCESS_PASSWORD=${access_password}" \
  "NATS_RUNTIME_USER=${runtime_user}" \
  "NATS_RUNTIME_PASSWORD=${runtime_password}"

write_env_file "${config_dir}/gateway.env" \
  "NODE_ENV=production" \
  "GATEWAY_HOST=0.0.0.0" \
  "GATEWAY_PORT=3201" \
  "LOG_LEVEL=info" \
  "NATS_SERVERS=nats://brai-nats:4222" \
  "NATS_USER=${gateway_user}" \
  "NATS_PASSWORD=${gateway_password}" \
  "NATS_INBOX_PREFIX=_INBOX.brai.gateway" \
  "NATS_REQUEST_TIMEOUT_MS=30000" \
  "PUBLIC_ORIGINS=https://factory.brai.one" \
  "ALLOW_LOOPBACK_HOSTS=true"

write_env_file "${config_dir}/factory.env" \
  "NATS_SERVERS=nats://brai-nats:4222" \
  "NATS_USER=${factory_user}" \
  "NATS_PASSWORD=${factory_password}" \
  "DATABASE_URL=${factory_runtime_database_url}" \
  "DATABASE_SSL=disable" \
  "DATABASE_POOL_MAX=10" \
  "DATABASE_CONNECTION_TIMEOUT_MS=3000" \
  "DATABASE_QUERY_TIMEOUT_MS=4000" \
  "LOG_LEVEL=info"

write_env_file "${migrations_file}" \
  "BRAI_FACTORY_MIGRATION_DATABASE_URL=${container_admin_database_url}" \
  "BRAI_FACTORY_MIGRATION_DATABASE_SSL=disable" \
  "BRAI_FACTORY_RUNTIME_DATABASE_PASSWORD=${runtime_database_password}"

write_env_file "${access_bootstrap_file}" \
  "BRAI_ACCESS_BOOTSTRAP_DATABASE_URL=${container_admin_database_url}" \
  "BRAI_ACCESS_BOOTSTRAP_DATABASE_SSL=disable" \
  "BRAI_ACCESS_MIGRATOR_DATABASE_PASSWORD=${access_migrator_database_password}" \
  "BRAI_ACCESS_RUNTIME_DATABASE_PASSWORD=${access_runtime_database_password}"

write_env_file "${access_migrations_file}" \
  "BRAI_ACCESS_MIGRATION_DATABASE_URL=${access_migrator_database_url}" \
  "BRAI_ACCESS_MIGRATION_DATABASE_SSL=disable"

access_env_lines=( \
  "NODE_ENV=production" \
  "NATS_SERVERS=nats://brai-nats:4222" \
  "NATS_USER=${access_user}" \
  "NATS_PASSWORD=${access_password}" \
  "NATS_INBOX_PREFIX=_INBOX.brai.access" \
  "NATS_REQUEST_TIMEOUT_MS=30000" \
  "BRAI_RUNTIME_LAUNCH_TIMEOUT_MS=90000" \
  "BRAI_ACCESS_LAUNCH_SIGNING_KEY_ID=${access_launch_key_id}" \
  "BRAI_ACCESS_LAUNCH_SIGNING_PRIVATE_KEY_BASE64=${access_launch_private_key}" \
  "BRAI_ACCESS_LAUNCH_CONTRACT_LIFETIME_MS=120000" \
  "BRAI_RUNTIME_RECEIPT_SIGNING_KEY_ID=${runtime_receipt_key_id}" \
  "BRAI_RUNTIME_RECEIPT_SIGNING_PUBLIC_KEY_BASE64=${runtime_receipt_public_key}" \
  "BRAI_ACCESS_DATABASE_URL=${access_runtime_database_url}" \
  "BRAI_ACCESS_DATABASE_SSL=disable" \
  "BRAI_ACCESS_DATABASE_POOL_MAX=10" \
  "BRAI_ACCESS_DATABASE_CONNECTION_TIMEOUT_MS=3000" \
  "BRAI_ACCESS_DATABASE_QUERY_TIMEOUT_MS=4000" \
  "LOG_LEVEL=info" \
)
write_env_file "${access_file}" "${access_env_lines[@]}"

chmod 0700 "${config_dir}"

echo "production_env=ready"
