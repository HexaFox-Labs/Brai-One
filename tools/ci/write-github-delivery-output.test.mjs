import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("writes scalar and compact JSON GitHub outputs", () => {
  const result = spawnSync(
    process.execPath,
    ["tools/ci/write-github-delivery-output.mjs"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      input: JSON.stringify({
        deliveryClass: "runtime",
        requiresPreview: true,
        runtimeServices: ["@brai/web"],
        images: ["web"],
        builds: [
          { image: "web", context: ".", dockerfile: "apps/web/Dockerfile" },
        ],
      }),
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^delivery_class=runtime$/mu);
  assert.match(result.stdout, /^requires_preview=true$/mu);
  assert.match(result.stdout, /^images=\["web"\]$/mu);
  assert.match(result.stdout, /^requires_image_build=true$/mu);
});
