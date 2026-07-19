import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JSONWebKeySet,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  GatewayAuthenticationError,
  createGatewayAuthenticator,
} from "../src/auth.js";

const ISSUER = "https://auth.example.test/auth/v1";
const AUDIENCE = "authenticated";
const USER_ID = "85ea4b91-4a52-46c7-b6ee-5be478c84c2e";
const ADMIN_ID = "5f76ab51-1c32-4ceb-8258-8ba1d85e1ed8";
const ADMIN_SECRET = "a".repeat(64);

let resolver: ReturnType<typeof createLocalJWKSet>;
let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  const jwks: JSONWebKeySet = {
    keys: [{ ...jwk, alg: "ES256", kid: "access-test-key", use: "sig" }],
  };
  resolver = createLocalJWKSet(jwks);
});

function authenticator() {
  return createGatewayAuthenticator(
    {
      issuer: ISSUER,
      jwksUrl: `${ISSUER}/.well-known/jwks.json`,
      audience: AUDIENCE,
      platformAdminHeaderSecret: ADMIN_SECRET,
      platformAdminActorId: ADMIN_ID,
    },
    resolver,
  );
}

async function token(
  overrides: {
    issuer?: string;
    audience?: string;
    subject?: string;
    role?: string;
  } = {},
): Promise<string> {
  return new SignJWT({ role: overrides.role ?? "authenticated" })
    .setProtectedHeader({
      alg: "ES256",
      kid: "access-test-key",
      typ: "JWT",
    })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setSubject(overrides.subject ?? USER_ID)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

describe("Gateway authentication", () => {
  it("derives the user only from a verified Supabase JWT", async () => {
    const auth = authenticator();
    await expect(
      auth.authenticateUser(`Bearer ${await token()}`),
    ).resolves.toEqual({ userId: USER_ID });
  });

  it("rejects a wrong issuer, audience, role, malformed header and subject", async () => {
    const auth = authenticator();
    const attempts = [
      `Bearer ${await token({ issuer: "https://evil.example" })}`,
      `Bearer ${await token({ audience: "other" })}`,
      `Bearer ${await token({ role: "service_role" })}`,
      `Bearer ${await token({ subject: "not-a-uuid" })}`,
      "Basic dXNlcjpwYXNz",
      undefined,
    ];

    for (const attempt of attempts) {
      await expect(auth.authenticateUser(attempt)).rejects.toBeInstanceOf(
        GatewayAuthenticationError,
      );
    }
  });

  it("derives the platform admin actor from protected server config", () => {
    const auth = authenticator();
    expect(auth.authenticatePlatformAdmin(ADMIN_SECRET)).toEqual({
      actorUserId: ADMIN_ID,
    });
    expect(() => auth.authenticatePlatformAdmin("wrong")).toThrow(
      GatewayAuthenticationError,
    );
  });
});
