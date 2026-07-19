import assert from "node:assert/strict";
import test from "node:test";

import {
  assessPreviewAdmission,
  assessSnapshotSize,
} from "./storage-policy.mjs";

test("queues before deleting healthy resources when capacity is unavailable", () => {
  assert.deepEqual(
    assessPreviewAdmission({
      freeBytes: 30 * 1024 ** 3,
      active: 5,
      activeLimit: 5,
    }),
    { allowed: false, reason: "active-preview-capacity" },
  );
});

test("rejects an oversized dev snapshot before it reaches preview slots", () => {
  assert.deepEqual(assessSnapshotSize(201 * 1024 ** 2), {
    accepted: false,
    reason: "snapshot-hard-budget",
  });
});
