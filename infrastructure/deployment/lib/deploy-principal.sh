#!/usr/bin/env bash

# Shared, root-owned contract for the production deployment SSH identity.
# This file is sourced by the installer and by the installed activation tools.

readonly BRAI_DEPLOY_USER=brai-new-deploy
readonly BRAI_DEPLOY_GROUP=brai-new-deploy
readonly BRAI_DEPLOY_HOME=/srv/opt/brai-new-deploy-home
readonly BRAI_DEPLOY_SSH_DIR="${BRAI_DEPLOY_HOME}/.ssh"
readonly BRAI_DEPLOY_AUTHORIZED_KEYS="${BRAI_DEPLOY_SSH_DIR}/authorized_keys"
readonly BRAI_DEPLOY_EXPECTED_KEY=/etc/brai-new/deploy-authorized-key.pub
readonly BRAI_DEPLOY_SUDOERS=/etc/sudoers.d/brai-new-deploy
readonly BRAI_DEPLOY_RECEIVER=/srv/opt/brai-new-deploy/bin/receive-release.mjs
readonly BRAI_DEPLOY_REMOTE_COMMAND="sudo -n ${BRAI_DEPLOY_RECEIVER}"
readonly BRAI_DEPLOY_SHELL=/bin/sh

brai_deploy_fail() {
  echo "$*" >&2
  return 1
}

brai_deploy_require_root() {
  if [[ ${EUID} -ne 0 ]]; then
    brai_deploy_fail "Deployment-principal administration must run as root"
  fi
}

brai_deploy_assert_exact_path() {
  local path=$1
  local expected_type=$2
  local expected_owner=$3
  local expected_mode=$4
  local actual_owner
  local actual_mode

  if [[ -L ${path} ]]; then
    brai_deploy_fail "Deployment-principal path must not be a symlink: ${path}"
    return
  fi
  case ${expected_type} in
    directory)
      [[ -d ${path} ]] ||
        brai_deploy_fail "Missing deployment-principal directory: ${path}"
      ;;
    file)
      [[ -f ${path} ]] ||
        brai_deploy_fail "Missing deployment-principal file: ${path}"
      ;;
    *)
      brai_deploy_fail "Unknown path type: ${expected_type}"
      ;;
  esac
  actual_owner=$(stat --format='%u:%g' -- "${path}")
  actual_mode=$(stat --format='%a' -- "${path}")
  if [[ ${actual_owner} != "${expected_owner}" || ${actual_mode} != "${expected_mode}" ]]; then
    brai_deploy_fail \
      "Unexpected deployment-principal owner or mode: ${path}"
  fi
}

