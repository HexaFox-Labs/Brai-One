/* global process */

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const deploymentRoot = resolve(import.meta.dirname, "..");
const principalLibrary = resolve(deploymentRoot, "lib/deploy-principal.sh");
const temporaryRoots = [];

async function fakeSudo(output) {
  const root = await mkdtemp(join(tmpdir(), "brai-deploy-principal-"));
  temporaryRoots.push(root);
  await writeFile(
    join(root, "sudo"),
    `#!/bin/sh\ncat <<'EOF'\n${output}\nEOF\n`,
    { mode: 0o755 },
  );
  return root;
}

function runLibrary(expression, pathPrefix = "") {
  return spawnSync(
    "bash",
    [
      "-c",
      'source "$1"; shift; eval "$1"',
      "brai-deploy-principal-test",
      principalLibrary,
      expression,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: pathPrefix
          ? `${pathPrefix}:${process.env.PATH ?? ""}`
          : process.env.PATH,
      },
    },
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("dedicated immutable deployment principal", () => {
  it("renders the one forced key and the one sudo command", () => {
    const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKeyMaterial";
    const authorized = runLibrary(
      `brai_deploy_expected_authorized_key "${key}"`,
    );
    const sudoers = runLibrary("brai_deploy_expected_sudoers");

    expect(authorized.status).toBe(0);
    expect(authorized.stdout).toBe(
      'restrict,command="sudo -n /srv/opt/brai-new-deploy/bin/receive-release.mjs" ' +
        key,
    );
    expect(sudoers.status).toBe(0);
    expect(sudoers.stdout).toBe(
      "brai-new-deploy ALL=(root) NOPASSWD: " +
        "/srv/opt/brai-new-deploy/bin/receive-release.mjs",
    );
  });

  it("accepts exactly one effective receiver grant", async () => {
    const fakePath = await fakeSudo(`Matching Defaults entries for user
User brai-new-deploy may run the following commands:
    (root) NOPASSWD: /srv/opt/brai-new-deploy/bin/receive-release.mjs`);
    const result = runLibrary("brai_deploy_assert_effective_sudo", fakePath);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it.each([
    [
      "a broad global grant",
      `User brai-new-deploy may run the following commands:
    (root) NOPASSWD: /srv/opt/brai-new-deploy/bin/receive-release.mjs
    (ALL : ALL) NOPASSWD: ALL`,
    ],
    [
      "a duplicate grant inherited from another sudoers source",
      `User brai-new-deploy may run the following commands:
    (root) NOPASSWD: /srv/opt/brai-new-deploy/bin/receive-release.mjs
    (root) NOPASSWD: /srv/opt/brai-new-deploy/bin/receive-release.mjs`,
    ],
    [
      "a receiver grant with arguments",
      `User brai-new-deploy may run the following commands:
    (root) NOPASSWD: /srv/opt/brai-new-deploy/bin/receive-release.mjs *`,
    ],
  ])("rejects %s", async (_description, output) => {
    const fakePath = await fakeSudo(output);
    const result = runLibrary("brai_deploy_assert_effective_sudo", fakePath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "missing, duplicate, or broader effective sudo rules",
    );
  });

  it("rejects inherited sudo before an inactive identity can be activated", async () => {
    const fakePath =
      await fakeSudo(`User brai-new-deploy may run the following commands:
    (ALL : ALL) ALL`);
    const result = runLibrary("brai_deploy_assert_no_effective_sudo", fakePath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Inactive deployment account already has effective sudo rights",
    );
  });

  it("creates a locked account and only migrates existing SSH read modes", async () => {
    const installer = await readFile(
      resolve(deploymentRoot, "install-host-tooling.sh"),
      "utf8",
    );
    expect(installer).toContain('groupadd --system "${BRAI_DEPLOY_GROUP}"');
    expect(installer).toContain("useradd \\");
    expect(installer).toContain('passwd --lock "${BRAI_DEPLOY_USER}"');
    expect(installer).toContain('chmod 0755 "${BRAI_DEPLOY_SSH_DIR}"');
    expect(installer).toContain('chmod 0644 "${BRAI_DEPLOY_AUTHORIZED_KEYS}"');
    expect(installer).not.toContain("brai_deploy_expected_authorized_key");
    expect(installer).not.toContain("BRAI_DEPLOY_SUDOERS");
  });

  it("fails the receiver outside the exact sudo identity", async () => {
    const receiver = await readFile(
      resolve(deploymentRoot, "bin/receive-release.mjs"),
      "utf8",
    );
    expect(receiver).toContain('const expectedDeployUser = "brai-new-deploy"');
    expect(receiver).toContain("process.env.SUDO_USER !== expectedDeployUser");
    expect(receiver).toContain("process.env.SUDO_UID !== accountUid");
    expect(receiver).toContain("process.env.SUDO_GID !== accountGid");
    expect(receiver).toContain(
      "process.env.SUDO_COMMAND !== expectedReceiverCommand",
    );
    expect(receiver).toContain("await runPrincipalAudit()");
    expect(receiver).toContain('spawn(principalAuditCommand, ["active"]');
    expect(receiver).not.toContain("SSH_ORIGINAL_COMMAND");
  });

  it("keeps activation transactional and idempotent", async () => {
    const finalize = await readFile(
      resolve(deploymentRoot, "bin/finalize-deploy-activation"),
      "utf8",
    );
    const installSudo = finalize.indexOf(
      'mv -f "${temporary_sudoers}" "${BRAI_DEPLOY_SUDOERS}"',
    );
    const installSsh = finalize.indexOf(
      'mv -f "${temporary_authorized_keys}" ' +
        '"${BRAI_DEPLOY_AUTHORIZED_KEYS}"',
    );
    expect(installSudo).toBeGreaterThan(0);
    expect(installSsh).toBeGreaterThan(installSudo);
    expect(finalize).toContain("brai_deploy_assert_active");
    expect(finalize).toContain('chmod 0644 "${temporary_authorized_keys}"');
    expect(finalize).toContain("Refusing to replace an active deployment key");
    expect(finalize).toContain("if [[ ${activated} -eq 1 ]]");
    expect(finalize.lastIndexOf("activated=1", installSudo)).toBeGreaterThan(0);
  });
});
