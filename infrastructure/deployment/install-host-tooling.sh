#!/usr/bin/env bash

set -euo pipefail

source_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly source_root
readonly deployment_root=/srv/opt/brai-new-deploy
readonly config_root=/etc/brai-new
readonly backup_dropin_root=/etc/systemd/system/brai-db-telegram-backup.service.d
# shellcheck disable=SC1091
source "${source_root}/lib/deploy-principal.sh"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run install-host-tooling.sh as root" >&2
  exit 1
fi

if [[ $# -ne 1 || ! $1 =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
  echo "Usage: install-host-tooling.sh <github-owner/repository>" >&2
  exit 1
fi

for command in \
  docker \
  find \
  flock \
  getent \
  groupadd \
  id \
  node \
  passwd \
  ssh-keygen \
  stat \
  sudo \
  systemctl \
  useradd \
  visudo
do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required host command is missing: ${command}" >&2
    exit 1
  fi
done
docker compose version >/dev/null

exec 9>"/run/lock/brai-new-deploy.lock"
if ! flock -n 9; then
  echo "A Brai deployment or tooling update is already running" >&2
  exit 1
fi

if ! getent group "${BRAI_DEPLOY_GROUP}" >/dev/null; then
  if getent passwd "${BRAI_DEPLOY_USER}" >/dev/null; then
    echo "Deployment account exists without its dedicated group" >&2
    exit 1
  fi
  groupadd --system "${BRAI_DEPLOY_GROUP}"
fi
if ! getent passwd "${BRAI_DEPLOY_USER}" >/dev/null; then
  group_record=$(getent group "${BRAI_DEPLOY_GROUP}")
  IFS=: read -r group_name _ group_gid group_members <<<"${group_record}"
  if [[ ${group_name} != "${BRAI_DEPLOY_GROUP}" ||
    ! ${group_gid} =~ ^[0-9]+$ ||
    ${group_gid} == 0 ||
    -n ${group_members} ]]; then
    echo "Refusing to reuse an unsafe deployment group" >&2
    exit 1
  fi
  useradd \
    --system \
    --gid "${BRAI_DEPLOY_GROUP}" \
    --home-dir "${BRAI_DEPLOY_HOME}" \
    --shell "${BRAI_DEPLOY_SHELL}" \
    --no-create-home \
    --comment "Brai New immutable deployment receiver" \
    "${BRAI_DEPLOY_USER}"
  passwd --lock "${BRAI_DEPLOY_USER}" >/dev/null
fi

if [[ -L ${BRAI_DEPLOY_HOME} ]]; then
  echo "Deployment home must not be a symlink" >&2
  exit 1
elif [[ ! -e ${BRAI_DEPLOY_HOME} ]]; then
  install -d -o root -g root -m 0755 "${BRAI_DEPLOY_HOME}"
fi
if [[ -L ${BRAI_DEPLOY_SSH_DIR} ]]; then
  echo "Deployment SSH directory must not be a symlink" >&2
  exit 1
elif [[ ! -e ${BRAI_DEPLOY_SSH_DIR} ]]; then
  install -d -o root -g root -m 0755 "${BRAI_DEPLOY_SSH_DIR}"
fi
if [[ ! -d ${BRAI_DEPLOY_HOME} || ! -d ${BRAI_DEPLOY_SSH_DIR} ]]; then
  echo "Deployment home and SSH path must be directories" >&2
  exit 1
fi

# OpenSSH opens the configured key file under the target account UID. Migrate
# only the previously installed root-owned modes; broader or foreign-owned
# paths still fail closed instead of being repaired.
ssh_directory_owner=$(stat --format='%u:%g' "${BRAI_DEPLOY_SSH_DIR}")
ssh_directory_mode=$(stat --format='%a' "${BRAI_DEPLOY_SSH_DIR}")
if [[ ${ssh_directory_owner} != 0:0 ||
  ! ${ssh_directory_mode} =~ ^(700|755)$ ]]; then
  echo "Deployment SSH directory has unsafe ownership or mode" >&2
  exit 1
fi
if [[ -e ${BRAI_DEPLOY_AUTHORIZED_KEYS} ]]; then
  if [[ -L ${BRAI_DEPLOY_AUTHORIZED_KEYS} ||
    ! -f ${BRAI_DEPLOY_AUTHORIZED_KEYS} ]]; then
    echo "Deployment authorized keys path must be a regular file" >&2
    exit 1
  fi
  authorized_keys_owner=$(stat --format='%u:%g' \
    "${BRAI_DEPLOY_AUTHORIZED_KEYS}")
  authorized_keys_mode=$(stat --format='%a' \
    "${BRAI_DEPLOY_AUTHORIZED_KEYS}")
  if [[ ${authorized_keys_owner} != 0:0 ||
    ! ${authorized_keys_mode} =~ ^(600|644)$ ]]; then
    echo "Deployment authorized keys file has unsafe ownership or mode" >&2
    exit 1
  fi
fi
chmod 0755 "${BRAI_DEPLOY_SSH_DIR}"
if [[ -e ${BRAI_DEPLOY_AUTHORIZED_KEYS} ]]; then
  chmod 0644 "${BRAI_DEPLOY_AUTHORIZED_KEYS}"
fi
brai_deploy_assert_account

existing_state=$(brai_deploy_detect_state)
if [[ ${existing_state} == active ]]; then
  brai_deploy_assert_active
else
  brai_deploy_assert_inactive
fi

install -d -o root -g root -m 0755 \
  "${deployment_root}" \
  "${deployment_root}/bin" \
  "${deployment_root}/lib" \
  "${deployment_root}/releases"
install -d -o root -g root -m 0700 "${config_root}"
install -d -o root -g root -m 0755 "${backup_dropin_root}"
install -o root -g root -m 0755 \
  "${source_root}/bin/audit-deploy-principal" \
  "${deployment_root}/bin/audit-deploy-principal"
install -o root -g root -m 0755 \
  "${source_root}/bin/deploy-release" \
  "${deployment_root}/bin/deploy-release"
install -o root -g root -m 0755 \
  "${source_root}/bin/finalize-deploy-activation" \
  "${deployment_root}/bin/finalize-deploy-activation"
install -o root -g root -m 0755 \
  "${source_root}/bin/pre-migration-backup" \
  "${deployment_root}/bin/pre-migration-backup"
install -o root -g root -m 0755 \
  "${source_root}/bin/receive-release.mjs" \
  "${deployment_root}/bin/receive-release.mjs"
install -o root -g root -m 0644 \
  "${source_root}/lib/deploy-principal.sh" \
  "${deployment_root}/lib/deploy-principal.sh"
install -o root -g root -m 0644 \
  "${source_root}/lib/deployment-manifest.mjs" \
  "${deployment_root}/lib/deployment-manifest.mjs"
install -o root -g root -m 0644 \
  "${source_root}/compose.production.yml" \
  "${deployment_root}/compose.production.yml"
install -o root -g root -m 0644 \
  "${source_root}/../supabase/brai-factory-backup.conf" \
  "${backup_dropin_root}/brai-factory.conf"
systemctl daemon-reload

temporary_policy=$(mktemp "${config_root}/.deploy-policy.XXXXXX")
trap 'rm -f "${temporary_policy}"' EXIT
printf '{\n  "expected_repository": "%s"\n}\n' "$1" >"${temporary_policy}"
chown root:root "${temporary_policy}"
chmod 0600 "${temporary_policy}"
mv -f "${temporary_policy}" "${config_root}/deploy-policy.json"
trap - EXIT

if [[ ${existing_state} == active ]]; then
  "${deployment_root}/bin/audit-deploy-principal" active
else
  "${deployment_root}/bin/audit-deploy-principal" inactive
fi
echo "host_deployment_tooling=installed"
