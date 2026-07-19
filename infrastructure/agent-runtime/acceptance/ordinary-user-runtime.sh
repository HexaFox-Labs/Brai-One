#!/bin/sh
set -eu

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH LC_ALL=C

usage() {
  printf '%s\n' \
    "Usage: $0 ENVIRONMENT_A ENVIRONMENT_B" \
    "Both environments must be disposable accepted test users with active sandbox units." >&2
  exit 2
}

[ "$(id -u)" -eq 0 ] || {
  printf '%s\n' "ordinary runtime acceptance must run as root" >&2
  exit 1
}
[ "$#" -eq 2 ] || usage
environment_a=$1
environment_b=$2
[ "$environment_a" != "$environment_b" ] || usage
for environment_name in "$environment_a" "$environment_b"; do
  case $environment_name in
    brai-u-?*) ;;
    *) usage ;;
  esac
  suffix=${environment_name#brai-u-}
  case $suffix in
    *[!0-9a-z]*) usage ;;
  esac
done

for command_name in awk curl grep ip machinectl nft sed sort systemctl systemd-run timeout wc xfs_quota
do
  command -v "$command_name" >/dev/null 2>&1 || {
    printf '%s\n' "missing acceptance dependency: $command_name" >&2
    exit 1
  }
done

machine_a=$environment_a
machine_b=$environment_b
for environment_name in "$environment_a" "$environment_b"; do
  file=/etc/brai-agent-runtime/environments/$environment_name.env
  [ ! -L "$file" ] && [ -f "$file" ] ||
    { printf '%s\n' "untrusted environment file: $file" >&2; exit 1; }
  [ "$(stat -c '%u:%g:%a' "$file")" = "0:0:600" ] ||
    { printf '%s\n' "untrusted environment metadata: $file" >&2; exit 1; }
  systemctl is-active --quiet "brai-user-sandbox@$environment_name.service"
  systemctl is-active --quiet "brai-user-engine@$environment_name.service"
done
systemctl is-active --quiet brai-user-firewall.service

read_environment_value() {
  file=$1
  key=$2
  value=$(awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1) }' "$file")
  [ -n "$value" ] || {
    printf '%s\n' "missing $key in $file" >&2
    exit 1
  }
  printf '%s\n' "$value"
}

env_file_a=/etc/brai-agent-runtime/environments/$environment_a.env
env_file_b=/etc/brai-agent-runtime/environments/$environment_b.env
project_a=$(read_environment_value "$env_file_a" BRAI_XFS_PROJECT_ID)
project_b=$(read_environment_value "$env_file_b" BRAI_XFS_PROJECT_ID)
quota_bytes_a=$(read_environment_value "$env_file_a" BRAI_QUOTA_BYTES)
quota_bytes_b=$(read_environment_value "$env_file_b" BRAI_QUOTA_BYTES)
quota_inodes_a=$(read_environment_value "$env_file_a" BRAI_QUOTA_INODES)
quota_inodes_b=$(read_environment_value "$env_file_b" BRAI_QUOTA_INODES)

run_in() {
  machine=$1
  shift
  systemd-run --quiet --pipe --wait --collect --expand-environment=no \
    "--machine=$machine" --uid=brai \
    --setenv=HOME=/data/home \
    --setenv=XDG_CONFIG_HOME=/data/config \
    --setenv=XDG_CACHE_HOME=/data/cache \
    --setenv=XDG_DATA_HOME=/data/local/share \
    --setenv=XDG_RUNTIME_DIR=/run/user/1000 \
    --setenv=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
    --setenv=DOCKER_CONFIG=/data/config/docker-client \
    --setenv=DOCKER_HOST=unix:///run/user/1000/docker.sock \
    --setenv=TMPDIR=/data/tmp \
    --setenv=SQLITE_TMPDIR=/data/tmp \
    --setenv=PATH=/opt/brai/docker/bin:/opt/brai/node/bin:/opt/brai/codex/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    "$@"
}

run_root_in() {
  machine=$1
  shift
  systemd-run --quiet --pipe --wait --collect --expand-environment=no \
    "--machine=$machine" --uid=root "$@"
}

phase() {
  printf '%s\n' "ordinary runtime acceptance: $1" >&2
}

