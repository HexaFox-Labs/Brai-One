import type { PoolConfig } from "pg";
import { z } from "zod";

import { requireEnv } from "@brai/runtime";

const sslModeSchema = z
  .enum(["disable", "require", "verify-full"])
  .default("disable");

const environmentSchema = z.object({
  BRAI_ACCESS_DATABASE_URL: z.string().min(1),
  BRAI_ACCESS_DATABASE_SSL: sslModeSchema,
  BRAI_ACCESS_DATABASE_POOL_MAX: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(10),
  BRAI_ACCESS_DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(10_000)
    .default(3_000),
  BRAI_ACCESS_DATABASE_QUERY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(4_000)
    .default(4_000),
});

const serviceEnvironmentSchema = environmentSchema.extend({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  NATS_SERVERS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((server) => server.trim())
        .filter(Boolean),
    )
    .refine(
      (servers) => servers.length > 0,
      "Укажите хотя бы один NATS server",
    ),
  NATS_USER: z.string().min(1),
  NATS_PASSWORD: z.string().min(1),
  NATS_INBOX_PREFIX: z.string().min(1).default("_INBOX.brai.access"),
  NATS_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30_000)
    .default(30_000),
  BRAI_RUNTIME_LAUNCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(180_000)
    .default(90_000),
  BRAI_ACCESS_LAUNCH_SIGNING_KEY_ID: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  BRAI_ACCESS_LAUNCH_SIGNING_PRIVATE_KEY_BASE64: z
    .string()
    .min(64)
    .max(16_384)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
  BRAI_ACCESS_LAUNCH_CONTRACT_LIFETIME_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(5 * 60 * 1_000)
    .default(2 * 60 * 1_000),
  BRAI_RUNTIME_RECEIPT_SIGNING_KEY_ID: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u),
  BRAI_RUNTIME_RECEIPT_SIGNING_PUBLIC_KEY_BASE64: z
    .string()
    .min(64)
    .max(16_384)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
  LOG_LEVEL: z.string().min(1).default("info"),
});

const migrationEnvironmentSchema = z.object({
  BRAI_ACCESS_MIGRATION_DATABASE_URL: z.string().min(1),
  BRAI_ACCESS_MIGRATION_DATABASE_SSL: sslModeSchema,
});

const bootstrapEnvironmentSchema = z.object({
  BRAI_ACCESS_BOOTSTRAP_DATABASE_URL: z.string().min(1),
  BRAI_ACCESS_BOOTSTRAP_DATABASE_SSL: sslModeSchema,
});

const runtimePasswordEnvironmentSchema = z.object({
  BRAI_ACCESS_RUNTIME_DATABASE_PASSWORD: z.string().min(24),
});

const migratorPasswordEnvironmentSchema = z.object({
  BRAI_ACCESS_MIGRATOR_DATABASE_PASSWORD: z.string().min(24),
});

export type AccessConfig = Readonly<{
  database: PoolConfig;
}>;

export type AccessServiceConfig = AccessConfig &
  Readonly<{
    nodeEnv: "development" | "test" | "production";
    logLevel: string;
    nats: Readonly<{
      servers: string[];
      user: string;
      pass: string;
      name: string;
      inboxPrefix: string;
    }>;
    natsRequestTimeoutMs: number;
    runtimeLaunchTimeoutMs: number;
    launchSigning: Readonly<{
      keyId: string;
      privateKeyPem: string;
      lifetimeMs: number;
    }>;
    receiptVerification: Readonly<{
      keyId: string;
      publicKeyPem: string;
    }>;
  }>;

export type AccessMigrationConfig = Readonly<{
  database: PoolConfig;
}>;

export type AccessBootstrapConfig = Readonly<{
  database: PoolConfig;
}>;

function databaseSsl(mode: z.infer<typeof sslModeSchema>): PoolConfig["ssl"] {
  if (mode === "disable") {
    return false;
  }

  return { rejectUnauthorized: mode === "verify-full" };
}

