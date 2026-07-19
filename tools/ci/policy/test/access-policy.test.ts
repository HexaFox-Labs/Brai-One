import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  auditComposeConfiguration,
  auditDockerfiles,
  auditHostScripts,
  auditSourceTree,
  findDockerfiles,
  loadComposeConfiguration,
  resolveAccountIdentity,
} from "../src/access-policy.js";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "brai-access-policy-"));
  temporaryDirectories.push(directory);
  return directory;
}

function currentIdentity(): { gid: number; uid: number } {
  const getgid = process.getgid;
  const getuid = process.getuid;
  if (getgid === undefined || getuid === undefined) {
    throw new Error("Access policy tests require a POSIX host");
  }
  return { gid: getgid(), uid: getuid() };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("source ownership policy", () => {
  it("accepts owner-accessible source and generated contents", async () => {
    const directory = await temporaryDirectory();
    await mkdir(join(directory, "source"), { mode: 0o700 });
    await writeFile(join(directory, "source", "file.ts"), "export {};\n", {
      mode: 0o600,
    });
    await mkdir(join(directory, "node_modules"), { mode: 0o770 });
    await writeFile(join(directory, "node_modules", "generated.js"), "ok\n", {
      mode: 0o660,
    });

    await expect(auditSourceTree(directory)).resolves.toEqual([]);
  });

  it("excludes only environment-managed control directories", async () => {
    const directory = await temporaryDirectory();
    for (const ignoredName of [".agents", ".codex", ".git"]) {
      const ignoredDirectory = join(directory, ignoredName);
      await mkdir(ignoredDirectory, { mode: 0o700 });
      await writeFile(join(ignoredDirectory, "generated.js"), "generated\n", {
        mode: 0o606,
      });
      await chmod(ignoredDirectory, 0o500);
    }

    const violations = await auditSourceTree(directory);
    await Promise.all(
      [".agents", ".codex", ".git"].map((name) =>
        chmod(join(directory, name), 0o700),
      ),
    );

    expect(violations).toEqual([]);
  });

  it("audits ownership and owner access inside generated directories", async () => {
    const directory = await temporaryDirectory();
    const generated = join(directory, "node_modules");
    await mkdir(generated, { mode: 0o700 });
    await writeFile(join(generated, "generated.js"), "generated\n", {
      mode: 0o600,
    });
    await chmod(join(generated, "generated.js"), 0o020);

    await expect(auditSourceTree(directory)).resolves.toContain(
      "generated_file_access:node_modules/generated.js",
    );
  });

  it("accepts read-only files shipped inside node_modules", async () => {
    const directory = await temporaryDirectory();
    const generated = join(directory, "node_modules");
    await mkdir(join(generated, "package"), { mode: 0o700, recursive: true });
    await writeFile(join(generated, "package", "cache.bin"), "cache\n", {
      mode: 0o444,
    });

    await expect(auditSourceTree(directory)).resolves.toEqual([]);
  });

  it("rejects world-writable generated contents while allowing owner-group collaboration", async () => {
    const directory = await temporaryDirectory();
    const generated = join(directory, "node_modules");
    await mkdir(generated, { mode: 0o770 });
    await writeFile(join(generated, "generated.js"), "generated\n", {
      mode: 0o660,
    });
    await writeFile(join(generated, "unsafe.js"), "unsafe\n", {
      mode: 0o600,
    });
    await chmod(join(generated, "unsafe.js"), 0o602);

    const violations = await auditSourceTree(directory);
    expect(violations).not.toContain(
      "group_writable:node_modules/generated.js",
    );
    expect(violations).toContain("world_writable:node_modules/unsafe.js");
  });

  it("requires the workspace root to block every non-owner", async () => {
    const directory = await temporaryDirectory();
    await chmod(directory, 0o750);

    await expect(
      auditSourceTree(directory, currentIdentity()),
    ).resolves.toContain("workspace_boundary_access:.");
  });

  it("detects exact owner and mode violations", async () => {
    const directory = await temporaryDirectory();
    await mkdir(join(directory, "source"), { mode: 0o700 });
    await writeFile(join(directory, "source", "file.ts"), "export {};\n", {
      mode: 0o600,
    });
    await chmod(join(directory, "source", "file.ts"), 0o622);

    const identity = currentIdentity();
    const violations = await auditSourceTree(directory, {
      uid: identity.uid + 1,
      gid: identity.gid + 1,
    });

    expect(violations).toContain("group_writable:source/file.ts");
    expect(violations).toContain("world_writable:source/file.ts");
    expect(violations.some((value) => value.startsWith("foreign_owner:"))).toBe(
      true,
    );
  });

  it("does not interpret symlink mode bits as writable target permissions", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "file.ts"), "export {};\n", {
      mode: 0o600,
    });
    await symlink("file.ts", join(directory, "link.ts"));

    await expect(auditSourceTree(directory)).resolves.toEqual([]);
  });

  it("rejects dangling and external symlinks", async () => {
    const directory = await temporaryDirectory();
    await symlink("missing.ts", join(directory, "dangling.ts"));
    await symlink(tmpdir(), join(directory, "external"));

    await expect(auditSourceTree(directory)).resolves.toEqual(
      expect.arrayContaining([
        "dangling_symlink:dangling.ts",
        "external_symlink:external",
      ]),
    );
  });

  it("resolves the exact UID and primary GID of a Linux account", () => {
    const currentAccount = spawnSync("/usr/bin/id", ["-un"], {
      encoding: "utf8",
    }).stdout.trim();

    expect(resolveAccountIdentity(currentAccount)).toEqual(currentIdentity());
    expect(() => resolveAccountIdentity("../mark")).toThrow(
      "Invalid account name",
    );
  });
});