wait_for_machine_running() {
  machine=$1
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    state=$(machinectl show "$machine" --property=State --value \
      2>/dev/null || true)
    [ "$state" = "running" ] && return 0
    attempts=$((attempts + 1))
    sleep 1
  done
  printf '%s\n' "sandbox machine did not become running: $machine" >&2
  return 1
}

wait_for_network_ready() {
  machine=$1
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    if run_root_in "$machine" /bin/sh -ceu \
      'ip -4 route show default | grep -q . && getent ahostsv4 registry-1.docker.io >/dev/null'
    then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  run_root_in "$machine" /bin/sh -ceu \
    'ip -4 address; ip -4 route; resolvectl status' >&2 || true
  printf '%s\n' "sandbox network did not become ready: $machine" >&2
  return 1
}

wait_for_rootless_docker_ready() {
  machine=$1
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    if run_in "$machine" /opt/brai/docker/bin/docker info \
      --format '{{.DockerRootDir}}|{{.Driver}}|{{json .SecurityOptions}}' \
      2>/dev/null
    then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  systemctl status "brai-user-engine@$machine.service" --no-pager >&2 ||
    true
  printf '%s\n' "rootless Docker did not become ready: $machine" >&2
  return 1
}

wait_for_machine_running "$machine_a"
wait_for_machine_running "$machine_b"

token=$(tr -d '-' </proc/sys/kernel/random/uuid)
work=.brai-acceptance-$token
short_token=${token%????????????????}
process_unit=brai-accept-process-${token%????????????????????????}
http_unit=brai-accept-http-${token%????????????????????????}
postgres_container=brai-accept-pg-$short_token
postgres_volume=brai-accept-pgdata-$short_token
postgres_image=postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94
cleanup() {
  status=$?
  if [ "${quota_reduced_a:-0}" -eq 1 ]; then
    xfs_quota -x -D /dev/null -P /dev/null \
      -c "limit -p bsoft=0 bhard=$quota_bytes_a isoft=0 ihard=$quota_inodes_a $project_a" \
      /srv/brai-user-data >/dev/null 2>&1 || status=1
  fi
  run_in "$machine_a" systemctl --user stop "$process_unit.service" \
    >/dev/null 2>&1 || true
  run_in "$machine_a" systemctl --user stop "$http_unit.service" \
    >/dev/null 2>&1 || true
  run_in "$machine_a" /bin/sh -ceu '
    /opt/brai/docker/bin/docker rm -f "$3" >/dev/null 2>&1 || true
    /opt/brai/docker/bin/docker volume rm -f "$4" >/dev/null 2>&1 || true
    /opt/brai/docker/bin/docker image rm -f "$5" >/dev/null 2>&1 || true
    /opt/brai/docker/bin/docker image rm -f "brai-accept-$2" >/dev/null 2>&1 ||
      true
    case $1 in .brai-acceptance-*) rm -rf -- "/data/$1" ;; *) exit 1 ;; esac
  ' -- "$work" "$token" "$postgres_container" "$postgres_volume" \
    "$postgres_image" >/dev/null 2>&1 || true
  run_in "$machine_b" /bin/sh -ceu '
    case $1 in .brai-acceptance-*) rm -rf -- "/data/$1" ;; *) exit 1 ;; esac
  ' -- "$work" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

phase "measured IPv4 route and DNS readiness"
wait_for_network_ready "$machine_a"
wait_for_network_ready "$machine_b"

phase "protected host paths and credentials"
for machine in "$machine_a" "$machine_b"; do
  run_in "$machine" /bin/sh -ceu '
    for forbidden in \
      /srv/projects/brai-new \
      /etc/brai-new \
      /var/run/docker.sock \
      /run/docker.sock \
      /etc/brai-agent-runtime/credentials \
      /etc/brai-agent-runtime/environments \
      /home/mark \
      /root/.server-secrets \
      /etc/caddy
    do
      [ ! -e "$forbidden" ] || {
        printf "%s\n" "forbidden host/source/credential path is visible: $forbidden" >&2
        exit 1
      }
    done
    ! /usr/bin/env | grep -Eiq \
      "^(DATABASE_URL|SUPABASE_|NATS_|BRAI_.*(SECRET|TOKEN|PASSWORD|PRIVATE_KEY))="
  '
done

