import type { PoolConfig } from "pg";
import { z } from "zod";

import { requireEnv } from "@brai/runtime";

const sslModeSchema = z
  .enum(["disable", "require", "verify-full"])
  .default("disable");

const environmentSchema = z.object({
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
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: sslModeSchema,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(10_000)
    .default(3_000),
  DATABASE_QUERY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(4_500)
    .default(4_000),
  LOG_LEVEL: z.string().min(1).default("info"),
});

export type FactoryConfig = {
  database: PoolConfig;
  logLevel: string;
  nats: {
    servers: string[];
    user: string;
    pass: string;
    name: string;
  };
};

function databaseSsl(mode: z.infer<typeof sslModeSchema>): PoolConfig["ssl"] {
  if (mode === "disable") {
    return false;
  }

  return {
    rejectUnauthorized: mode === "verify-full",
  };
}

export function readFactoryConfig(
  environment: NodeJS.ProcessEnv = process.env,
): FactoryConfig {
  const parsed = requireEnv(environmentSchema, environment);

  return {
    database: {
      application_name: "brai-factory",
      connectionTimeoutMillis: parsed.DATABASE_CONNECTION_TIMEOUT_MS,
      connectionString: parsed.DATABASE_URL,
      max: parsed.DATABASE_POOL_MAX,
      query_timeout: parsed.DATABASE_QUERY_TIMEOUT_MS,
      ssl: databaseSsl(parsed.DATABASE_SSL),
      statement_timeout: parsed.DATABASE_QUERY_TIMEOUT_MS,
    },
    logLevel: parsed.LOG_LEVEL,
    nats: {
      name: "brai-factory",
      pass: parsed.NATS_PASSWORD,
      servers: parsed.NATS_SERVERS,
      user: parsed.NATS_USER,
    },
  };
}
