import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { imageNames } from "./constants.mjs";
import { DockerRuntime } from "./docker-runtime.mjs";
import { createRuntimeSecrets } from "./runtime-config.mjs";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const composeFile = resolve(
  workspaceRoot,
  "infrastructure/delivery/compose.runtime.yml",
);
const digest = `sha256:${"a".repeat(64)}`;
const manifest = {
  images: Object.fromEntries(
    imageNames.map((name) => [
      name,
      `ghcr.io/hexaf0x-labs/brai-one/brai-${name}@${digest}`,
    ]),
  ),
};

test("preview Compose is source-free, isolated and binds only paired loopback ports", async () => {
  const root = await mkdtemp(join(tmpdir(), "brai-compose-"));
  const runtime = new DockerRuntime({
    root,
    composeFile,
    execute: async () => undefined,
  });
  const directory = await runtime.writeConfiguration({
    prefix: "p07",
    slot: 7,
    manifest,
    secrets: createRuntimeSecrets(),
  });
  const result = spawnSync(
    "docker",
    [
      "compose",
      "--project-name",
      "p07-brai",
      "--env-file",
      join(directory, "compose.env"),
      "--file",
      composeFile,
      "--profile",
      "admin",
      "config",
      "--format",
      "json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const configuration = JSON.parse(result.stdout);
  assert.equal(
    configuration.services["brai-web"].container_name,
    "p07-brai-web",
  );
  assert.equal(
    configuration.services["brai-api-gateway"].container_name,
    "p07-brai-api-gateway",
  );
  const ports = Object.entries(configuration.services).flatMap(
    ([name, service]) =>
      (service.ports ?? []).map((port) => [
        name,
        port.host_ip,
        String(port.published),
      ]),
  );
  assert.deepEqual(ports, [
    ["brai-api-gateway", "127.0.0.1", "3517"],
    ["brai-web", "127.0.0.1", "3417"],
  ]);
  assert.deepEqual(
    [...configuration.services["brai-postgres"].cap_add].sort(),
    ["CHOWN", "FOWNER", "SETGID", "SETUID"],
  );
  for (const service of Object.values(configuration.services)) {
    assert.equal(service.build, undefined);
    if (service !== configuration.services["brai-postgres"]) {
      assert.equal(service.cap_add, undefined);
    }
    assert.equal(
      (service.volumes ?? []).some((volume) => volume.type === "bind"),
      false,
    );
  }
});
