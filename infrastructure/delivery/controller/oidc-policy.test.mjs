import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizePreviewRelease,
  authorizePreviewStatus,
} from "./oidc-policy.mjs";

test("accepts cleanup only from the dedicated closed-PR workflow", () => {
  const claims = {
    repository: "HexaFox-Labs/Brai-One",
    repository_visibility: "public",
    workflow_ref:
      "HexaFox-Labs/Brai-One/.github/workflows/preview-cleanup.yml@refs/heads/dev",
    event_name: "pull_request",
    action: "closed",
    head_ref: "feature/closed",
  };
  assert.doesNotThrow(() => authorizePreviewRelease(claims, "feature/closed"));
  assert.throws(() =>
    authorizePreviewRelease({ ...claims, action: "opened" }, "feature/closed"),
  );
});

test("permits status lookup only from the owner review workflow", () => {
  const claims = {
    action: "submitted",
    base_ref: "dev",
    event_name: "pull_request_review",
    head_ref: "feature/web-only",
    repository: "HexaFox-Labs/Brai-One",
    repository_visibility: "public",
    workflow_ref:
      "HexaFox-Labs/Brai-One/.github/workflows/enable-runtime-automerge.yml@refs/heads/main",
  };
  assert.doesNotThrow(() => authorizePreviewStatus(claims, "feature/web-only"));
  assert.throws(() => authorizePreviewStatus(claims, "feature/other"));
});
