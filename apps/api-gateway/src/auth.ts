import { timingSafeEqual } from "node:crypto";

import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
import { z } from "zod";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const userIdSchema = z.string().regex(UUID_V4_PATTERN);
const MAX_AUTHORIZATION_HEADER_BYTES = 8_192;
const ADMIN_HEADER_NAME = "x-brai-platform-admin";

export type AuthenticatedUser = Readonly<{
  userId: string;
}>;

export type AuthenticatedPlatformAdmin = Readonly<{
  actorUserId: string;
}>;

export interface GatewayAuthenticator {
  authenticateUser(
    authorizationHeader: string | undefined,
  ): Promise<AuthenticatedUser>;
  authenticatePlatformAdmin(
    adminHeader: string | undefined,
  ): AuthenticatedPlatformAdmin;
}

export type GatewayAuthOptions = Readonly<{
  issuer: string;
  jwksUrl: string;
  audience: string;
  platformAdminHeaderSecret: string;
  platformAdminActorId: string;
}>;

export class GatewayAuthenticationError extends Error {
  public readonly code = "authentication_required";

  public constructor() {
    super("Authentication failed");
    this.name = "GatewayAuthenticationError";
  }
}

function bearerToken(header: string | undefined): string {
  if (
    header === undefined ||
    Buffer.byteLength(header, "utf8") > MAX_AUTHORIZATION_HEADER_BYTES
  ) {
    throw new GatewayAuthenticationError();
  }

  const match = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(header);
  if (!match?.[1]) {
    throw new GatewayAuthenticationError();
  }
  return match[1];
}

function equalSecret(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function authenticatedSubject(payload: JWTPayload): AuthenticatedUser {
  const parsed = userIdSchema.safeParse(payload.sub);
  if (!parsed.success || payload.role !== "authenticated") {
    throw new GatewayAuthenticationError();
  }
  return Object.freeze({ userId: parsed.data });
}

export function createGatewayAuthenticator(
  options: GatewayAuthOptions,
  keyResolver?: JWTVerifyGetKey,
): GatewayAuthenticator {
  const resolver =
    keyResolver ??
    createRemoteJWKSet(new URL(options.jwksUrl), {
      timeoutDuration: 3_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });

  return {
    authenticateUser: async (authorizationHeader) => {
      try {
        const verified = await jwtVerify(
          bearerToken(authorizationHeader),
          resolver,
          {
            algorithms: ["ES256"],
            issuer: options.issuer,
            audience: options.audience,
            requiredClaims: ["sub", "iat", "exp"],
            clockTolerance: 5,
          },
        );
        return authenticatedSubject(verified.payload);
      } catch {
        throw new GatewayAuthenticationError();
      }
    },
    authenticatePlatformAdmin: (adminHeader) => {
      if (!equalSecret(adminHeader, options.platformAdminHeaderSecret)) {
        throw new GatewayAuthenticationError();
      }
      return Object.freeze({
        actorUserId: options.platformAdminActorId,
      });
    },
  };
}

export const PLATFORM_ADMIN_HEADER = ADMIN_HEADER_NAME;
