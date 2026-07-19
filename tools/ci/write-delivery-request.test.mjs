import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("writes a constrained preview request using only published image digests", async () => {
  const root = await mkdtemp(join(tmpdir(), "brai-delivery-request-"));
  try {
    const digest = `sha256:${"a".repeat(64)}`;
    await writeFile(
      join(root, "impact.json"),
      JSON.stringify({ images: ["web"], runtimeServices: ["@brai/web"] }),
    );
    await writeFile(join(root, "web.digest"), `${digest}\n`);
    const result = spawnSync(
      process.execPath,
      [
        resolve("tools/ci/write-delivery-request.mjs"),
        `--impact=${join(root, "impact.json")}`,
        `--digest-dir=${root}`,
        "--target=preview",
        "--branch=feature/fast-preview",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REPOSITORY: "HexaFox-Labs/Brai-One",
          BRAI_DELIVERY_REVISION: "b".repeat(40),
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const request = JSON.parse(result.stdout);
    assert.equal(request.target, "preview");
    assert.equal(request.changed_images.web, digest);
    assert.equal(request.priority, "normal");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
