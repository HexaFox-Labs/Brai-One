import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ControllerState } from "./controller-state.mjs";
import { imageNames } from "./constants.mjs";
import { DeliveryController } from "./delivery-controller.mjs";

const digest = (letter) => `sha256:${letter.repeat(64)}`;
const revision = (letter) => letter.repeat(40);
const fullImages = Object.fromEntries(
  imageNames.map((name) => [name, digest("a")]),
);

function request(overrides = {}) {
  return {
    schema_version: "brai.delivery.request.v1",
    source_repository: "HexaFox-Labs/Brai-One",
    source_revision: revision("a"),
    branch: "dev",
    target: "dev",
    priority: "normal",
    runtime_services: ["@brai/web"],
    changed_images: fullImages,
    ...overrides,
  };
}

async function controller(runtimeOverrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "brai-controller-"));
  const runtime = {
    cleanup: async () => undefined,
    deploy: async () => undefined,
    hostFreeBytes: async () => 30 * 1024 ** 3,
    snapshot: async () => ({ accepted: true }),
    ...runtimeOverrides,
  };
  return new DeliveryController({
    state: new ControllerState(root),
    runtime,
    now: () => "2026-07-19T15:00:00.000Z",
  });
}

test("dev saves a full manifest and a preview reuses all untouched image digests", async () => {
  const deployed = [];
  const instance = await controller({
    deploy: async (input) => deployed.push(input),
  });
  await instance.submit(request());
  const preview = await instance.submit(
    request({
      branch: "feature/web-only",
      changed_images: { web: digest("b") },
      source_revision: revision("b"),
      target: "preview",
    }),
  );
  assert.equal(preview.revision, revision("b"));
  assert.equal(preview.slot, "p01");
  assert.equal(preview.state, "deployed");
  assert.equal(preview.target, "preview");
  assert.equal(preview.url, "https://preview-01.brai.one");
  assert.equal(preview.manifest.revision, revision("b"));
  assert.equal(deployed[1]?.manifest.images.access.includes(digest("a")), true);
  assert.equal(deployed[1]?.manifest.images.web.includes(digest("b")), true);
});

test("a failed newer preview leaves its recorded green manifest intact", async () => {
  let fail = false;
  const instance = await controller({
    deploy: async () => {
      if (fail) throw new Error("unhealthy image");
    },
  });
  await instance.submit(request());
  await instance.submit(
    request({
      branch: "feature/web-only",
      changed_images: { web: digest("b") },
      source_revision: revision("b"),
      target: "preview",
    }),
  );
  fail = true;
  await assert.rejects(() =>
    instance.submit(
      request({
        branch: "feature/web-only",
        changed_images: { web: digest("c") },
        source_revision: revision("c"),
        target: "preview",
      }),
    ),
  );
  const state = await instance.state.readPreviewManifest(1);
  assert.equal(state.revision, revision("b"));
});

test("reports only the deployed revision for branch acceptance", async () => {
  const instance = await controller();
  assert.deepEqual(await instance.previewStatus("feature/web-only"), {
    state: "absent",
  });
  await instance.submit(request());
  await instance.submit(
    request({
      branch: "feature/web-only",
      changed_images: { web: digest("b") },
      source_revision: revision("b"),
      target: "preview",
    }),
  );
  assert.deepEqual(await instance.previewStatus("feature/web-only"), {
    revision: revision("b"),
    slot: "p01",
    state: "deployed",
  });
});
