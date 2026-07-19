import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDeliveryRequest,
  parsePreviewReleaseRequest,
} from "./request-policy.mjs";

const revision = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;

function request(overrides = {}) {
  return {
    schema_version: "brai.delivery.request.v1",
    source_repository: "HexaFox-Labs/Brai-One",
    source_revision: revision,
    branch: "feature/fast-preview",
    target: "preview",
    priority: "normal",
    runtime_services: ["@brai/web"],
    changed_images: { web: digest },
    ...overrides,
  };
}

test("accepts only exact repository digest requests", () => {
  const parsed = parseDeliveryRequest(request());
  assert.equal(parsed.changedImages.web, digest);
  assert.deepEqual(parsed.runtimeServices, ["@brai/web"]);
});

test("rejects arbitrary fields, tags and branch-target escalation", () => {
  assert.throws(() =>
    parseDeliveryRequest({ ...request(), command: "rm -rf" }),
  );
  assert.throws(() =>
    parseDeliveryRequest(request({ changed_images: { web: "latest" } })),
  );
  assert.throws(() => parseDeliveryRequest(request({ target: "dev" })));
  assert.throws(() => parseDeliveryRequest(request({ priority: "release" })));
});

test("accepts only a minimal close event payload", () => {
  assert.deepEqual(
    parsePreviewReleaseRequest({
      schema_version: "brai.delivery.request.v1",
      operation: "release",
      source_repository: "HexaFox-Labs/Brai-One",
      branch: "fix/small-bug",
    }),
    { branch: "fix/small-bug" },
  );
  assert.throws(() => parsePreviewReleaseRequest({ operation: "release" }));
});
