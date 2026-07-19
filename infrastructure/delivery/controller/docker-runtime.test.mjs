import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { imageNames } from "./constants.mjs";
import { DockerRuntime } from "./docker-runtime.mjs";
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
