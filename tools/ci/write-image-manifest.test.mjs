import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const writer = resolve(root, "tools/ci/write-image-manifest.mjs");
const imageNames = [
  "web",
  "api-gateway",
  "factory",
  "access",
  "factory-admin",
  "access-admin",
  "nats",
];
const repository = "HexaFox-Labs/Brai-One";
const previousRevision = "a".repeat(40);
const revision = "b".repeat(40);

test("reuses unchanged image digests from a verified base manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "brai-manifest-"));
  const basePath = join(directory, "base.json");
  const outputPath = join(directory, "output.json");
  const baseImages = Object.fromEntries(
    imageNames.map((name, index) => {
      const digest = `sha256:${String(index + 1).repeat(64)}`;
      return [
        name,
        {
          digest,
          reference: `ghcr.io/hexafox-labs/brai-one/brai-${name}@${digest}`,
        },
      ];
    }),
  );
  await writeFile(
    basePath,
    `${JSON.stringify({
      schema_version: "brai.deployment.images.v1",
      host_contract_version: "brai.production-host.v2",
      source_repository: repository,
      source_revision: previousRevision,
      images: baseImages,
    })}\n`,
  );

  const environment = {
    ...process.env,
    BRAI_IMAGE_ROOT: "ghcr.io/hexafox-labs/brai-one",
    BRAI_AFFECTED_IMAGES: "web",
    BRAI_WEB_DIGEST: `sha256:${"f".repeat(64)}`,
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: revision,
  };
  execFileSync(process.execPath, [writer, outputPath, `--base=${basePath}`], {
    cwd: root,
    env: environment,
  });

  const output = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(output.source_revision, revision);
  assert.equal(output.images.web.digest, `sha256:${"f".repeat(64)}`);
  assert.deepEqual(output.images.access, baseImages.access);
});
