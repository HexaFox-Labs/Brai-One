import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { imageNames } from "./constants.mjs";
import {
  DockerRuntime,
  snapshotDumpArguments,
  streamProcess,
} from "./docker-runtime.mjs";
import { createRuntimeSecrets } from "./runtime-config.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const manifest = {
  images: Object.fromEntries(
    imageNames.map((name) => [
      name,
      `ghcr.io/hexaf0x-labs/brai-one/brai-${name}@${digest}`,
    ]),
  ),
};

test("uses fixed Compose arguments and writes root-private per-slot config", async () => {
  const root = await mkdtemp(join(tmpdir(), "brai-runtime-"));
  const calls = [];
  const runtime = new DockerRuntime({
    root,
    composeFile: "/fixed/compose.runtime.yml",
    execute: async (command, argumentsList) =>
      calls.push([command, argumentsList]),
  });
  await runtime.deploy({
    prefix: "p01",
    slot: 1,
    manifest,
    changedImages: { web: digest },
    initial: false,
    secrets: createRuntimeSecrets(),
  });
  const compose = await readFile(join(root, "runtime/p01/compose.env"), "utf8");
  assert.match(compose, /^BRAI_PREFIX=p01$/mu);
  assert.equal(calls[0]?.[0], "docker");
  assert.deepEqual(calls.at(-1)?.[1].slice(-2), ["--no-deps", "brai-web"]);
  assert.equal(
    calls.every(([, args]) => !args.includes("sh")),
    true,
  );
});

test("initial runtime creates the Access foundation before its least-privilege roles", async () => {
  const root = await mkdtemp(join(tmpdir(), "brai-runtime-initial-"));
  const calls = [];
  const runtime = new DockerRuntime({
    root,
    composeFile: "/fixed/compose.runtime.yml",
    execute: async (command, argumentsList) =>
      calls.push([command, argumentsList]),
  });

  await runtime.deploy({
    prefix: "d",
    manifest,
    changedImages: Object.fromEntries(imageNames.map((name) => [name, digest])),
    initial: true,
    secrets: createRuntimeSecrets(),
  });

  const commandIndex = (service, script) =>
    calls.findIndex(
      ([, args]) => args.includes(service) && args.includes(script),
    );
  const factoryAudit = commandIndex(
    "brai-factory-admin",
    "dist/audit-runtime-role.js",
  );
  const accessFoundation = commandIndex(
    "brai-access-admin",
    "dist/bootstrap-foundation.js",
  );
  const accessMigrator = commandIndex(
    "brai-access-admin",
    "dist/bootstrap-migration-role.js",
  );
  const accessMigratorProvision = commandIndex(
    "brai-access-admin",
    "dist/provision-migration-role.js",
  );
  const accessMigratorAudit = commandIndex(
    "brai-access-admin",
    "dist/audit-migration-role.js",
  );
  const accessMigrations = commandIndex("brai-access-admin", "dist/migrate.js");
  const accessRuntimeProvision = commandIndex(
    "brai-access-admin",
    "dist/provision-runtime-role.js",
  );

  assert.ok(factoryAudit >= 0);
  assert.ok(accessFoundation > factoryAudit);
  assert.ok(accessMigrator > accessFoundation);
  assert.ok(accessMigratorProvision > accessMigrator);
  assert.ok(accessMigratorAudit > accessMigratorProvision);
  assert.ok(accessMigrations > accessMigratorAudit);
  assert.ok(accessRuntimeProvision > accessMigrations);
});

test("initial runtime resumes only a verified existing Access foundation", async () => {
  const root = await mkdtemp(join(tmpdir(), "brai-runtime-retry-"));
  const calls = [];
  const runtime = new DockerRuntime({
    root,
    composeFile: "/fixed/compose.runtime.yml",
    execute: async (command, argumentsList) => {
      calls.push([command, argumentsList]);
      if (argumentsList.includes("dist/bootstrap-foundation.js")) {
        throw new Error(
          "Host command failed (1): brai_access_migrator already exists; use the dedicated migration command",
        );
      }
    },
  });

  await runtime.deploy({
    prefix: "d",
    manifest,
    changedImages: Object.fromEntries(imageNames.map((name) => [name, digest])),
    initial: true,
    secrets: createRuntimeSecrets(),
  });

  assert.ok(
    calls.some(([, args]) => args.includes("dist/bootstrap-migration-role.js")),
  );
});

test("does not accept an unexpected Access foundation failure", async () => {
  const runtime = new DockerRuntime({
    root: "/runtime",
    execute: async () => {
      throw new Error("foundation credential rejected");
    },
  });

  await assert.rejects(
    runtime.runAccessFoundation([]),
    /foundation credential rejected/,
  );
});

test("measures only the controller-owned slot volumes", async () => {
  const runtime = new DockerRuntime({
    root: "/runtime",
    output: async (command, argumentsList) => {
      if (command === "docker") {
        return `/var/lib/docker/volumes/${argumentsList[2]}/_data\n`;
      }
      return "1048576 /var/lib/docker/volumes/slot/_data\n";
    },
  });
  assert.equal(await runtime.slotStorageBytes("p01"), 2 * 1024 * 1024);
});

test("streams a snapshot child output into a file without passing a stream as stdio", async () => {
  const root = await mkdtemp(join(tmpdir(), "brai-stream-process-"));
  const destination = join(root, "snapshot.dump");
  const output = createWriteStream(destination);

  await streamProcess(
    process.execPath,
    ["-e", "process.stdout.write('immutable-snapshot')"],
    { stdout: output },
  );

  assert.equal(await readFile(destination, "utf8"), "immutable-snapshot");
});

test("omits migration-owned policy from a Dev data snapshot", () => {
  const argumentsList = snapshotDumpArguments("d", "test-password");

  assert.ok(
    argumentsList.includes("--exclude-table=brai_access.allocation_policies"),
  );
  assert.ok(argumentsList.includes("--data-only"));
  assert.ok(argumentsList.includes("--schema=brai_factory"));
  assert.ok(argumentsList.includes("--schema=brai_access"));
});
