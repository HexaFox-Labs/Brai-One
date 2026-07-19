import assert from "node:assert/strict";
import test from "node:test";

import { imageNames } from "./constants.mjs";
import {
  createRuntimeSecrets,
  renderRuntimeConfiguration,
} from "./runtime-config.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const images = Object.fromEntries(
  imageNames.map((name) => [
    name,
    `ghcr.io/hexaf0x-labs/brai-one/brai-${name}@${digest}`,
  ]),
);

test("renders isolated preview names, loopback ports and no production database URL", () => {
  const rendered = renderRuntimeConfiguration({
    prefix: "p07",
    slot: 7,
    images,
    secrets: createRuntimeSecrets(),
  });
  assert.match(rendered.compose, /^BRAI_PREFIX=p07$/mu);
  assert.match(rendered.compose, /^BRAI_WEB_PORT=3417$/mu);
  assert.match(rendered.compose, /^BRAI_GATEWAY_PORT=3517$/mu);
  assert.match(
    rendered.gateway,
    /PUBLIC_ORIGINS=https:\/\/preview-07\.brai\.one/u,
  );
  assert.doesNotMatch(rendered.factory, /supabase-db|157\.254/u);
});
