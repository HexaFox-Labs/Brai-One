import { createPublicKey, verify } from "node:crypto";

const issuer = "https://token.actions.githubusercontent.com";
const jwksUrl = `${issuer}/.well-known/jwks`;

/**
 * Verifies a short-lived GitHub Actions OIDC token without storing a GitHub
 * secret on the host. Only RS256 tokens from the issuer's rotating JWKS are
 * accepted.
 */
export class GitHubOidcVerifier {
  /** @param {{ audience: string; fetch?: typeof fetch; now?: () => number }} options */
  constructor(options) {
    this.audience = options.audience;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.cachedKeys = undefined;
  }

  /** @param {string} token */
  async verify(token) {
    if (typeof token !== "string" || token.length > 16_384) {
      throw new Error("OIDC token is invalid");
    }
    const [encodedHeader, encodedPayload, encodedSignature, ...extra] =
      token.split(".");
    if (
      !encodedHeader ||
      !encodedPayload ||
      !encodedSignature ||
      extra.length > 0
    ) {
      throw new Error("OIDC token is malformed");
    }
    const header = parseJson(encodedHeader, "OIDC token header");
    const claims = parseJson(encodedPayload, "OIDC token payload");
    if (header.alg !== "RS256" || typeof header.kid !== "string") {
      throw new Error("OIDC token algorithm is not allowed");
    }
    const key = await this.key(header.kid);
    const signature = decodeBase64url(encodedSignature, "OIDC token signature");
    const signed = Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8");
    if (
      !verify(
        "RSA-SHA256",
        signed,
        createPublicKey({ key, format: "jwk" }),
        signature,
      )
    ) {
      throw new Error("OIDC token signature is invalid");
    }
    assertClaims(claims, this.audience, this.now());
    return claims;
  }

  /** @param {string} kid */
  async key(kid) {
    if (!this.cachedKeys || this.cachedKeys.expiresAt <= Date.now()) {
      const response = await this.fetch(jwksUrl, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("GitHub OIDC JWKS is unavailable");
      const body = await response.json();
      if (!body || !Array.isArray(body.keys))
        throw new Error("GitHub OIDC JWKS is invalid");
      this.cachedKeys = {
        expiresAt: Date.now() + 5 * 60 * 1000,
        keys: body.keys,
      };
    }
    const key = this.cachedKeys.keys.find(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        entry.kid === kid &&
        entry.kty === "RSA" &&
        entry.use === "sig" &&
        entry.alg === "RS256",
    );
    if (!key) throw new Error("OIDC token key is not published by GitHub");
    return key;
  }
}

/** @param {Record<string, unknown>} claims @param {string} audience @param {number} now */
function assertClaims(claims, audience, now) {
  if (claims.iss !== issuer || !audienceMatches(claims.aud, audience)) {
    throw new Error("OIDC token issuer or audience is not allowed");
  }
  if (
    typeof claims.exp !== "number" ||
    typeof claims.nbf !== "number" ||
    typeof claims.iat !== "number" ||
    claims.exp <= now ||
    claims.nbf > now + 30 ||
    claims.iat > now + 30
  ) {
    throw new Error("OIDC token time window is invalid");
  }
}

/** @param {unknown} value @param {string} expected */
function audienceMatches(value, expected) {
  return (
    value === expected || (Array.isArray(value) && value.includes(expected))
  );
}

/** @param {string} source @param {string} name */
function parseJson(source, name) {
  try {
    const value = JSON.parse(decodeBase64url(source, name).toString("utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error();
    }
    return value;
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
}

/** @param {string} value @param {string} name */
function decodeBase64url(value, name) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error(`${name} is malformed`);
  return Buffer.from(value, "base64url");
}