brai_deploy_assert_account() {
  local group_record
  local group_name
  local group_gid
  local group_members
  local passwd_record
  local passwd_name
  local passwd_uid
  local passwd_gid
  local passwd_home
  local passwd_shell
  local shadow_record
  local shadow_name
  local shadow_password
  local -a effective_gids

  group_record=$(getent group "${BRAI_DEPLOY_GROUP}") ||
    brai_deploy_fail "Missing dedicated deployment group"
  IFS=: read -r \
    group_name _ group_gid group_members <<<"${group_record}"
  if [[ ${group_name} != "${BRAI_DEPLOY_GROUP}" ||
    ! ${group_gid} =~ ^[0-9]+$ ||
    ${group_gid} == 0 ||
    -n ${group_members} ]]; then
    brai_deploy_fail "Dedicated deployment group has unexpected members or fields"
  fi

  passwd_record=$(getent passwd "${BRAI_DEPLOY_USER}") ||
    brai_deploy_fail "Missing dedicated deployment account"
  IFS=: read -r \
    passwd_name _ passwd_uid passwd_gid _ \
    passwd_home passwd_shell <<<"${passwd_record}"
  if [[ ${passwd_name} != "${BRAI_DEPLOY_USER}" ||
    ! ${passwd_uid} =~ ^[0-9]+$ ||
    ${passwd_uid} == 0 ||
    ${passwd_gid} != "${group_gid}" ||
    ${passwd_home} != "${BRAI_DEPLOY_HOME}" ||
    ${passwd_shell} != "${BRAI_DEPLOY_SHELL}" ]]; then
    brai_deploy_fail "Dedicated deployment account has unexpected fields"
  fi

  shadow_record=$(getent shadow "${BRAI_DEPLOY_USER}") ||
    brai_deploy_fail "Missing deployment account shadow entry"
  IFS=: read -r shadow_name shadow_password _ <<<"${shadow_record}"
  if [[ ${shadow_name} != "${BRAI_DEPLOY_USER}" ||
    ! ${shadow_password} =~ ^[\!\*] ]]; then
    brai_deploy_fail "Deployment account password must remain locked"
  fi

  read -r -a effective_gids <<<"$(id -G "${BRAI_DEPLOY_USER}")"
  if [[ ${#effective_gids[@]} -ne 1 ||
    ${effective_gids[0]} != "${group_gid}" ||
    $(id -gn "${BRAI_DEPLOY_USER}") != "${BRAI_DEPLOY_GROUP}" ]]; then
    brai_deploy_fail \
      "Deployment account must have only its dedicated primary group"
  fi

  brai_deploy_assert_exact_path "${BRAI_DEPLOY_HOME}" directory 0:0 755
  brai_deploy_assert_exact_path "${BRAI_DEPLOY_SSH_DIR}" directory 0:0 700
}

brai_deploy_assert_directory_entries() {
  local directory=$1
  shift
  local -a expected=("$@")
  local -a actual

  mapfile -t actual < <(
    find "${directory}" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort
  )
  if [[ ${actual[*]-} != "${expected[*]-}" ]]; then
    brai_deploy_fail "Unexpected files in protected directory: ${directory}"
  fi
}

brai_deploy_read_canonical_key() {
  local source_path=$1
  local source_owner
  local source_mode
  local key_type
  local key_data
  local temporary_key
  local -a key_lines

  if [[ -L ${source_path} || ! -f ${source_path} ]]; then
    brai_deploy_fail "Deployment public key source must be a regular file"
    return
  fi
  source_owner=$(stat --format='%u:%g' -- "${source_path}")
  source_mode=$(stat --format='%a' -- "${source_path}")
  if [[ ${source_owner} != 0:0 || ${source_mode} != 600 ]]; then
    brai_deploy_fail \
      "Deployment public key source must be root-owned mode 0600"
    return
  fi

  mapfile -t key_lines <"${source_path}"
  if [[ ${#key_lines[@]} -ne 1 ||
    -z ${key_lines[0]} ||
    ${key_lines[0]} == *$'\r'* ||
    ${key_lines[0]} == *$'\t'* ]]; then
    brai_deploy_fail "Deployment public key source must contain exactly one key"
    return
  fi
  read -r key_type key_data _ <<<"${key_lines[0]}"
  if [[ ${key_type} != ssh-ed25519 ||
    ! ${key_data} =~ ^[A-Za-z0-9+/]+={0,2}$ ]]; then
    brai_deploy_fail "Deployment public key must be a bare Ed25519 public key"
    return
  fi

  temporary_key=$(mktemp)
  chmod 0600 "${temporary_key}"
  printf '%s %s\n' "${key_type}" "${key_data}" >"${temporary_key}"
  if ! ssh-keygen -l -f "${temporary_key}" >/dev/null 2>&1; then
    rm -f "${temporary_key}"
    brai_deploy_fail "Deployment public key is invalid"
    return
  fi
  rm -f "${temporary_key}"
  printf '%s %s' "${key_type}" "${key_data}"
}

brai_deploy_expected_authorized_key() {
  local canonical_key=$1
  printf 'restrict,command="%s" %s' \
    "${BRAI_DEPLOY_REMOTE_COMMAND}" "${canonical_key}"
}

brai_deploy_expected_sudoers() {
  printf '%s ALL=(root) NOPASSWD: %s' \
    "${BRAI_DEPLOY_USER}" "${BRAI_DEPLOY_RECEIVER}"
}

brai_deploy_assert_effective_sudo() {
  local sudo_output
  local line
  local normalized
  local expected
  local -a command_specs=()

  expected="(root) NOPASSWD: ${BRAI_DEPLOY_RECEIVER}"
  if ! sudo_output=$(
    LC_ALL=C COLUMNS=4096 sudo -n -l -U "${BRAI_DEPLOY_USER}" 2>&1
  ); then
    brai_deploy_fail "Cannot enumerate effective deployment sudo rules"
    return
  fi
  while IFS= read -r line; do
    if [[ ${line} =~ ^[[:space:]]*\( ]]; then
      normalized=${line#"${line%%[![:space:]]*}"}
      normalized=${normalized%"${normalized##*[![:space:]]}"}
      command_specs+=("${normalized}")
    fi
  done <<<"${sudo_output}"
  if [[ ${#command_specs[@]} -ne 1 ||
    ${command_specs[0]} != "${expected}" ]]; then
    brai_deploy_fail \
      "Deployment account has missing, duplicate, or broader effective sudo rules"
  fi
}

brai_deploy_assert_no_effective_sudo() {
  local sudo_output
  local sudo_status
  local line
  local -a command_specs=()

  if sudo_output=$(
    LC_ALL=C COLUMNS=4096 sudo -n -l -U "${BRAI_DEPLOY_USER}" 2>&1
  ); then
    sudo_status=0
  else
    sudo_status=$?
  fi
  while IFS= read -r line; do
    if [[ ${line} =~ ^[[:space:]]*\( ]]; then
      command_specs+=("${line}")
    fi
  done <<<"${sudo_output}"
  if [[ ${#command_specs[@]} -ne 0 ]]; then
    brai_deploy_fail \
      "Inactive deployment account already has effective sudo rights"
    return
  fi
  if [[ ${sudo_status} -ne 0 &&
    ! ${sudo_output} =~ User[[:space:]]${BRAI_DEPLOY_USER}[[:space:]]is[[:space:]]not[[:space:]]allowed[[:space:]]to[[:space:]]run[[:space:]]sudo[[:space:]]on[[:space:]] ]]; then
    brai_deploy_fail "Cannot prove that inactive deployment sudo rights are empty"
  fi
}

brai_deploy_assert_inactive() {
  brai_deploy_assert_account
  brai_deploy_assert_directory_entries "${BRAI_DEPLOY_HOME}" .ssh
  brai_deploy_assert_directory_entries "${BRAI_DEPLOY_SSH_DIR}"
  for path in \
    "${BRAI_DEPLOY_AUTHORIZED_KEYS}" \
    "${BRAI_DEPLOY_EXPECTED_KEY}" \
    "${BRAI_DEPLOY_SUDOERS}"
  do
    if [[ -e ${path} || -L ${path} ]]; then
      brai_deploy_fail "Inactive deployment identity has authorization state"
    fi
  done
  brai_deploy_assert_no_effective_sudo
}

brai_deploy_assert_active() {
  local canonical_key
  local actual_authorized_key
  local actual_sudoers
  local expected_authorized_key
  local expected_sudoers

  brai_deploy_assert_account
  brai_deploy_assert_directory_entries "${BRAI_DEPLOY_HOME}" .ssh
  brai_deploy_assert_directory_entries \
    "${BRAI_DEPLOY_SSH_DIR}" authorized_keys
  brai_deploy_assert_exact_path \
    "${BRAI_DEPLOY_EXPECTED_KEY}" file 0:0 600
  brai_deploy_assert_exact_path \
    "${BRAI_DEPLOY_AUTHORIZED_KEYS}" file 0:0 600
  brai_deploy_assert_exact_path \
    "${BRAI_DEPLOY_SUDOERS}" file 0:0 440
  brai_deploy_assert_exact_path \
    "${BRAI_DEPLOY_RECEIVER}" file 0:0 755

  canonical_key=$(brai_deploy_read_canonical_key \
    "${BRAI_DEPLOY_EXPECTED_KEY}")
  expected_authorized_key=$(brai_deploy_expected_authorized_key \
    "${canonical_key}")
  expected_sudoers=$(brai_deploy_expected_sudoers)
  actual_authorized_key=$(<"${BRAI_DEPLOY_AUTHORIZED_KEYS}")
  actual_sudoers=$(<"${BRAI_DEPLOY_SUDOERS}")
  if [[ ${actual_authorized_key} != "${expected_authorized_key}" ]]; then
    brai_deploy_fail \
      "Deployment account must have exactly the expected forced authorized key"
  fi
  if [[ ${actual_sudoers} != "${expected_sudoers}" ]]; then
    brai_deploy_fail "Deployment sudoers file differs from the exact receiver rule"
  fi
  visudo -cf "${BRAI_DEPLOY_SUDOERS}" >/dev/null
  brai_deploy_assert_effective_sudo
}

brai_deploy_detect_state() {
  local present=0
  local path
  for path in \
    "${BRAI_DEPLOY_AUTHORIZED_KEYS}" \
    "${BRAI_DEPLOY_EXPECTED_KEY}" \
    "${BRAI_DEPLOY_SUDOERS}"
  do
    if [[ -e ${path} || -L ${path} ]]; then
      ((present += 1))
    fi
  done
  case ${present} in
    0)
      printf 'inactive'
      ;;
    3)
      printf 'active'
      ;;
    *)
      brai_deploy_fail \
        "Deployment identity has partial authorization state and is disabled"
      ;;
  esac
}
