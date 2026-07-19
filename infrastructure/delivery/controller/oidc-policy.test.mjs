import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizePreviewRelease,
  authorizePreviewStatus,
} from "./oidc-policy.mjs";

test("accepts cleanup from the dedicated closed-PR workflow without an action claim", () => {
  const claims = {
    repository: "HexaFox-Labs/Brai-One",
    repository_visibility: "public",
    workflow_ref:
      "HexaFox-Labs/Brai-One/.github/workflows/preview-cleanup.yml@refs/heads/dev",
    event_name: "pull_request",
    head_ref: "feature/closed",
  };
  assert.doesNotThrow(() => authorizePreviewRelease(claims, "feature/closed"));
  assert.throws(() =>
    authorizePreviewRelease(
      { ...claims, event_name: "pull_request_review" },
      "feature/closed",
    ),
  );
  assert.throws(() =>
    authorizePreviewRelease(
      { ...claims, head_ref: "feature/other" },
      "feature/closed",
    ),
  );
});

test("permits status lookup from the owner review workflow without an action claim", () => {
  const claims = {
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
  assert.throws(() =>
    authorizePreviewStatus({ ...claims, base_ref: "main" }, "feature/web-only"),
  );
  assert.throws(() =>
    authorizePreviewStatus(
      { ...claims, event_name: "pull_request" },
      "feature/web-only",
    ),
  );
});
