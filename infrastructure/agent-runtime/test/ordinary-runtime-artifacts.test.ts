import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

async function source(path: string): Promise<string> {
  return await readFile(new URL(path, root), "utf8");
}

describe("shared immutable ordinary-user runtime artifacts", () => {
  it("pins every non-Ubuntu tool input and emits one shared squashfs image", async () => {
    const builder = await source("image/build-user-sandbox-image.sh");

    expect(builder).toContain("UBUNTU_SNAPSHOT=20260701T000000Z");
    expect(builder).toContain("NODE_VERSION=22.22.3");
    expect(builder).toContain("CODEX_VERSION=0.144.5");
    expect(builder).toContain("DOCKER_VERSION=29.1.3");
    expect(builder).toContain("BUILDX_VERSION=0.30.1");
    expect(builder.match(/_SHA256=[0-9a-f]{64}/gu)?.length).toBe(6);
    expect(builder).toContain(
      "CANONICAL_OUTPUT=/srv/opt/brai-agent-runtime/images/user-sandbox-v1.raw",
    );
    expect(builder).toContain("mksquashfs");
    expect(builder).toContain("-processors 1");
    expect(builder).toContain('-mkfs-time "$SOURCE_DATE_EPOCH"');
    expect(builder).toContain('-all-time "$SOURCE_DATE_EPOCH"');
    expect(builder.match(/assert_canonical_rollout_quiescent/gu)).toHaveLength(
      3,
    );
    expect(builder).toContain(
      "stop brai-agent-runtime-host.service before replacing the shared image",
    );
    expect(builder).not.toMatch(/per[-_](?:agent|task|user).*image/iu);
    expect(builder).not.toContain("qemu-img create");
    const reproducibility = await source(
      "acceptance/reproducible-user-image.sh",
    );
    expect(reproducibility).toContain('"$BUILDER" --output "$first"');
    expect(reproducibility).toContain('"$BUILDER" --output "$second"');
    expect(reproducibility).toContain('cmp "$first" "$second"');
  });

  it("fixes brai IDs and keeps the slot-bound rootless engine inside one quota root", async () => {
    const [builder, service, prepare, probe, codex, daemon, quota] =
      await Promise.all([
        source("image/build-user-sandbox-image.sh"),
        source("systemd/brai-user-engine@.service.example"),
        source("image/assets/prepare-data.sh"),
        source("image/assets/probe-guest-runtime.sh"),
        source("image/assets/brai-codex-exec.sh"),
        source("config/rootless-docker-daemon.json"),
        source("install/provision-project-quota.sh"),
      ]);

    expect(builder).toContain("--uid 1000 --gid 1000");
    expect(builder).toContain("brai:65536:65536");
    expect(builder).toContain("systemd-resolved");
    expect(builder).toContain(
      "systemd-networkd.service systemd-resolved.service",
    );
    expect(builder).toContain(
      '"$root/usr/libexec/docker/cli-plugins/docker-buildx"',
    );
    expect(probe).toContain("systemctl is-enabled systemd-networkd.service");
    expect(probe).toContain("systemctl is-enabled systemd-resolved.service");
    expect(probe).toContain(
      '[ "$(readlink /etc/resolv.conf)" = "../run/systemd/resolve/stub-resolv.conf" ]',
    );
    expect(builder).toContain('"$root/usr/bin/rootlesskit"');
    expect(builder).toContain('rm -f -- "$docker_root/bin/rootlesskit"');
    expect(probe).toContain("/usr/bin/rootlesskit");
    expect(probe).not.toContain("/opt/brai/docker/bin/rootlesskit");
    expect(builder).toContain(
      'chmod 4755 "$root/usr/bin/newuidmap" "$root/usr/bin/newgidmap"',
    );
    expect(service).toContain(
      "ExecStart=/srv/opt/brai-agent-runtime/bin/run-user-engine %i",
    );
    expect(service).toContain("Type=simple");
    expect(service).toContain("Delegate=yes");
    expect(service).toContain("BindPaths=/srv/brai-user-data/%i:/data");
    expect(service).toContain("ProtectSystem=strict");
    expect(prepare).toContain("/data/docker");
    expect(prepare).toContain("/data/postgres");
    expect(builder).toContain('"$root/data/tmp"');
    expect(builder).toContain('"$root/data/var-tmp"');
    expect(quota).toContain('"$data_path/tmp" "$data_path/var-tmp"');
    expect(probe).toContain(`awk '{ gsub(/,/, "", $3); print $3 }'`);
    expect(probe).not.toContain('\\"');
    expect(codex).toContain("/opt/brai/codex/bin/codex exec");
    expect(codex).toContain("-C /data/workspace");
    expect(builder).toContain("-DBRAI_GATE_DROP_UID=1000");
    expect(builder).toContain("'-DGATE_PREFIX=\"/run/brai-agent-gates/\"'");
    expect(JSON.parse(daemon)).toMatchObject({
      "data-root": "/data/docker",
      "exec-root": "/data/docker-exec",
      "storage-driver": "fuse-overlayfs",
    });
  });

  it("passes only the same verified image descriptor to systemd-nspawn", async () => {
    const [native, unit] = await Promise.all([
      source("native/verified-nspawn.c"),
      source("systemd/brai-user-sandbox@.service.example"),
    ]);

    expect(native).toContain("O_NOFOLLOW");
    expect(native).toContain("EVP_sha256()");
    expect(native).toContain("F_DUPFD");
    expect(native).toContain("--image=/proc/self/fd/%d");
    expect(native).toContain(
      '#define IMAGE_PATH "/srv/opt/brai-agent-runtime/images/user-sandbox-v1.raw"',
    );
    expect(native).toContain("metadata.st_nlink != 1");
    expect(unit).toContain(
      "ExecStart=/srv/opt/brai-agent-runtime/bin/verified-nspawn",
    );
    expect(unit).toContain("--settings=no");
    expect(unit).toContain("Type=simple");
    expect(unit).not.toContain("--notify-ready");
    expect(unit).toContain("--read-only");
    expect(unit).not.toContain("--system-call-filter=@mount");
    expect(unit).not.toContain("--system-call-filter=keyctl");
    expect(unit).not.toContain("--bind=/dev/fuse");
    expect(unit).toContain("--bind=${BRAI_USER_DATA}:/data");
    expect(unit).toContain(
      "--bind=/var/lib/brai-agent-runtime/user-gates/%i:/run/brai-agent-gates",
    );
    expect(unit).toContain("--bind=/run/brai-user-engines/%i:/run/user/1000");
    expect(unit.match(/--bind=/gu)).toHaveLength(3);
    expect(unit).not.toContain("--machine=brai-user-");
    expect(unit).toContain("--machine=%i");
    expect(unit).not.toContain("--directory=");
    const runtime = await source("src/user-sandbox-runtime.ts");
    expect(runtime).toContain("(rootMetadata.mode & 0o7777) !== 0o700");
    expect(runtime).toContain("#machineManagerReady");
    expect(runtime).toContain('"--property=Version"');
  });

  it("denies host/private/cross-user traffic and leaves only public IPv4 egress", async () => {
    const [policy, network, installer] = await Promise.all([
      source("network/brai-user-sandboxes.nft"),
      source("network/70-brai-user-veth.network"),
      source("install/install-user-network-policy.sh"),
    ]);

    expect(policy).toContain(
      'iifname "ve-brai-u-*" oifname "ve-brai-u-*" counter drop',
    );
    expect(policy).toContain("10.0.0.0/8");
    expect(policy).toContain("172.16.0.0/12");
    expect(policy).toContain("192.168.0.0/16");
    expect(policy).toContain(
      'iifname "ve-brai-u-*" meta nfproto ipv6 counter drop',
    );
    expect(policy).toContain(
      'iifname "ve-brai-u-*" ct state new,established,related accept',
    );
    expect(policy).toContain('iifname "ve-brai-u-*" counter drop');
    expect(policy).toContain('oifname "ve-brai-u-*" counter drop');
    expect(network).toContain("Address=0.0.0.0/28");
    expect(network).toContain("IPMasquerade=ipv4");
    expect(network).toContain("IPv6SendRA=no");
    expect(installer).not.toMatch(
      /ufw\s+(?:allow|route allow).*in on (?:eth0|en)/u,
    );
    expect(installer).toContain("Brai sandbox DHCP discovery only");
    expect(installer).toContain(
      "from 0.0.0.0 port 68 to 255.255.255.255 port 67",
    );
  });

  it("has an explicit two-user acceptance for every required boundary", async () => {
    const acceptance = await source("acceptance/ordinary-user-runtime.sh");

    expect(acceptance).toContain('[ ! -e "/data/$1/secret" ]');
    expect(acceptance).toContain(
      "cross-user process marker is visible in PID namespace",
    );
    expect(acceptance).toContain("for command_line in /proc/[0-9]*/cmdline");
    expect(acceptance).toContain("parallel_jobs");
    expect(acceptance).toContain("/opt/brai/docker/bin/docker build");
    expect(acceptance).toContain('sqlite3 "$restored"');
    expect(acceptance).toMatch(/postgres@sha256:[0-9a-f]{64}/u);
    expect(acceptance).toContain("for attempt in 1 2 3");
    expect(acceptance).toContain('[ "$pulled" -eq 1 ]');
    expect(acceptance).toContain('"$docker" exec "$2" pg_dump');
    expect(acceptance).toContain('"$docker" exec -i "$2" psql');
    expect(acceptance).toContain('"ID=alpine"');
    expect(acceptance).toContain(
      "rootless container reached protected host endpoint",
    );
    expect(acceptance).toContain("--network none");
    expect(acceptance).toContain("cross-user network request");
    expect(acceptance).toContain("https://example.com/");
    expect(acceptance).toContain("quota-exhaustion.bin");
    expect(acceptance).toContain("after-delete.bin");
    expect(acceptance).toContain("/srv/projects/brai-new");
    expect(acceptance).toContain("/var/run/docker.sock");
    expect(acceptance).toContain("drop_after");
    expect(acceptance).toContain("interface_a=ve-$environment_a");
    expect(acceptance).toContain("brai-user-engine@$environment_name.service");
    expect(acceptance).toContain("wait_for_machine_running");
    expect(acceptance).toContain("wait_for_network_ready");
    expect(acceptance).toContain(
      "systemd-run --quiet --pipe --wait --collect --expand-environment=no",
    );
    expect(
      acceptance.match(/systemd-run --user --expand-environment=no/gu),
    ).toHaveLength(2);
    expect(acceptance).not.toContain("machinectl shell");
    expect(acceptance).toContain(
      'phase "slot-bound rootless Docker and image build"',
    );
    for (const port of ["80", "443", "2375", "2376", "4222", "54321"]) {
      expect(acceptance).toContain(port);
    }
  });

  it("keeps machine-readable quota measurement stdout JSON-only", async () => {
    const measurement = await source("install/measure-project-quota.sh");
    expect(measurement).toContain(
      '"$SCRIPT_DIR/status-user-storage.sh" >/dev/null',
    );
    expect(measurement.trimEnd()).toMatch(
      /printf '%s\\n' \\\n {2}"\{\\"dataPath\\":.*\}"$/u,
    );
  });

  it("keeps all new host scripts executable and parseable, and compiles the verified helper", async () => {
    const scripts = [
      "image/build-user-sandbox-image.sh",
      "image/assets/prepare-data.sh",
      "image/assets/probe-guest-runtime.sh",
      "image/assets/brai-codex-exec.sh",
      "install/provision-user-engine-identity.sh",
      "install/prepare-user-engine.sh",
      "install/run-user-engine.sh",
      "install/check-user-engine.sh",
      "install/install-verified-nspawn.sh",
      "install/install-user-network-policy.sh",
      "install/uninstall-user-storage.sh",
      "acceptance/reproducible-user-image.sh",
      "acceptance/ordinary-user-runtime.sh",
    ];
    for (const path of scripts) {
      const url = new URL(path, root);
      expect((await stat(url)).mode & 0o111).not.toBe(0);
      const parsed = spawnSync("/bin/sh", ["-n", url.pathname], {
        encoding: "utf8",
      });
      expect(parsed.status, parsed.stderr).toBe(0);
    }
    const uninstallStorage = await source("install/uninstall-user-storage.sh");
    expect(uninstallStorage).toContain("--property=LoadState");
    expect(uninstallStorage).not.toContain(
      'awk -v unit="$BRAI_STORAGE_MOUNT_UNIT"',
    );
    const native = new URL("native/verified-nspawn.c", root);
    const compiled = spawnSync(
      "/usr/bin/cc",
      [
        "-std=c17",
        "-Wall",
        "-Wextra",
        "-Wpedantic",
        "-fsyntax-only",
        native.pathname,
      ],
      { encoding: "utf8" },
    );
    expect(compiled.status, compiled.stderr).toBe(0);
  });
});
