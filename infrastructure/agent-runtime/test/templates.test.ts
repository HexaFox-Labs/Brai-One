import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

describe("inactive sandbox templates", () => {
  it("defines one bounded sparse backing file and a canonical loop-XFS mount", async () => {
    const [runtimeSource, setupUnit, mountUnit, installer, statusScript] =
      await Promise.all([
        readFile(new URL("config/runtime.example.json", root), "utf8"),
        readFile(
          new URL("systemd/brai-user-storage-setup.service.example", root),
          "utf8",
        ),
        readFile(
          new URL("systemd/srv-brai%5Cx2duser%5Cx2ddata.mount.example", root),
          "utf8",
        ),
        readFile(new URL("install/install-user-storage.sh", root), "utf8"),
        readFile(new URL("install/status-user-storage.sh", root), "utf8"),
      ]);
    const runtime = JSON.parse(runtimeSource) as {
      userSandbox: {
        storageBackingFile: string;
        storageBackingKind: string;
        aggregateLogicalCeilingBytes: number;
      };
    };

    expect(runtime.userSandbox).toMatchObject({
      storageBackingFile: "/srv/brai-storage/user-data.xfs",
      storageBackingKind: "one-shared-bounded-sparse-file",
      aggregateLogicalCeilingBytes: 6 * 1_024 * 1_024 * 1_024,
    });
    expect(setupUnit).toContain("status-user-storage --backing-only");
    expect(mountUnit).toContain("What=/srv/brai-storage/user-data.xfs");
    expect(mountUnit).toContain("Where=/srv/brai-user-data");
    expect(mountUnit).toContain("Options=loop,prjquota,nodev,nosuid,nodiscard");
    expect(installer).toContain('truncate -s "$ceiling"');
    expect(installer).toContain(
      'mkfs.xfs -f -L brai-udata "$BRAI_STORAGE_BACKING"',
    );
    expect(installer).not.toContain("fallocate");
    expect(statusScript).toContain('assert_free_floor "$BRAI_STORAGE_PARENT"');
    expect(statusScript).toContain('assert_free_floor "$BRAI_STORAGE_MOUNT"');
  });

  it("reclaims deleted sparse backing blocks through a root-owned daily fstrim", async () => {
    const [service, timer, installer, statusScript] = await Promise.all([
      readFile(
        new URL("systemd/brai-user-storage-trim.service.example", root),
        "utf8",
      ),
      readFile(
        new URL("systemd/brai-user-storage-trim.timer.example", root),
        "utf8",
      ),
      readFile(new URL("install/install-user-storage.sh", root), "utf8"),
      readFile(new URL("install/status-user-storage.sh", root), "utf8"),
    ]);

    expect(service).toContain(
      "ExecStart=/usr/sbin/fstrim --verbose /srv/brai-user-data",
    );
    expect(timer).toContain("OnCalendar=daily");
    expect(timer).toContain("Persistent=yes");
    expect(installer).toContain(
      "systemctl enable --now brai-user-storage-trim.timer",
    );
    expect(statusScript).toContain(
      "systemctl is-active --quiet brai-user-storage-trim.timer",
    );
  });

  it("keeps storage and quota helpers executable and shell-parseable", async () => {
    const scripts = [
      "storage-lib.sh",
      "install-user-storage.sh",
      "status-user-storage.sh",
      "uninstall-user-storage.sh",
      "provision-project-quota.sh",
      "measure-project-quota.sh",
      "../acceptance/one-disk-project-quota.sh",
    ];
    for (const script of scripts) {
      const url = new URL(`install/${script}`, root);
      const metadata = await stat(url);
      expect(metadata.mode & 0o111).not.toBe(0);
      const result = spawnSync("/bin/sh", ["-n", url.pathname], {
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
    }
  });

  it("provisions and independently measures XFS project hard limits", async () => {
    const [provisioner, measurer] = await Promise.all([
      readFile(new URL("install/provision-project-quota.sh", root), "utf8"),
      readFile(new URL("install/measure-project-quota.sh", root), "utf8"),
    ]);

    expect(provisioner).toContain("project -s -p $data_path $project_id");
    expect(provisioner).toContain("bhard=$hard_bytes");
    expect(provisioner).not.toMatch(/chown\s+-R/u);
    expect(measurer).toContain("project -c -p $data_path $project_id");
    expect(measurer).toContain(
      "report -p -b -n -N -L $project_id -U $project_id",
    );
    expect(measurer).toContain("Accounting:[[:space:]]+ON");
    expect(measurer).toContain("Enforcement:[[:space:]]+ON");
  });

  it("uses a stable outer range and a slot-bound rootless engine", async () => {
    const [unit, engine] = await Promise.all([
      readFile(
        new URL("systemd/brai-user-sandbox@.service.example", root),
        "utf8",
      ),
      readFile(
        new URL("systemd/brai-user-engine@.service.example", root),
        "utf8",
      ),
    ]);

    expect(unit).toContain("--private-users=${BRAI_USERNS_START}:131072");
    expect(unit).toContain("--private-users-ownership=map");
    expect(unit).not.toContain("--private-users=pick");
    expect(unit).toContain("--read-only");
    expect(unit).not.toContain("--system-call-filter=@mount");
    expect(unit).not.toContain("--system-call-filter=keyctl");
    expect(unit).not.toContain("--bind=/dev/fuse");
    expect(unit).toContain("--bind=${BRAI_USER_DATA}:/data");
    expect(unit).toContain("--bind=/run/brai-user-engines/%i:/run/user/1000");
    expect(unit).toContain("brai-user-engine@%i.service");
    expect(unit).toContain(
      "Requires=brai-users.slice srv-brai\\x2duser\\x2ddata.mount",
    );
    expect(unit).toContain(
      "ExecStartPre=/srv/opt/brai-agent-runtime/bin/status-user-storage",
    );
    expect(unit).toContain("MemoryMax=1G");
    expect(unit).toContain("MemorySwapMax=512M");
    expect(unit).toContain("TasksMax=512");
    expect(unit).toContain("CPUQuota=50%");
    expect(engine).toContain("MemoryMax=3G");
    expect(engine).toContain("MemorySwapMax=1536M");
    expect(engine).toContain("TasksMax=1536");
    expect(engine).toContain("CPUQuota=150%");
    expect(engine).toContain("Delegate=yes");
    expect(unit).toContain("IOWeight=100");
    expect(unit).toContain("--setenv=TMPDIR=/data/tmp");
    expect(unit).toContain("--setenv=SQLITE_TMPDIR=/data/tmp");
    expect(unit).not.toContain("/var/run/docker.sock");
  });

  it("binds one project directory from the shared pool, never a per-user image", async () => {
    const template = await readFile(
      new URL("nspawn/brai-user-sandbox.nspawn.example", root),
      "utf8",
    );
    const binds = template
      .split("\n")
      .filter((line) => line.startsWith("Bind="));

    expect(binds).toEqual([
      "Bind=/srv/brai-user-data/<allocated-environment-name>:/data",
      "Bind=/run/brai-user-engines/<allocated-environment-name>:/run/user/1000",
    ]);
    expect(template).toContain("single shared");
    expect(template).not.toMatch(/Image=.*<allocated/iu);
  });

  it("places every sandbox below the configured aggregate resource slice", async () => {
    const [sandboxUnit, sliceUnit, policySource] = await Promise.all([
      readFile(
        new URL("systemd/brai-user-sandbox@.service.example", root),
        "utf8",
      ),
      readFile(new URL("systemd/brai-users.slice.example", root), "utf8"),
      readFile(
        new URL("config/host-resource-policy.example.json", root),
        "utf8",
      ),
    ]);
    const policy = JSON.parse(policySource) as {
      sliceName: string;
      limits: {
        memoryMaxBytes: number;
        memorySwapMaxBytes: number;
        cpuQuotaPercent: number;
        tasksMax: number;
      };
    };

    expect(sandboxUnit).toContain("Requires=brai-users.slice");
    expect(sandboxUnit).toContain("Slice=brai-users.slice");
    expect(sliceUnit).toContain("MemoryMax=24G");
    expect(sliceUnit).toContain("MemorySwapMax=4G");
    expect(sliceUnit).toContain("CPUQuota=600%");
    expect(sliceUnit).toContain("TasksMax=12288");
    expect(policy).toMatchObject({
      sliceName: "brai-users.slice",
      limits: {
        memoryMaxBytes: 24 * 1_024 * 1_024 * 1_024,
        memorySwapMaxBytes: 4 * 1_024 * 1_024 * 1_024,
        cpuQuotaPercent: 600,
        tasksMax: 12_288,
      },
    });
  });

  it("keeps persistent Docker data below quota and execution state ephemeral", async () => {
    const source = await readFile(
      new URL("config/rootless-docker-daemon.json", root),
      "utf8",
    );
    const config = JSON.parse(source) as {
      "data-root": string;
      "exec-root": string;
      features: { "containerd-snapshotter": boolean };
    };

    expect(config["data-root"]).toBe("/data/docker");
    expect(config["exec-root"]).toBe("/data/docker-exec");
    expect(config.features["containerd-snapshotter"]).toBe(false);
  });

  it("runs one slot-bound rootless engine outside the nspawn nesting layer", async () => {
    const [unit, launcher] = await Promise.all([
      readFile(
        new URL("systemd/brai-user-engine@.service.example", root),
        "utf8",
      ),
      readFile(new URL("install/run-user-engine.sh", root), "utf8"),
    ]);

    expect(unit).toContain("User=root");
    expect(unit).toContain("Type=simple");
    expect(unit).toContain(
      "ExecStart=/srv/opt/brai-agent-runtime/bin/run-user-engine %i",
    );
    expect(unit).toContain("NoNewPrivileges=no");
    expect(unit).toContain("InaccessiblePaths=/srv/projects");
    expect(unit).toContain("BindPaths=/srv/brai-user-data/%i:/data");
    expect(unit).toContain("ProtectSystem=strict");
    expect(launcher).toContain('--reuid="$engine_uid"');
    expect(launcher).toContain("DOCKERD_ROOTLESS_ROOTLESSKIT_FLAGS=--pidns");
    expect(launcher).toContain("DOCKERD=/srv/opt/brai-user-engine/bin/dockerd");
    expect(launcher).not.toContain("chroot");
  });
});