phase "cross-user filesystem and process isolation"
run_in "$machine_a" /bin/sh -ceu '
  umask 077
  mkdir -p "/data/$1"
  printf "%s\n" "$2" >"/data/$1/secret"
' -- "$work" "$token"
run_in "$machine_b" /bin/sh -ceu '
  mkdir -p "/data/$1"
  [ ! -e "/data/$1/secret" ]
  [ ! -e "/srv/brai-user-data/$2" ]
' -- "$work" "$environment_a"

run_in "$machine_a" systemd-run --user --expand-environment=no \
  "--unit=$process_unit" --collect \
  /bin/bash -ceu 'exec -a "$1" sleep 120' -- "brai-accept-$token" >/dev/null
run_in "$machine_b" /bin/sh -ceu '
  for command_line in /proc/[0-9]*/cmdline; do
    process_id=${command_line#/proc/}
    process_id=${process_id%/cmdline}
    [ "$process_id" = "$$" ] && continue
    observed=$(tr "\000" " " <"$command_line" 2>/dev/null || true)
    case $observed in
      *"$1"*)
        printf "%s\n" \
          "cross-user process marker is visible in PID namespace" >&2
        exit 1
        ;;
    esac
  done
' -- "brai-accept-$token"

phase "eight parallel jobs in one persistent environment"
parallel_status=0
parallel_jobs=
for index in 1 2 3 4 5 6 7 8; do
  run_in "$machine_a" /bin/sh -ceu '
    flock "/data/$1/parallel.lock" \
      sh -c "printf \"%s\\n\" \"\$1\" >>\"\$2\"" \
      sh "$2" "/data/$1/parallel.txt"
  ' -- "$work" "$index" &
  parallel_jobs="$parallel_jobs $!"
done
for job in $parallel_jobs; do
  wait "$job" || parallel_status=1
done
[ "$parallel_status" -eq 0 ]
parallel_result=$(run_in "$machine_a" /bin/sh -ceu \
  'sort -u "/data/$1/parallel.txt" | wc -l' -- "$work" |
  tr -d '[:space:]')
[ "$parallel_result" = "8" ]

phase "slot-bound rootless Docker and image build"
run_in "$machine_a" /bin/sh -ceu \
  '[ ! -e /usr/lib/systemd/user/brai-rootless-docker.service ]'
docker_info=$(wait_for_rootless_docker_ready "$machine_a")
printf '%s\n' "$docker_info" | grep -Fq '/data/docker|fuse-overlayfs|'
printf '%s\n' "$docker_info" | grep -Fq 'rootless'
engine_pid=$(systemctl show "brai-user-engine@$environment_a.service" \
  --property=MainPID --value)
engine_uid=$(read_environment_value "$env_file_a" BRAI_USERNS_START)
engine_uid=$((engine_uid + 1000))
[ "$(stat -c '%u' "/proc/$engine_pid")" = "$engine_uid" ]
socket_metadata=$(stat -c '%u:%g:%a' \
  "/run/brai-user-engines/$environment_a/docker.sock")
case "$socket_metadata" in
  "$engine_uid:$engine_uid:660"|"$engine_uid:$engine_uid:1660") ;;
  *) printf '%s\n' "rootless Docker socket metadata differs" >&2; exit 1 ;;
esac
run_in "$machine_a" /bin/sh -ceu '
  mkdir -p "/data/$1/docker-context"
  printf "%s\n" "nested-build-$2" >"/data/$1/docker-context/payload"
  printf "%s\n" "FROM scratch" "COPY payload /payload" \
    >"/data/$1/docker-context/Dockerfile"
  /opt/brai/docker/bin/docker build \
    --tag "brai-accept-$2" "/data/$1/docker-context" >/dev/null
  /opt/brai/docker/bin/docker image inspect "brai-accept-$2" >/dev/null
' -- "$work" "$token"

