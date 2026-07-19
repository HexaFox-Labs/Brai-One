#!/bin/sh
set -eu

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH LC_ALL=C

CANONICAL_OUTPUT=/srv/opt/brai-agent-runtime/images/user-sandbox-v1.raw
UBUNTU_SNAPSHOT=20260701T000000Z
SOURCE_DATE_EPOCH=1782864000
NODE_VERSION=22.22.3
NODE_SHA256=2e5d13569282d016861fae7c8f935e741693c269101a5bebcf761a5376d1f99f
CODEX_VERSION=0.144.5
CODEX_PACKAGE_SHA256=8ef17f44770a72f42f09512dfb748c08729dabc0a6ccd6c68220b0b4449f40c3
CODEX_PLATFORM_SHA256=7fa2e1763a7e6cf47e013b57e95997440c36ec0c95255a4328616b30005c4876
DOCKER_VERSION=29.1.3
DOCKER_SHA256=c019c608ba2bb009dd673f3230e4d743f36a78d36166c6c2444c05d0aa9ff0d9
DOCKER_ROOTLESS_SHA256=32dc3dd0d8b512ccf30a7efe84d360b5ade65ac4fec92a2a5ad0fe791da6ab0d
BUILDX_VERSION=0.30.1
BUILDX_SHA256=c37114fcd034025ec68e224657c8a5a850df472ded3ddcbca75ad3a7ebb9710d

usage() {
  printf '%s\n' \
    "Usage: $0 [--output $CANONICAL_OUTPUT] [--replace]" >&2
  exit 2
}

[ "$(id -u)" -eq 0 ] || {
  printf '%s\n' "image build must run as root" >&2
  exit 1
}

output=$CANONICAL_OUTPUT
replace=0
while [ "$#" -gt 0 ]; do
  case $1 in
    --output)
      [ "$#" -ge 2 ] || usage
      output=$2
      shift 2
      ;;
    --replace)
      replace=1
      shift
      ;;
    *)
      usage
      ;;
  esac
