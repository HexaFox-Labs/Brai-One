import { requireEnv } from "@brai/runtime";
import { z } from "zod";

const booleanFromEnvironment = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const gatewayEnvironmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .optional()
      .default("production"),
    GATEWAY_HOST: z.string().min(1).optional().default("0.0.0.0"),
    GATEWAY_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .optional()
      .default(3_201),
    LOG_LEVEL: z.string().min(1).optional().default("info"),
    NATS_SERVERS: z.string().min(1),
    NATS_USER: z.string().min(1),
    NATS_PASSWORD: z.string().min(1),
    NATS_INBOX_PREFIX: z
      .string()
      .min(1)
      .optional()
      .default("_INBOX.brai.gateway"),
    NATS_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(30_000)
      .optional()
      .default(30_000),
    PUBLIC_ORIGINS: z.string().min(1),
    ALLOW_LOOPBACK_HOSTS: booleanFromEnvironment.optional().default(true),
    ACCESS_API_ENABLED: booleanFromEnvironment.optional().default(false),
    SUPABASE_AUTH_ISSUER: z.string().url().optional(),
    SUPABASE_AUTH_JWKS_URL: z.string().url().optional(),
    SUPABASE_AUTH_AUDIENCE: z
      .string()
      .min(1)
      .optional()
      .default("authenticated"),
    PLATFORM_ADMIN_HEADER_SECRET: z.string().min(32).optional(),
    PLATFORM_ADMIN_ACTOR_ID: z.string().uuid().optional(),
  })
  .superRefine((value, context) => {
    if (!value.ACCESS_API_ENABLED) return;

    for (const key of [
      "SUPABASE_AUTH_ISSUER",
      "SUPABASE_AUTH_JWKS_URL",
      "PLATFORM_ADMIN_HEADER_SECRET",
      "PLATFORM_ADMIN_ACTOR_ID",
    ] as const) {
      if (value[key] === undefined) {
        context.addIssue({
          code: "custom",
          message: `${key} обязателен при ACCESS_API_ENABLED=true`,
          path: [key],
        });
      }
    }
  });

type ParsedGatewayEnvironment = z.output<typeof gatewayEnvironmentSchema>;

export interface GatewayConfig {
  nodeEnv: ParsedGatewayEnvironment["NODE_ENV"];
  host: string;
  port: number;
  logLevel: string;
  natsServers: string[];
  natsUser: string;
  natsPassword: string;
  natsInboxPrefix: string;
  natsRequestTimeoutMs: number;
  publicOrigins: string[];
  allowLoopbackHosts: boolean;
  accessAuth: {
    issuer: string;
    jwksUrl: string;
    audience: string;
    platformAdminHeaderSecret: string;
    platformAdminActorId: string;
  } | null;
}

function parseCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function normalizeOrigins(value: string): string[] {
  const origins = parseCommaSeparated(value).map((origin) => {
    const parsed = new URL(origin);

    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error(
        `PUBLIC_ORIGINS содержит не origin, а полный URL: ${origin}`,
      );
    }

    return parsed.origin;
  });

  if (origins.length === 0) {
    throw new Error("PUBLIC_ORIGINS не содержит ни одного origin");
  }

  return [...new Set(origins)];
}

export function loadGatewayConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const parsed = requireEnv(gatewayEnvironmentSchema, environment);
  const natsServers = parseCommaSeparated(parsed.NATS_SERVERS);

  if (natsServers.length === 0) {
    throw new Error("NATS_SERVERS не содержит ни одного адреса");
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.GATEWAY_HOST,
    port: parsed.GATEWAY_PORT,
    logLevel: parsed.LOG_LEVEL,
    natsServers,
    natsUser: parsed.NATS_USER,
    natsPassword: parsed.NATS_PASSWORD,
    natsInboxPrefix: parsed.NATS_INBOX_PREFIX,
    natsRequestTimeoutMs: parsed.NATS_REQUEST_TIMEOUT_MS,
    publicOrigins: normalizeOrigins(parsed.PUBLIC_ORIGINS),
    allowLoopbackHosts: parsed.ALLOW_LOOPBACK_HOSTS,
    accessAuth: parsed.ACCESS_API_ENABLED
      ? {
          issuer: parsed.SUPABASE_AUTH_ISSUER!,
          jwksUrl: parsed.SUPABASE_AUTH_JWKS_URL!,
          audience: parsed.SUPABASE_AUTH_AUDIENCE,
          platformAdminHeaderSecret: parsed.PLATFORM_ADMIN_HEADER_SECRET!,
          platformAdminActorId: parsed.PLATFORM_ADMIN_ACTOR_ID!,
        }
      : null,
  };
}