phase "SQLite backup and restore"
sqlite_count=$(run_in "$machine_a" /bin/sh -ceu '
  database="/data/$1/project.sqlite"
  backup="/data/$1/backups/project.sqlite"
  restored="/data/$1/restored.sqlite"
  mkdir -p "/data/$1/backups"
  sqlite3 "$database" "PRAGMA journal_mode=WAL;" >/dev/null
  sqlite3 "$database" \
    "CREATE TABLE values_table(value INTEGER); INSERT INTO values_table VALUES (42);"
  sqlite3 "$database" ".backup $backup"
  sqlite3 "$restored" ".restore $backup"
  sqlite3 "$restored" "SELECT count(*) FROM values_table WHERE value = 42;"
' -- "$work" | tr -d '[:space:]')
[ "$sqlite_count" = "1" ]

phase "user-contained PostgreSQL container backup and restore"
postgres_count=$(run_in "$machine_a" /bin/sh -ceu '
  dump="/data/$1/backups/project.sql"
  mkdir -p "/data/$1/backups"
  docker=/opt/brai/docker/bin/docker
  pulled=0
  for attempt in 1 2 3; do
    if "$docker" pull "$4" >/dev/null; then
      pulled=1
      break
    fi
    sleep $((attempt * 2))
  done
  [ "$pulled" -eq 1 ]
  "$docker" run --rm --network none --entrypoint /bin/grep "$4" \
    -qx "ID=alpine" /etc/os-release
  if "$docker" run --rm --network none --entrypoint /bin/true \
    --mount "type=bind,source=/srv/projects/brai-new,target=/host-project,readonly" \
    "$4" >/dev/null 2>&1
  then
    printf "%s\n" "rootless engine resolved a forbidden host project bind" >&2
    exit 1
  fi
  for endpoint in 157.254.223.221:443 172.17.0.1:2375; do
    host=${endpoint%:*}
    port=${endpoint#*:}
    if "$docker" run --rm --entrypoint /bin/busybox "$4" \
      nc -z -w 2 "$host" "$port" >/dev/null 2>&1
    then
      printf "%s\n" \
        "rootless container reached protected host endpoint $endpoint" >&2
      exit 1
    fi
  done
  "$docker" run --rm --entrypoint /usr/bin/wget "$4" \
    -q -O /dev/null https://example.com/
  "$docker" volume create "$3" >/dev/null
  "$docker" run --detach --name "$2" --network none \
    --env POSTGRES_PASSWORD=brai-acceptance-only \
    --mount "type=volume,source=$3,target=/var/lib/postgresql/data" \
    "$4" >/dev/null
  ready=0
  for attempt in $(seq 1 60); do
    if "$docker" exec "$2" pg_isready -U postgres >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
  [ "$ready" -eq 1 ]
  "$docker" exec "$2" psql -U postgres -v ON_ERROR_STOP=1 \
    -c "CREATE TABLE values_table(value text); INSERT INTO values_table VALUES (repeat(chr(120), 11));" \
    >/dev/null
  "$docker" exec "$2" pg_dump -U postgres postgres >"$dump"
  "$docker" exec "$2" createdb -U postgres restored
  "$docker" exec -i "$2" psql -U postgres -d restored \
    -v ON_ERROR_STOP=1 <"$dump" >/dev/null
  "$docker" exec "$2" psql -U postgres -d restored -At \
    -c "SELECT count(*) FROM values_table WHERE value = repeat(chr(120), 11);"
' -- "$work" "$postgres_container" "$postgres_volume" "$postgres_image" |
  tr -d '[:space:]')
[ "$postgres_count" = "1" ]

phase "XFS project quota exhaustion and recovery"
/srv/opt/brai-agent-runtime/bin/measure-project-quota \
  "$environment_a" "$project_a" "$quota_bytes_a" "$quota_inodes_a" >/dev/null
/srv/opt/brai-agent-runtime/bin/measure-project-quota \
  "$environment_b" "$project_b" "$quota_bytes_b" "$quota_inodes_b" >/dev/null

used_kib_a=$(xfs_quota -x -D /dev/null -P /dev/null \
  -c "report -p -b -n -N -L $project_a -U $project_a" \
  /srv/brai-user-data |
  awk -v id="$project_a" '$1 == id || $1 == ("#" id) { print $2; exit }')
case $used_kib_a in
  ''|*[!0-9]*) printf '%s\n' "cannot measure current quota usage" >&2; exit 1 ;;
esac
quota_test_limit_a=$(( (used_kib_a + 8192) * 1024 ))
[ "$quota_test_limit_a" -lt "$quota_bytes_a" ] || {
  printf '%s\n' "disposable test environment has less than 8 MiB quota headroom" >&2
  exit 1
}
xfs_quota -x -D /dev/null -P /dev/null \
  -c "limit -p bsoft=0 bhard=$quota_test_limit_a isoft=0 ihard=$quota_inodes_a $project_a" \
  /srv/brai-user-data
quota_reduced_a=1
if run_in "$machine_a" /bin/sh -ceu '
  dd if=/dev/zero of="/data/$1/quota-exhaustion.bin" \
    bs=1048576 count=16 conv=fsync status=none
' -- "$work"; then
  printf '%s\n' "bounded 8 MiB hard quota did not reject a 16 MiB write" >&2
  exit 1
fi
run_in "$machine_a" /bin/sh -ceu '
  rm -f -- "/data/$1/quota-exhaustion.bin"
  sync
  dd if=/dev/zero of="/data/$1/after-delete.bin" \
    bs=1048576 count=1 conv=fsync status=none
  rm -f -- "/data/$1/after-delete.bin"
' -- "$work"
xfs_quota -x -D /dev/null -P /dev/null \
  -c "limit -p bsoft=0 bhard=$quota_bytes_a isoft=0 ihard=$quota_inodes_a $project_a" \
  /srv/brai-user-data
quota_reduced_a=0
/srv/opt/brai-agent-runtime/bin/measure-project-quota \
  "$environment_a" "$project_a" "$quota_bytes_a" "$quota_inodes_a" >/dev/null

phase "cross-user and host network denial with public egress"
interface_a=ve-$environment_a
interface_b=ve-$environment_b
[ "${#interface_a}" -le 15 ] && [ "${#interface_b}" -le 15 ]
ip link show dev "$interface_a" >/dev/null
ip link show dev "$interface_b" >/dev/null
nft list table inet brai_user_sandboxes |
  grep -Fq 'iifname "ve-brai-u-*"'
drop_packets() {
  nft list table inet brai_user_sandboxes |
    awk '
      /counter packets [0-9]+ bytes [0-9]+ drop/ {
        for (position = 1; position <= NF; position++)
          if ($position == "packets") packets += $(position + 1)
      }
      END { print packets + 0 }
    '
}
drop_before=$(drop_packets)

ip_a=$(run_root_in "$machine_a" \
  /bin/sh -ceu "ip -4 -o address show dev host0 scope global | awk 'NR == 1 { split(\$4, value, \"/\"); print value[1] }'" |
  tr -d '[:space:]')
gateway_b=$(run_in "$machine_b" /bin/sh -ceu \
  "ip -4 route show default | awk 'NR == 1 { print \$3 }'" |
  tr -d '[:space:]')
case $ip_a:$gateway_b in
  :*|*:) printf '%s\n' "cannot measure sandbox network" >&2; exit 1 ;;
  *[!0-9.:]*) printf '%s\n' "cannot measure sandbox network" >&2; exit 1 ;;