done
case $output in
  /*/user-sandbox-v1.raw) ;;
  *) usage ;;
esac

for command_name in curl find grep install mmdebstrap mksquashfs readlink \
  cc sha256sum sort systemctl tar touch xz
do
  command -v "$command_name" >/dev/null 2>&1 || {
    printf '%s\n' "missing build dependency: $command_name" >&2
    exit 1
  }
done

assert_canonical_rollout_quiescent() {
  if [ "$replace" -ne 1 ] ||
    [ "$output" != "$CANONICAL_OUTPUT" ] ||
    [ ! -e "$output" ]
  then
    return
  fi
  ! systemctl is-active --quiet brai-agent-runtime-host.service || {
    printf '%s\n' \
      "stop brai-agent-runtime-host.service before replacing the shared image" >&2
    exit 1
  }
  if systemctl list-units --type=service --state=active --no-legend \
    'brai-user-sandbox@*.service' | grep -q .
  then
    printf '%s\n' \
      "stop every brai-user-sandbox@ unit before replacing the shared image" >&2
    exit 1
  fi
  if systemctl list-units --type=service --state=active --no-legend \
    'brai-user-engine@*.service' | grep -q .
  then
    printf '%s\n' \
      "stop every brai-user-engine@ unit before replacing the shared image" >&2
    exit 1
  fi
}

assert_canonical_rollout_quiescent

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
RUNTIME_DIR=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd -P)
work=$(mktemp -d /var/tmp/brai-user-image.XXXXXX)
root=$work/root
downloads=$work/downloads
built=$work/user-sandbox-v1.raw

cleanup() {
  status=$?
  case $work in
    /var/tmp/brai-user-image.*) rm -rf -- "$work" ;;
    *) status=1 ;;
  esac
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

install -d -m 0700 "$root" "$downloads"

download_verified() {
  url=$1
  expected=$2
  destination=$3
  curl --fail --location --proto '=https' --tlsv1.2 \
    --output "$destination" "$url"
  actual=$(sha256sum "$destination" | awk '{ print $1 }')
  [ "$actual" = "$expected" ] || {
    printf '%s\n' "digest mismatch for $url" >&2
    exit 1
  }
}

download_verified \
  "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" \
  "$NODE_SHA256" "$downloads/node.tar.xz"
download_verified \
  "https://registry.npmjs.org/@openai/codex/-/codex-$CODEX_VERSION.tgz" \
  "$CODEX_PACKAGE_SHA256" "$downloads/codex.tgz"
download_verified \
  "https://registry.npmjs.org/@openai/codex/-/codex-$CODEX_VERSION-linux-x64.tgz" \
  "$CODEX_PLATFORM_SHA256" "$downloads/codex-platform.tgz"
download_verified \
  "https://download.docker.com/linux/static/stable/x86_64/docker-$DOCKER_VERSION.tgz" \
  "$DOCKER_SHA256" "$downloads/docker.tgz"
download_verified \
  "https://download.docker.com/linux/static/stable/x86_64/docker-rootless-extras-$DOCKER_VERSION.tgz" \
  "$DOCKER_ROOTLESS_SHA256" "$downloads/docker-rootless.tgz"
download_verified \
  "https://github.com/docker/buildx/releases/download/v$BUILDX_VERSION/buildx-v$BUILDX_VERSION.linux-amd64" \
  "$BUILDX_SHA256" "$downloads/docker-buildx"

snapshot=https://snapshot.ubuntu.com/ubuntu/$UBUNTU_SNAPSHOT
mmdebstrap \
  --architectures=amd64 \
  --variant=minbase \
  --components='main universe' \
  --include='systemd,systemd-sysv,systemd-resolved,dbus-user-session,ca-certificates,curl,uidmap,slirp4netns,fuse-overlayfs,sqlite3,postgresql-16,postgresql-client-16,git,openssh-client,bash,zsh,iproute2,iputils-ping,dnsutils,iptables,nftables,procps,psmisc,util-linux,build-essential,pkg-config,python3,python3-pip,python3-venv,locales,tzdata' \
  noble "$root" \
  "deb [check-valid-until=no] $snapshot noble main universe" \
  "deb [check-valid-until=no] $snapshot noble-updates main universe" \
  "deb [check-valid-until=no] $snapshot noble-security main universe"

chroot "$root" /usr/sbin/groupadd --gid 1000 brai
chroot "$root" /usr/sbin/useradd \
  --uid 1000 --gid 1000 --home-dir /data/home \
  --shell /bin/bash --no-create-home brai
chroot "$root" /usr/sbin/usermod --lock brai
printf '%s\n' 'brai:65536:65536' >"$root/etc/subuid"
printf '%s\n' 'brai:65536:65536' >"$root/etc/subgid"
chmod 0644 "$root/etc/subuid" "$root/etc/subgid"
chown 0:0 "$root/etc/subuid" "$root/etc/subgid"
chmod 4755 "$root/usr/bin/newuidmap" "$root/usr/bin/newgidmap"

node_root=$root/opt/brai/node-$NODE_VERSION
install -d -m 0755 "$node_root"
tar -xJf "$downloads/node.tar.xz" \
  --strip-components=1 --no-same-owner -C "$node_root"
ln -s "node-$NODE_VERSION" "$root/opt/brai/node"

codex_root=$root/opt/brai/codex-$CODEX_VERSION
install -d -m 0755 \
  "$codex_root/bin" \
  "$codex_root/node_modules/@openai/codex" \
  "$codex_root/node_modules/@openai/codex-linux-x64"
tar -xzf "$downloads/codex.tgz" --strip-components=1 --no-same-owner \
  -C "$codex_root/node_modules/@openai/codex"
tar -xzf "$downloads/codex-platform.tgz" \
  --strip-components=1 --no-same-owner \
  -C "$codex_root/node_modules/@openai/codex-linux-x64"
ln -s ../node_modules/@openai/codex/bin/codex.js "$codex_root/bin/codex"
ln -s "codex-$CODEX_VERSION" "$root/opt/brai/codex"

docker_root=$root/opt/brai/docker-$DOCKER_VERSION
install -d -m 0755 "$docker_root/bin" "$docker_root/libexec/docker/cli-plugins"
tar -xzf "$downloads/docker.tgz" --strip-components=1 --no-same-owner \
  -C "$docker_root/bin"
tar -xzf "$downloads/docker-rootless.tgz" \
  --strip-components=1 --no-same-owner -C "$docker_root/bin"
install -o 0 -g 0 -m 0755 \
  "$docker_root/bin/rootlesskit" \
  "$root/usr/bin/rootlesskit"
rm -f -- "$docker_root/bin/rootlesskit"
install -o 0 -g 0 -m 0755 "$downloads/docker-buildx" \
  "$docker_root/libexec/docker/cli-plugins/docker-buildx"
install -d -o 0 -g 0 -m 0755 "$root/usr/libexec/docker/cli-plugins"
ln -s /opt/brai/docker/libexec/docker/cli-plugins/docker-buildx \
  "$root/usr/libexec/docker/cli-plugins/docker-buildx"
ln -s "docker-$DOCKER_VERSION" "$root/opt/brai/docker"

install -d -m 0755 \
  "$root/etc/brai-agent-runtime" \
  "$root/etc/systemd/journald.conf.d" \
  "$root/etc/systemd/network" \
  "$root/etc/systemd/system/brai-prepare-data.service.d" \
  "$root/etc/systemd/system/user@1000.service.d" \
  "$root/etc/systemd/system/multi-user.target.wants" \
  "$root/usr/lib/systemd/system" \
  "$root/usr/libexec/brai" \
  "$root/usr/local/bin" \
  "$root/var/lib/systemd/linger"
install -o 0 -g 0 -m 0644 \
  "$RUNTIME_DIR/config/rootless-docker-daemon.json" \
  "$root/etc/brai-agent-runtime/docker-daemon.json"
install -o 0 -g 0 -m 0644 \
  "$SCRIPT_DIR/assets/brai-prepare-data.service" \
  "$root/usr/lib/systemd/system/brai-prepare-data.service"
install -o 0 -g 0 -m 0644 \
  "$SCRIPT_DIR/assets/user-manager.conf" \
  "$root/etc/systemd/system/user@1000.service.d/10-brai.conf"
install -o 0 -g 0 -m 0644 \
  "$SCRIPT_DIR/assets/journald-volatile.conf" \
  "$root/etc/systemd/journald.conf.d/10-brai-volatile.conf"
install -o 0 -g 0 -m 0644 \
  "$SCRIPT_DIR/assets/host0.network" \
  "$root/etc/systemd/network/20-brai-host0.network"
install -o 0 -g 0 -m 0755 \
  "$SCRIPT_DIR/assets/prepare-data.sh" \
  "$root/usr/libexec/brai/prepare-data"
install -o 0 -g 0 -m 0755 \
  "$SCRIPT_DIR/assets/probe-guest-runtime.sh" \
  "$root/usr/libexec/brai/probe-guest-runtime"
install -o 0 -g 0 -m 0755 \
  "$SCRIPT_DIR/assets/brai-codex-exec.sh" \
  "$root/usr/local/bin/brai-codex-exec"
install -o 0 -g 0 -m 0644 \
  "$RUNTIME_DIR/native/brai-exec-gate.c" \
  "$root/brai-exec-gate.c"
chroot "$root" /usr/bin/cc \
  -std=c17 -O2 -fPIE -pie -fstack-protector-strong \
  -D_FORTIFY_SOURCE=3 \
  '-DGATE_PREFIX="/run/brai-agent-gates/"' \
  -DBRAI_GATE_DROP_UID=1000 \
  -Wformat -Wformat-security -Werror=format-security \
  -Wall -Wextra -Wpedantic -Wl,-z,relro,-z,now \
  -o /usr/libexec/brai/brai-exec-gate \
  /brai-exec-gate.c
rm -f -- "$root/brai-exec-gate.c"
chown 0:0 "$root/usr/libexec/brai/brai-exec-gate"
chmod 0755 "$root/usr/libexec/brai/brai-exec-gate"

ln -s /usr/lib/systemd/system/brai-prepare-data.service \
  "$root/etc/systemd/system/multi-user.target.wants/brai-prepare-data.service"
ln -s /usr/lib/systemd/system/user@.service \
  "$root/etc/systemd/system/multi-user.target.wants/user@1000.service"
systemctl --root="$root" enable \
  systemd-networkd.service systemd-resolved.service >/dev/null
ln -sfn /dev/null "$root/etc/systemd/system/docker.service"
ln -sfn /dev/null "$root/etc/systemd/system/docker.socket"
ln -sfn /dev/null "$root/etc/systemd/system/containerd.service"
ln -sfn /dev/null "$root/etc/systemd/system/postgresql.service"
touch "$root/var/lib/systemd/linger/brai"

# nspawn mounts a volatile /tmp before PID 1 can run brai-prepare-data. Keep
# trusted placeholders in the read-only image; the real /data bind shadows
# them and the host provisioner creates the same paths inside the quota tree.
install -d -o 1000 -g 1000 -m 0700 \
  "$root/data/tmp" \
  "$root/data/var-tmp"
rm -rf -- "$root/tmp" "$root/var/tmp"
ln -s /data/tmp "$root/tmp"
ln -s /data/var-tmp "$root/var/tmp"
printf '%s\n' 'brai-user-sandbox-v1' >"$root/etc/hostname"
: >"$root/etc/machine-id"
rm -f -- "$root/var/lib/dbus/machine-id"
ln -s /etc/machine-id "$root/var/lib/dbus/machine-id"
rm -f -- "$root/etc/resolv.conf"
ln -s ../run/systemd/resolve/stub-resolv.conf "$root/etc/resolv.conf"
printf '%s\n' 'LANG=C.UTF-8' >"$root/etc/default/locale"

install -d -m 0755 "$root/usr/lib/brai"
cat >"$root/usr/lib/brai/image-manifest.json" <<EOF
{
  "schema": "brai-user-sandbox-image/v1",
  "ubuntu": "24.04",
  "ubuntuSnapshot": "$UBUNTU_SNAPSHOT",
  "sourceDateEpoch": $SOURCE_DATE_EPOCH,
  "node": {"path": "/opt/brai/node/bin/node", "version": "v$NODE_VERSION", "sha256": "$NODE_SHA256"},
  "codex": {"path": "/opt/brai/codex/bin/codex", "version": "codex-cli $CODEX_VERSION", "packageSha256": "$CODEX_PACKAGE_SHA256", "platformSha256": "$CODEX_PLATFORM_SHA256"},
  "docker": {"path": "/opt/brai/docker/bin/docker", "version": "$DOCKER_VERSION", "sha256": "$DOCKER_SHA256", "rootlessSha256": "$DOCKER_ROOTLESS_SHA256"},
  "buildx": {"version": "$BUILDX_VERSION", "sha256": "$BUILDX_SHA256"},
  "persistenceRoot": "/data"
}
EOF
rm -rf -- \
  "$root/var/cache/apt"/* \
  "$root/var/lib/apt/lists"/* \
  "$root/var/log"/* \
  "$root/var/lib/postgresql/16/main" \
  "$root/var/lib/systemd/random-seed" \
  "$root/var/cache/ldconfig/aux-cache" \
  "$root/etc/postgresql/16/main" \
  "$root/etc/ssl/private/ssl-cert-snakeoil.key" \
  "$root/etc/ssl/certs/ssl-cert-snakeoil.pem" 2>/dev/null || true
find "$root" -xdev -print0 |
  sort -z |
  xargs -0 touch -h --date="@$SOURCE_DATE_EPOCH"

mksquashfs "$root" "$built" \
  -noappend -no-progress -comp xz -b 1048576 -Xdict-size 100% \
  -processors 1 -mkfs-time "$SOURCE_DATE_EPOCH" \
  -all-time "$SOURCE_DATE_EPOCH" >/dev/null

actual_digest=$(sha256sum "$built" | awk '{ print $1 }')
case $actual_digest in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
  *) printf '%s\n' "invalid generated image digest" >&2; exit 1 ;;
esac

assert_canonical_rollout_quiescent
output_parent=$(dirname -- "$output")
install -d -o 0 -g 0 -m 0755 "$output_parent"
if [ -e "$output" ]; then
  existing=$(sha256sum "$output" | awk '{ print $1 }')
  if [ "$existing" = "$actual_digest" ]; then
    printf '%s\n' "$actual_digest" >"$output.sha256"
    chown 0:0 "$output" "$output.sha256"
    chmod 0444 "$output" "$output.sha256"
    printf '%s\n' "shared image already installed with the exact digest"
    exit 0
  fi
  [ "$replace" -eq 1 ] || {
    printf '%s\n' \
      "refusing to replace a different immutable v1 image without --replace" >&2
    exit 1
  }
fi

temporary=$output.new.$$
temporary_sidecar=$output.sha256.new.$$
install -o 0 -g 0 -m 0444 "$built" "$temporary"
printf '%s\n' "$actual_digest" >"$temporary_sidecar"
chown 0:0 "$temporary_sidecar"
chmod 0444 "$temporary_sidecar"
mv -f -- "$temporary" "$output"
mv -f -- "$temporary_sidecar" "$output.sha256"
sync -f "$output"
sync -f "$output_parent"
printf '%s\n' "installed one shared immutable image: $output"
printf '%s\n' "sha256: $actual_digest"
