import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { GitHubOidcVerifier } from "./github-oidc.mjs";
import { authorizeDelivery } from "./oidc-policy.mjs";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = keys.publicKey.export({ format: "jwk" });
const now = 1_784_388_800;

function token(claims) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    keys.privateKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function claims(overrides = {}) {
  return {
    iss: "https://token.actions.githubusercontent.com",
    aud: "brai-delivery",
    exp: now + 300,
    nbf: now - 10,
    iat: now - 10,
    repository: "HexaFox-Labs/Brai-One",
    repository_visibility: "public",
    workflow_ref:
      "HexaFox-Labs/Brai-One/.github/workflows/delivery.yml@refs/heads/dev",
    event_name: "push",
    ref: "refs/heads/dev",
    ...overrides,
  };
}

test("accepts a signed GitHub token only for its exact dev delivery scope", async () => {
  const verifier = new GitHubOidcVerifier({
    audience: "brai-delivery",
    now: () => now,
    fetch: async () =>
      new Response(
        JSON.stringify({
          keys: [{ ...publicJwk, kid: "test-key", use: "sig", alg: "RS256" }],
        }),
      ),
  });
  const verified = await verifier.verify(token(claims()));
  assert.doesNotThrow(() =>
    authorizeDelivery(verified, { target: "dev", branch: "dev" }),
  );
  assert.throws(() =>
    authorizeDelivery(verified, {
      target: "preview",
      branch: "feature/not-dev",
    }),
  );
});
