#!/usr/bin/env bash
set -euo pipefail

project_root=/srv/projects/brai-new
unit_source="$project_root/infrastructure/adr/systemd"
unit_target=/etc/systemd/system
target_root=/srv/projects/brai-envs/prod/adr-brai-new

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

for path in "$project_root/docs/decisions" "$target_root" "$unit_source"; do
  if [[ ! -d "$path" || -L "$path" ]]; then
    echo "Expected real directory: $path" >&2
    exit 1
  fi
done

if ! id mark >/dev/null 2>&1; then
  echo "Required publisher user mark is missing." >&2
  exit 1
fi

for unit in brai-adr-autopublish.service brai-adr-autopublish.path brai-adr-autopublish.timer; do
  install -o root -g root -m 0644 "$unit_source/$unit" "$unit_target/$unit"
done

systemctl daemon-reload
systemctl enable --now brai-adr-autopublish.path brai-adr-autopublish.timer
systemctl start brai-adr-autopublish.service
# A successful Type=oneshot service becomes inactive after it exits; show its
# final journal status without turning the installer itself into a failure.
systemctl --no-pager --full status brai-adr-autopublish.service || true