export function readAccessConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AccessConfig {
  const parsed = requireEnv(environmentSchema, environment);

  return {
    database: {
      application_name: "brai-access",
      connectionString: parsed.BRAI_ACCESS_DATABASE_URL,
      connectionTimeoutMillis:
        parsed.BRAI_ACCESS_DATABASE_CONNECTION_TIMEOUT_MS,
      max: parsed.BRAI_ACCESS_DATABASE_POOL_MAX,
      query_timeout: parsed.BRAI_ACCESS_DATABASE_QUERY_TIMEOUT_MS,
      statement_timeout: parsed.BRAI_ACCESS_DATABASE_QUERY_TIMEOUT_MS,
      ssl: databaseSsl(parsed.BRAI_ACCESS_DATABASE_SSL),
    },
  };
}

function decodePrivateKey(base64: string): string {
  const decoded = Buffer.from(base64, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== base64) {
    throw new Error(
      "BRAI_ACCESS_LAUNCH_SIGNING_PRIVATE_KEY_BASE64 is not canonical base64",
    );
  }
  const pem = decoded.toString("utf8");
  if (
    !pem.startsWith("-----BEGIN PRIVATE KEY-----\n") ||
    !pem.endsWith("-----END PRIVATE KEY-----\n")
  ) {
    throw new Error("Launch signing key must be a PKCS#8 PEM");
  }
  return pem;
}

function decodePublicKey(base64: string): string {
  const decoded = Buffer.from(base64, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== base64) {
    throw new Error(
      "BRAI_RUNTIME_RECEIPT_SIGNING_PUBLIC_KEY_BASE64 is not canonical base64",
    );
  }
  const pem = decoded.toString("utf8");
  if (
    !pem.startsWith("-----BEGIN PUBLIC KEY-----\n") ||
    !pem.endsWith("-----END PUBLIC KEY-----\n")
  ) {
    throw new Error("Runtime receipt verification key must be a public PEM");
  }
  return pem;
}

export function readAccessServiceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AccessServiceConfig {
  const parsed = requireEnv(serviceEnvironmentSchema, environment);
  const database = readAccessConfig(environment).database;
  return {
    database,
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    nats: {
      servers: parsed.NATS_SERVERS,
      user: parsed.NATS_USER,
      pass: parsed.NATS_PASSWORD,
      name: "brai-access",
      inboxPrefix: parsed.NATS_INBOX_PREFIX,
    },
    natsRequestTimeoutMs: parsed.NATS_REQUEST_TIMEOUT_MS,
    runtimeLaunchTimeoutMs: parsed.BRAI_RUNTIME_LAUNCH_TIMEOUT_MS,
    launchSigning: {
      keyId: parsed.BRAI_ACCESS_LAUNCH_SIGNING_KEY_ID,
      privateKeyPem: decodePrivateKey(
        parsed.BRAI_ACCESS_LAUNCH_SIGNING_PRIVATE_KEY_BASE64,
      ),
      lifetimeMs: parsed.BRAI_ACCESS_LAUNCH_CONTRACT_LIFETIME_MS,
    },
    receiptVerification: {
      keyId: parsed.BRAI_RUNTIME_RECEIPT_SIGNING_KEY_ID,
      publicKeyPem: decodePublicKey(
        parsed.BRAI_RUNTIME_RECEIPT_SIGNING_PUBLIC_KEY_BASE64,
      ),
    },
  };
}

export function readAccessMigrationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AccessMigrationConfig {
  const parsed = requireEnv(migrationEnvironmentSchema, environment);
  return {
    database: {
      application_name: "brai-access-role-admin",
      connectionString: parsed.BRAI_ACCESS_MIGRATION_DATABASE_URL,
      max: 1,
      ssl: databaseSsl(parsed.BRAI_ACCESS_MIGRATION_DATABASE_SSL),
    },
  };
}

export function readAccessBootstrapConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AccessBootstrapConfig {
  const parsed = requireEnv(bootstrapEnvironmentSchema, environment);
  return {
    database: {
      application_name: "brai-access-role-bootstrap",
      connectionString: parsed.BRAI_ACCESS_BOOTSTRAP_DATABASE_URL,
      max: 1,
      ssl: databaseSsl(parsed.BRAI_ACCESS_BOOTSTRAP_DATABASE_SSL),
    },
  };
}

export function readAccessRuntimePassword(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return requireEnv(runtimePasswordEnvironmentSchema, environment)
    .BRAI_ACCESS_RUNTIME_DATABASE_PASSWORD;
}

export function readAccessMigratorPassword(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return requireEnv(migratorPasswordEnvironmentSchema, environment)
    .BRAI_ACCESS_MIGRATOR_DATABASE_PASSWORD;
}
