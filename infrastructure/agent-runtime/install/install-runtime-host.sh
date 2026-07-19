#!/bin/sh
set -eu

die() {
  printf '%s\n' "install-runtime-host: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "must run as root"

SOURCE_ROOT=${1:-}
[ -n "$SOURCE_ROOT" ] ||
  die "usage: install-runtime-host.sh /srv/projects/brai-new/infrastructure/agent-runtime"
[ -d "$SOURCE_ROOT/dist" ] || die "build dist is missing"
[ -f "$SOURCE_ROOT/native/brai-exec-gate.c" ] ||
  die "native exec gate source is missing"
[ -f "$SOURCE_ROOT/native/verified-nspawn.c" ] ||
  die "verified nspawn source is missing"
[ -f "$SOURCE_ROOT/systemd/brai-agent-runtime-host.service.example" ] ||
  die "systemd source is missing"
[ -f "$SOURCE_ROOT/systemd/brai-user-sandbox@.service.example" ] ||
  die "user sandbox systemd source is missing"
[ -f "$SOURCE_ROOT/systemd/brai-user-engine@.service.example" ] ||
  die "user engine systemd source is missing"
[ -f "$SOURCE_ROOT/config/brai-agent-runtime.modules-load.conf" ] ||
  die "kernel module source is missing"
[ -f "$SOURCE_ROOT/config/brai-user-engine-rootlesskit.apparmor" ] ||
  die "RootlessKit AppArmor source is missing"
[ -x /srv/opt/node-v22.22.3/bin/node ] ||
  die "canonical Node.js 22 runtime is missing"
[ "$(/srv/opt/node-v22.22.3/bin/node --version)" = "v22.22.3" ] ||
  die "canonical Node.js runtime version differs from v22.22.3"
if systemctl list-units --type=service --state=active --no-legend \
  'brai-user-sandbox@*.service' 'brai-user-engine@*.service' | grep -q .
then
  die "stop every user sandbox and engine before installing runtime host files"
fi

TARGET=/srv/opt/brai-agent-runtime
CONFIG=/etc/brai-agent-runtime
ENGINE_TARGET=/srv/opt/brai-user-engine

install -d -o root -g root -m 0755 "$TARGET" "$TARGET/bin" "$TARGET/dist"
install -d -o root -g root -m 0755 \
  "$ENGINE_TARGET" "$ENGINE_TARGET/bin" "$ENGINE_TARGET/lib"
install -d -o root -g root -m 0755 "$CONFIG"
install -d -o root -g root -m 0700 \
  "$CONFIG/credentials" "$CONFIG/environments"
# Remove the superseded file-based provisioner. Production provisioning is
# accepted only over the authenticated NATS contract handled by runtime-host.
rm -f "$TARGET/bin/trusted-provision-user-environment"
rm -f \
  "$TARGET/dist/trusted-provisioning-cli.js" \
  "$TARGET/dist/trusted-provisioning-cli.js.map"
# One-time removal of the rejected chroot-based engine layer. Its service is
# static and has no persistent state; per-user Docker data remains under quota.
systemctl stop brai-user-engine-rootfs.service >/dev/null 2>&1 || true
rm -f \
  /etc/systemd/system/brai-user-engine-rootfs.service \
  "$TARGET/bin/mount-user-engine-rootfs" \
  "$TARGET/bin/mount-user-engine-rootfs.sh" \
  "$ENGINE_TARGET/bin/brai-dockerd-chroot"
rmdir "$ENGINE_TARGET/rootfs" >/dev/null 2>&1 || true

find "$SOURCE_ROOT/dist" -type f -name '*.js' -exec \
  install -o root -g root -m 0644 '{}' "$TARGET/dist/" ';'
find "$SOURCE_ROOT/dist" -type f -name '*.js.map' -exec \
  install -o root -g root -m 0644 '{}' "$TARGET/dist/" ';'
install -o root -g root -m 0755 \
  "$SOURCE_ROOT/install/provision-runtime-host-keys.sh" \
  "$TARGET/bin/provision-runtime-host-keys"

temporary_gate=$(mktemp "$TARGET/bin/.brai-exec-gate.XXXXXX")
trap 'rm -f "$temporary_gate"' EXIT HUP INT TERM
/usr/bin/cc -O2 -Wall -Wextra -Werror \
  -o "$temporary_gate" "$SOURCE_ROOT/native/brai-exec-gate.c"
chown root:root "$temporary_gate"
chmod 0755 "$temporary_gate"
mv -f "$temporary_gate" "$TARGET/bin/brai-exec-gate"
trap - EXIT HUP INT TERM

temporary_nspawn=$(mktemp "$TARGET/bin/.verified-nspawn.XXXXXX")
trap 'rm -f "$temporary_nspawn"' EXIT HUP INT TERM
/usr/bin/cc -std=c17 -O2 -fPIE -pie -fstack-protector-strong \
  -D_FORTIFY_SOURCE=3 -Wformat -Wformat-security -Werror=format-security \
  -Wall -Wextra -Wpedantic -Wl,-z,relro,-z,now \
  -o "$temporary_nspawn" "$SOURCE_ROOT/native/verified-nspawn.c" -lcrypto
chown root:root "$temporary_nspawn"
chmod 0755 "$temporary_nspawn"
mv -f "$temporary_nspawn" "$TARGET/bin/verified-nspawn"
trap - EXIT HUP INT TERM

for script in storage-lib.sh status-user-storage.sh \
  provision-project-quota.sh measure-project-quota.sh \
  provision-user-engine-identity.sh prepare-user-engine.sh \
  run-user-engine.sh check-user-engine.sh
do
  install -o root -g root -m 0755 \
    "$SOURCE_ROOT/install/$script" "$TARGET/bin/$script"
done
ln -sfn provision-user-engine-identity.sh \
  "$TARGET/bin/provision-user-engine-identity"
ln -sfn prepare-user-engine.sh "$TARGET/bin/prepare-user-engine"
ln -sfn run-user-engine.sh "$TARGET/bin/run-user-engine"
ln -sfn check-user-engine.sh "$TARGET/bin/check-user-engine"
ln -sfn status-user-storage.sh "$TARGET/bin/status-user-storage"
ln -sfn provision-project-quota.sh "$TARGET/bin/provision-project-quota"
ln -sfn measure-project-quota.sh "$TARGET/bin/measure-project-quota"
install -o root -g root -m 0755 \
  "$SOURCE_ROOT/install/check-host-id-pool.sh" \
  "$TARGET/bin/check-host-id-pool"

install -o root -g root -m 0755 \
  "$SOURCE_ROOT/install/provision-runtime-host-keys.sh" \
  "$TARGET/bin/provision-runtime-host-keys"
install -o root -g root -m 0755 \
  "$SOURCE_ROOT/install/provision-runtime-host-nats.sh" \
  "$TARGET/bin/provision-runtime-host-nats"
install -d -o root -g root -m 0755 "$TARGET/share"
install -o root -g root -m 0644 \
  "$SOURCE_ROOT/config/user-engine-resolv.conf" \
  "$TARGET/share/user-engine-resolv.conf"
install -o root -g root -m 0644 \
  "$SOURCE_ROOT/config/user-engine-host-resolv.conf" \
  "$TARGET/share/user-engine-host-resolv.conf"
install -o root -g root -m 0644 \
  "$SOURCE_ROOT/config/rootless-docker-daemon.json" \
  "$CONFIG/docker-daemon.json"

image=/srv/opt/brai-agent-runtime/images/user-sandbox-v1.raw
[ -f "$image" ] && [ ! -L "$image" ] ||
  die "canonical immutable user image is missing"
temporary_root=$(mktemp -d /tmp/brai-user-engine-image.XXXXXX)
trap '/usr/bin/systemd-dissect --umount "$temporary_root" >/dev/null 2>&1 || true; rmdir "$temporary_root" >/dev/null 2>&1 || true' EXIT HUP INT TERM
/usr/bin/systemd-dissect --mount --read-only "$image" "$temporary_root" \
  >/dev/null
install -o root -g root -m 0755 \
  "$temporary_root/usr/bin/rootlesskit" \
  "$ENGINE_TARGET/bin/rootlesskit"
install -o root -g root -m 0755 \
  "$temporary_root/usr/bin/slirp4netns" \
  "$ENGINE_TARGET/bin/slirp4netns"
install -o root -g root -m 0755 \
  "$temporary_root/opt/brai/docker/bin/dockerd-rootless.sh" \
  "$ENGINE_TARGET/bin/dockerd-rootless.sh"
for binary in containerd containerd-shim-runc-v2 ctr docker-init docker-proxy \
  dockerd runc
do
  install -o root -g root -m 0755 \
    "$temporary_root/opt/brai/docker/bin/$binary" \
    "$ENGINE_TARGET/bin/$binary"
done
install -o root -g root -m 0755 \
  "$temporary_root/usr/bin/fuse-overlayfs" \
  "$ENGINE_TARGET/bin/fuse-overlayfs"
install -o root -g root -m 0644 \
  "$temporary_root/usr/lib/x86_64-linux-gnu/libslirp.so.0" \
  "$ENGINE_TARGET/lib/libslirp.so.0"
rm -f "$ENGINE_TARGET/bin/run-user-engine-dockerd"
/usr/bin/systemd-dissect --umount "$temporary_root" >/dev/null
rmdir "$temporary_root"
trap - EXIT HUP INT TERM
install -o root -g root -m 0644 \
  "$SOURCE_ROOT/config/brai-user-engine-rootlesskit.apparmor" \
  /etc/apparmor.d/brai-user-engine-rootlesskit
/usr/sbin/apparmor_parser -r \
  /etc/apparmor.d/brai-user-engine-rootlesskit

install -o root -g root -m 0644 \
  "$SOURCE_ROOT/systemd/brai-agent-runtime-host.service.example" \
  /etc/systemd/system/brai-agent-runtime-host.service
install -o root -g root -m 0644 \
  "$SOURCE_ROOT/systemd/brai-user-sandbox@.service.example" \
  /etc/systemd/system/brai-user-sandbox@.service
install -o root -g root -m 0644 \
  "$SOURCE_ROOT/systemd/brai-user-engine@.service.example" \
  /etc/systemd/system/brai-user-engine@.service
install -o root -g root -m 0644 \
  "$SOURCE_ROOT/config/brai-agent-runtime.modules-load.conf" \
  /etc/modules-load.d/brai-agent-runtime.conf
/usr/sbin/modprobe fuse
[ -c /dev/fuse ] || die "fuse module did not create /dev/fuse"

if [ ! -f "$CONFIG/runtime-host.env" ]; then
  install -o root -g root -m 0644 \
    "$SOURCE_ROOT/config/runtime-host.env.example" \
    "$CONFIG/runtime-host.env"
fi
[ ! -L "$CONFIG/runtime-host.env" ] ||
  die "$CONFIG/runtime-host.env must not be a symlink"
[ -f "$CONFIG/runtime-host.env" ] ||
  die "$CONFIG/runtime-host.env must be a regular file"
chown root:root "$CONFIG/runtime-host.env"
chmod 0644 "$CONFIG/runtime-host.env"

/usr/bin/systemd-analyze verify \
  /etc/systemd/system/brai-agent-runtime-host.service \
  /etc/systemd/system/brai-user-engine@.service \
  /etc/systemd/system/brai-user-sandbox@.service
/usr/bin/systemctl daemon-reload

printf '%s\n' \
  "Installed source under $TARGET; provision credentials before enabling or starting the service."
