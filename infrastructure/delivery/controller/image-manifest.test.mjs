import assert from "node:assert/strict";
import test from "node:test";

import { imageNames } from "./constants.mjs";
import { overlayManifest } from "./image-manifest.mjs";

const revision = "a".repeat(40);
const digest = (letter) => `sha256:${letter.repeat(64)}`;

test("requires every image only for the first environment manifest", () => {
  assert.throws(() =>
    overlayManifest(undefined, { web: digest("b") }, revision),
  );
  const initial = overlayManifest(
    undefined,
    Object.fromEntries(imageNames.map((name) => [name, digest("b")])),
    revision,
  );
  const next = overlayManifest(
    initial.images,
    { web: digest("c") },
    "c".repeat(40),
  );
  assert.match(next.images.web, /@sha256:c{64}$/u);
  assert.equal(next.images.access, initial.images.access);
});
