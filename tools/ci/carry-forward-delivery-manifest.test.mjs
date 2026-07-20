import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { imageNames } from "../../infrastructure/delivery/controller/constants.mjs";

const root = resolve(import.meta.dirname, "../..");
const script = resolve(root, "tools/ci/carry-forward-delivery-manifest.mjs");
const digest = (index) => `sha256:${String(index + 1).repeat(64)}`;

test("advances only the source revision and reuses every image digest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "brai-carry-manifest-"));
  const sourcePath = join(directory, "source.json");
  const outputPath = join(directory, "output.json");
  const images = Object.fromEntries(
    imageNames.map((name, index) => [
      name,
      `ghcr.io/hexafox-labs/brai-one@${digest(index)}`,
    ]),
  );
  await writeFile(
    sourcePath,
    JSON.stringify({
      images,
      repository: "HexaFox-Labs/Brai-One",
      revision: "a".repeat(40),
      schemaVersion: "brai.delivery.manifest.v1",
    }),
  );

  execFileSync(process.execPath, [
    script,
    sourcePath,
    outputPath,
    "b".repeat(40),
  ]);

  const result = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(result.revision, "b".repeat(40));
  assert.deepEqual(result.images, images);
});
