import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const deploymentRoot = resolve(import.meta.dirname, "..");

describe("fixed host deployment command", () => {
  it("runs migrations before rollout and moves current only after health", async () => {
    const source = await readFile(
      resolve(deploymentRoot, "bin/deploy-release"),
      "utf8",
    );
    const migration = source.indexOf("run \\\n  --rm");
    const backup = source.indexOf('systemctl start "${backup_service}"');
    const factoryMigration = source.indexOf(
      "--pull never \\\n  brai-factory-admin",
      migration,
    );
    const accessMigration = source.indexOf(
      "--pull never \\\n  brai-access-admin",
      factoryMigration + 1,
    );
    const rollout = source.indexOf("up \\\n  --detach");
    const switchCurrent = source.indexOf(
      'mv -Tf "${temporary_link}" "${current_link}"',
    );

    expect(backup).toBeGreaterThan(0);
    expect(migration).toBeGreaterThan(backup);
    expect(factoryMigration).toBeGreaterThan(migration);
    expect(accessMigration).toBeGreaterThan(factoryMigration);
    expect(accessMigration).toBeLessThan(rollout);
    expect(rollout).toBeGreaterThan(migration);
    expect(switchCurrent).toBeGreaterThan(rollout);
    expect(source).toContain("--no-build");
    expect(source).toContain("--pull never");
    expect(source).toContain("=ghcr\\.io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:");
    expect(source).not.toContain("/brai-[a-z-]+@sha256:");
    expect(source).toContain("--wait");
    expect(source).toContain("node dist/provision-runtime-role.js");
    expect(source).toContain("node dist/audit-runtime-role.js");
    expect(source).toContain("brai_factory");
    expect(source).toContain("brai_access");
    expect(source).toContain(
      'systemctl show "${backup_service}" --property=ExecStart --value',
    );
    expect(source).toContain('"${deployment_root}/bin/pre-migration-backup"');
  });

  it("rolls runtime images back from the prior healthy release", async () => {
    const source = await readFile(
      resolve(deploymentRoot, "bin/deploy-release"),
      "utf8",
    );
    expect(source).toContain('"${previous_release}/images.env" up');
    expect(source).toContain("Runtime image rollback completed");
    expect(source).toContain("No previously healthy digest release exists");
    expect(source).toContain('"${previous_link}"');
    expect(source).toContain('docker image rm "${value}"');
    expect(source).not.toContain("docker image prune");
  });

  it("does not build or address the project checkout", async () => {
    const sources = await Promise.all([
      readFile(resolve(deploymentRoot, "bin/deploy-release"), "utf8"),
      readFile(resolve(deploymentRoot, "bin/pre-migration-backup"), "utf8"),
      readFile(resolve(deploymentRoot, "bin/receive-release.mjs"), "utf8"),
      readFile(resolve(deploymentRoot, "compose.production.yml"), "utf8"),
    ]);
    const combined = sources.join("\n");
    expect(combined).not.toContain("/srv/projects/brai-new");
    expect(combined).not.toMatch(/^\s*build:/mu);
  });

  it("filters absent schemas before invoking the protected backup", async () => {
    const source = await readFile(
      resolve(deploymentRoot, "bin/pre-migration-backup"),
      "utf8",
    );
    expect(source).toContain("SELECT nspname FROM pg_namespace");
    expect(source).toContain("backup_owner");
    expect(source).toContain("backup_mode");
    expect(source).toContain(
      'export BRAI_BACKUP_SCHEMAS="${filtered_schemas[*]}"',
    );
    expect(source).toContain("unset BRAI_DATABASE_URL");
    expect(source).toContain('exec "${backup_program}"');
  });
});
