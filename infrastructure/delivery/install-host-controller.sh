#!/usr/bin/env bash

set -euo pipefail

source_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly source_root
readonly install_root=/srv/opt/brai-delivery
readonly config_root=/etc/brai-delivery
readonly expected_repository=HexaFox-Labs/Brai-One

if [[ ${EUID} -ne 0 ]]; then
  echo "Run install-host-controller.sh as root" >&2
  exit 1
fi

for command in caddy docker install node systemctl; do
  command -v "${command}" >/dev/null 2>&1 || {
    echo "Missing required host command: ${command}" >&2
    exit 1
  }
done
docker compose version >/dev/null

node_path=$(readlink -f "$(command -v node)")
if [[ ${node_path} != /srv/opt/node-v22.22.3/bin/node ]]; then
  echo "Expected pinned Node runtime is unavailable: ${node_path}" >&2
  exit 1
fi

for controller_file in "${source_root}"/controller/*.mjs; do
  node --check "${controller_file}"
done

install -d -o root -g root -m 0755 \
  "${install_root}" \
  "${install_root}/controller" \
  "${install_root}/caddy" \
  "${install_root}/runtime"
install -d -o root -g root -m 0700 \
  "${install_root}/state" \
  "${install_root}/state/manifests" \
  "${install_root}/state/secrets" \
  "${install_root}/state/snapshots" \
  "${config_root}"

install -o root -g root -m 0644 \
  "${source_root}/compose.runtime.yml" \
  "${install_root}/compose.runtime.yml"
for controller_file in "${source_root}"/controller/*.mjs; do
  install -o root -g root -m 0644 "${controller_file}" "${install_root}/controller/$(basename "${controller_file}")"
done
for caddy_file in delivery.caddy delivery-dev.caddy manage-delivery-route.mjs; do
  install -o root -g root -m 0644 \
    "${source_root}/../caddy/${caddy_file}" \
    "${install_root}/caddy/${caddy_file}"
done
install -o root -g root -m 0644 \
  "${source_root}/systemd/brai-delivery.service" \
  /etc/systemd/system/brai-delivery.service
install -o root -g root -m 0644 \
  "${source_root}/systemd/brai-delivery-sweep.service" \
  /etc/systemd/system/brai-delivery-sweep.service
install -o root -g root -m 0644 \
  "${source_root}/systemd/brai-delivery-sweep.timer" \
  /etc/systemd/system/brai-delivery-sweep.timer

controller_config="${config_root}/controller.json"
if [[ ! -e ${controller_config} ]]; then
  temporary_config=$(mktemp "${config_root}/.controller.XXXXXX")
  trap 'rm -f "${temporary_config}"' EXIT
  printf '%s\n' \
    '{' \
    '  "schema_version": "brai.delivery.controller.v1",' \
    "  \"expected_repository\": \"${expected_repository}\"," \
    '  "oidc_audience": "brai-delivery",' \
    '  "active_preview_limit": 5' \
    '}' >"${temporary_config}"
  chown root:root "${temporary_config}"
  chmod 0600 "${temporary_config}"
  mv -f "${temporary_config}" "${controller_config}"
  trap - EXIT
fi
if [[ $(stat --format='%u:%g:%a' "${controller_config}") != 0:0:600 ]]; then
  echo "Controller configuration must be root-owned mode 0600" >&2
  exit 1
fi

readonly caddyfile=${BRAI_CADDYFILE:-/etc/caddy/Caddyfile}
caddy_apply_mode=--apply
if sed -n '/^# BEGIN BRAI-NEW DELIVERY$/,/^# END BRAI-NEW DELIVERY$/p' "${caddyfile}" | grep -Fq 'dev.brai.one {'; then
  caddy_apply_mode=--apply-dev
fi
caddy_check_mode=${caddy_apply_mode/--apply/--check}

BRAI_DELIVERY_CADDY_ROUTE_ROOT="${install_root}/caddy" \
  node "${install_root}/caddy/manage-delivery-route.mjs" "${caddy_check_mode}"
systemctl daemon-reload
systemctl enable brai-delivery.service brai-delivery-sweep.timer
systemctl restart brai-delivery.service
systemctl start brai-delivery-sweep.timer
systemctl --quiet is-active brai-delivery.service
BRAI_DELIVERY_CADDY_ROUTE_ROOT="${install_root}/caddy" \
  node "${install_root}/caddy/manage-delivery-route.mjs" "${caddy_apply_mode}"

# This is a host-runtime installation, so keep the required host registry in
# the same atomic operational change. The record deliberately contains no
# credentials, internal state or image digests.
deployment_registry=/home/mark/DEPLOYMENT.md
if [[ ! -f ${deployment_registry} || -L ${deployment_registry} ]]; then
  echo "Deployment registry is missing or unsafe: ${deployment_registry}" >&2
  exit 1
fi
if ! grep -Fqx '## Brai delivery controller' "${deployment_registry}"; then
  # shellcheck disable=SC2016 # Markdown backticks are literal registry text.
  printf '%s\n' \
    '' \
    '## Brai delivery controller' \
    '' \
    '- Purpose: GitHub OIDC-gated controller for immutable Brai dev and preview delivery.' \
    '- Runtime: `/srv/opt/brai-delivery`; root-private state is under `/srv/opt/brai-delivery/state`.' \
    '- Units: `brai-delivery.service`, `brai-delivery-sweep.service`, `brai-delivery-sweep.timer`.' \
    '- Public command: `sudo /srv/projects/brai-new/infrastructure/delivery/install-host-controller.sh`.' \
    '- Source of truth: `infrastructure/delivery/`, `infrastructure/caddy/`, and `docs/reference/affected-delivery.md`.' \
    >>"${deployment_registry}"
fi

echo "brai_delivery_controller=installed"
