import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("bootstrap selects every immutable image exactly once", () => {
  const result = spawnSync(
    process.execPath,
    ["tools/ci/bootstrap-delivery-impact.mjs"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const impact = JSON.parse(result.stdout);
  assert.equal(impact.images.length, 7);
  assert.equal(new Set(impact.images).size, 7);
  assert.equal(impact.builds.length, 7);
  assert.equal(impact.requiresPreview, false);
});
