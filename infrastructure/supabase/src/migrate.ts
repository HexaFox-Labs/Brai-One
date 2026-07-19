import { Pool, type PoolClient } from "pg";

import { readMigrationConfig } from "./config.js";
import {
  BRAI_FACTORY_MIGRATION_FILE_PATTERN,
  defaultMigrationsDirectory,
  readMigrationFiles,
  type MigrationFile,
} from "./migration-files.js";

const MIGRATION_LOCK_NAME = "brai-new:brai-factory:migrations";

type AppliedMigrationRow = {
  version: string;
  checksum: string;
};

async function bootstrap(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS brai_factory;
    REVOKE ALL ON SCHEMA brai_factory FROM PUBLIC;
    CREATE TABLE IF NOT EXISTS brai_factory.schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    REVOKE ALL ON TABLE brai_factory.schema_migrations FROM PUBLIC;
  `);
}

async function loadAppliedMigrations(
  client: PoolClient,
): Promise<Map<string, string>> {
  const result = await client.query<AppliedMigrationRow>(`
    SELECT version, checksum
    FROM brai_factory.schema_migrations
    ORDER BY version ASC
  `);

  return new Map(result.rows.map((row) => [row.version, row.checksum]));
}

function verifyChecksum(
  migration: MigrationFile,
  appliedChecksum: string,
): void {
  if (migration.checksum !== appliedChecksum) {
    throw new Error(
      `Applied migration ${migration.version} has a different checksum`,
    );
  }
}

export async function runMigrations(pool: Pool): Promise<number> {
  const migrations = await readMigrationFiles(
    defaultMigrationsDirectory,
    BRAI_FACTORY_MIGRATION_FILE_PATTERN,
  );
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [MIGRATION_LOCK_NAME],
    );
    await bootstrap(client);

    const applied = await loadAppliedMigrations(client);
    let appliedCount = 0;

    for (const migration of migrations) {
      const appliedChecksum = applied.get(migration.version);

      if (appliedChecksum) {
        verifyChecksum(migration, appliedChecksum);
        continue;
      }

      await client.query(migration.sql);
      await client.query(
        `
          INSERT INTO brai_factory.schema_migrations (version, checksum)
          VALUES ($1, $2)
        `,
        [migration.version, migration.checksum],
      );
      appliedCount += 1;
    }

    await client.query("COMMIT");
    return appliedCount;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const config = readMigrationConfig();
  const pool = new Pool(config.pool);

  pool.on("error", () => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "migration_pool_error",
      }),
    );
  });

  try {
    const appliedCount = await runMigrations(pool);
    console.info(
      JSON.stringify({
        level: "info",
        event: "migrations_complete",
        applied_count: appliedCount,
      }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "migrations_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  process.exitCode = 1;
});
