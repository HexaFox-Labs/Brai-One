import type { PoolConfig } from "pg";

const SSL_MODES = ["disable", "require", "verify-full"] as const;

type SslMode = (typeof SSL_MODES)[number];

export type MigrationConfig = {
  pool: PoolConfig;
};

function requireNonEmpty(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function parseSslMode(value: string | undefined): SslMode {
  const mode = value?.trim() || "disable";

  if (!SSL_MODES.includes(mode as SslMode)) {
    throw new Error(
      `BRAI_FACTORY_MIGRATION_DATABASE_SSL must be one of: ${SSL_MODES.join(", ")}`,
    );
  }

  return mode as SslMode;
}

function sslConfig(mode: SslMode): PoolConfig["ssl"] {
  if (mode === "disable") {
    return false;
  }

  return {
    rejectUnauthorized: mode === "verify-full",
  };
}

export function readMigrationConfig(
  env: NodeJS.ProcessEnv = process.env,
): MigrationConfig {
  const connectionString = requireNonEmpty(
    env,
    "BRAI_FACTORY_MIGRATION_DATABASE_URL",
  );
  const mode = parseSslMode(env.BRAI_FACTORY_MIGRATION_DATABASE_SSL);

  return {
    pool: {
      application_name: "brai-factory-migrations",
      connectionString,
      max: 1,
      ssl: sslConfig(mode),
    },
  };
}

export function readRuntimeRolePassword(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const password = requireNonEmpty(
    env,
    "BRAI_FACTORY_RUNTIME_DATABASE_PASSWORD",
  );

  if (password.length < 24) {
    throw new Error(
      "BRAI_FACTORY_RUNTIME_DATABASE_PASSWORD must contain at least 24 characters",
    );
  }

  return password;
}