describe("container policy", () => {
  it("loads and accepts every profile in the production Compose model", () => {
    const configuration = loadComposeConfiguration(workspaceRoot);
    expect(configuration.services).toHaveProperty("brai-factory-admin");
    expect(auditComposeConfiguration(configuration, workspaceRoot)).toEqual([]);
  });

  it("accepts only the explicit read-only NATS source bind", () => {
    expect(
      auditComposeConfiguration(
        {
          services: {
            "brai-nats": {
              cap_drop: ["ALL"],
              read_only: true,
              security_opt: ["no-new-privileges:true"],
              volumes: [
                {
                  read_only: true,
                  source: "infrastructure/nats/nats-server.conf",
                  target: "/etc/nats/nats-server.conf",
                  type: "bind",
                },
              ],
            },
          },
        },
        workspaceRoot,
      ),
    ).toEqual([]);
  });

  it("rejects host namespaces, added capabilities, public ports and runtime sockets", () => {
    const configuration = {
      services: {
        unsafe: {
          cap_add: ["SYS_ADMIN"],
          cap_drop: ["ALL"],
          ipc: "host",
          network_mode: "host",
          pid: "host",
          ports: [{ host_ip: "0.0.0.0" }],
          privileged: true,
          read_only: true,
          security_opt: ["no-new-privileges:true"],
          volumes: [
            {
              read_only: true,
              source: "/run/user/1000/docker.sock",
              target: "/run/docker.sock",
              type: "bind",
            },
          ],
        },
      },
    };

    expect(auditComposeConfiguration(configuration, workspaceRoot)).toEqual(
      expect.arrayContaining([
        "compose_capabilities_added:unsafe",
        "compose_host_ipc:unsafe",
        "compose_host_network:unsafe",
        "compose_host_pid:unsafe",
        "compose_host_runtime_socket:unsafe",
        "compose_privileged:unsafe",
        "compose_public_port:unsafe",
        "compose_unapproved_bind_mount:unsafe:/run/docker.sock",
      ]),
    );
  });

  it("requires an explicit non-root final Dockerfile user", async () => {
    const directory = await temporaryDirectory();
    const sources = {
      "missing.Dockerfile": 'FROM alpine\nCMD ["true"]\n',
      "named.Dockerfile":
        "FROM alpine AS build\nUSER root\nFROM alpine\nUSER node:node\n",
      "numeric-root.Dockerfile": "FROM alpine\nUSER 00:1000\n",
      "numeric.Dockerfile": "FROM alpine\nUSER 65534:65534\n",
      "root.Dockerfile": "FROM alpine\nUSER root:root\n",
      "variable.Dockerfile": "FROM alpine\nUSER ${APP_UID}\n",
    };
    await Promise.all(
      Object.entries(sources).map(([path, source]) =>
        writeFile(join(directory, path), source, { mode: 0o600 }),
      ),
    );

    await expect(
      auditDockerfiles(directory, Object.keys(sources)),
    ).resolves.toEqual([
      "dockerfile_root_final_user:missing.Dockerfile",
      "dockerfile_root_final_user:numeric-root.Dockerfile",
      "dockerfile_root_final_user:root.Dockerfile",
      "dockerfile_root_final_user:variable.Dockerfile",
    ]);
  });

  it("accepts every real Dockerfile's final user", async () => {
    const dockerfiles = await findDockerfiles(workspaceRoot);
    expect(dockerfiles.length).toBeGreaterThan(0);
    await expect(auditDockerfiles(workspaceRoot, dockerfiles)).resolves.toEqual(
      [],
    );
  });

  it("discovers standard and named Dockerfile variants", async () => {
    const directory = await temporaryDirectory();
    await Promise.all(
      [
        "Dockerfile",
        "Dockerfile.admin",
        "worker.Dockerfile",
        "not-a-dockerfile",
      ].map((name) =>
        writeFile(join(directory, name), "FROM scratch\nUSER 1\n", {
          mode: 0o600,
        }),
      ),
    );

    await expect(findDockerfiles(directory)).resolves.toEqual([
      "Dockerfile",
      "Dockerfile.admin",
      "worker.Dockerfile",
    ]);
  });
});

describe("host command policy", () => {
  it("rejects recursive permission repair and privileged project builds", async () => {
    const directory = await temporaryDirectory();
    const scripts = {
      "chmod.sh": "chmod -v -R u+rwX ./source\n",
      "chown.sh": "chown -v --recursive mark:mark ./source\n",
      "mode.sh": "chmod --verbose 0777 ./source\n",
      "package.json": JSON.stringify({
        scripts: { repair: "chmod --recursive u+rwX ./source" },
      }),
      "safe.sh": "sudo -n systemctl restart brai-new.target\n",
      "sudo-build.mjs": "sudo -n env NODE_ENV=production pnpm run build\n",
      "workflow.yml": "run: sudo -n pnpm run build\n",
    };
    await Promise.all(
      Object.entries(scripts).map(([path, source]) =>
        writeFile(join(directory, path), source, { mode: 0o600 }),
      ),
    );

    await expect(auditHostScripts(directory)).resolves.toEqual([
      "host_script_chmod_777:mode.sh",
      "host_script_recursive_chmod:chmod.sh",
      "host_script_recursive_chmod:package.json",
      "host_script_recursive_chown:chown.sh",
      "host_script_sudo_project_build:sudo-build.mjs",
      "host_script_sudo_project_build:workflow.yml",
    ]);
  });

  it("keeps forbidden commands out of real host scripts", async () => {
    await expect(auditHostScripts(workspaceRoot)).resolves.toEqual([]);
  });
});