esac

run_in "$machine_a" systemd-run --user --expand-environment=no \
  "--unit=$http_unit" --collect \
  /usr/bin/python3 -m http.server 18080 --bind 0.0.0.0 \
  --directory "/data/$work" >/dev/null
sleep 1
if run_in "$machine_b" curl --fail --silent --show-error \
  --connect-timeout 2 "http://$ip_a:18080/" >/dev/null 2>&1; then
  printf '%s\n' "cross-user network request unexpectedly succeeded" >&2
  exit 1
fi
run_in "$machine_b" curl --fail --silent --show-error \
  --connect-timeout 10 --max-time 20 https://example.com/ >/dev/null

for host in "$gateway_b" 157.254.223.221; do
  for port in 80 443 2375 2376 4222 54321; do
    if run_in "$machine_b" timeout 2 /bin/bash -ceu \
      'exec 3<>"/dev/tcp/$1/$2"' -- "$host" "$port" \
      >/dev/null 2>&1
    then
      printf '%s\n' \
        "sandbox unexpectedly reached protected host endpoint $host:$port" >&2
      exit 1
    fi
  done
done

drop_after=$(drop_packets)
[ "$drop_after" -gt "$drop_before" ] || {
  printf '%s\n' "nft drop counters did not observe the denied probes" >&2
  exit 1
}

printf '%s\n' \
  "ordinary runtime acceptance passed: two-user FS/PID/network isolation, protected-source/credential/socket denial, measured short veth+nft drops, parallel agents, bounded EDQUOT recovery, slot-bound rootless build with host-bind rejection, SQLite and user Postgres backup/restore"
