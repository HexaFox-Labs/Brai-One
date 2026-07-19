import { Pool, type PoolClient } from "pg";

import { readAccessMigrationConfig } from "./config.js";
import {
  readAccessMigrationFiles,
  type AccessMigrationFile,
} from "./migration-files.js";

const ACCESS_MIGRATION_LOCK = "brai-new:brai-access:migrations";
const ACCESS_MIGRATOR_ROLE = "brai_access_migrator";

type AppliedMigrationRow = {
  version: string;
  checksum: string;
};

async function bootstrapAccessLedger(client: PoolClient): Promise<void> {
  const schema = await client.query<{ schema_name: string | null }>(
    "SELECT to_regnamespace('brai_access')::text AS schema_name",
  );
  if (schema.rows[0]?.schema_name === null) {
    await client.query("CREATE SCHEMA brai_access");
  }
  await client.query(`
    REVOKE ALL ON SCHEMA brai_access FROM PUBLIC;
    CREATE TABLE IF NOT EXISTS brai_access.schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    REVOKE ALL ON TABLE brai_access.schema_migrations FROM PUBLIC;
  `);
}

async function appliedAccessMigrations(
  client: PoolClient,
): Promise<Map<string, string>> {
  const result = await client.query<AppliedMigrationRow>(`
    SELECT version, checksum
    FROM brai_access.schema_migrations
    ORDER BY version ASC
  `);
  return new Map(result.rows.map((row) => [row.version, row.checksum]));
}

function assertAppliedChecksum(
  migration: AccessMigrationFile,
  appliedChecksum: string,
): void {
  if (migration.checksum !== appliedChecksum) {
    throw new Error(
      `Applied brai-access migration ${migration.version} has a different checksum`,
    );
  }
}

export async function runAccessMigrations(pool: Pool): Promise<number> {
  const migrations = await readAccessMigrationFiles();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [ACCESS_MIGRATION_LOCK],
    );
    await bootstrapAccessLedger(client);
    const applied = await appliedAccessMigrations(client);
    let appliedCount = 0;

    for (const migration of migrations) {
      const checksum = applied.get(migration.version);
      if (checksum !== undefined) {
        assertAppliedChecksum(migration, checksum);
        continue;
      }
      await client.query(migration.sql);
      await client.query(
        `
          INSERT INTO brai_access.schema_migrations (version, checksum)
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

export async function assertAccessMigrationConnectionRole(
  pool: Pool,
): Promise<void> {
  const client = await pool.connect();
  try {
    const result = await client.query<{
      current_role: string;
      session_role: string;
    }>(
      `
        SELECT
          current_user::text AS current_role,
          session_user::text AS session_role
      `,
    );
    const role = result.rows[0];
    if (
      role?.current_role !== ACCESS_MIGRATOR_ROLE ||
      role.session_role !== ACCESS_MIGRATOR_ROLE
    ) {
      throw new Error(
        "brai-access migrations require the dedicated brai_access_migrator login",
      );
    }
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const config = readAccessMigrationConfig();
  const pool = new Pool(config.database);
  pool.on("error", () => {
    console.error(
      JSON.stringify({
        event: "brai_access_migration_pool_error",
        level: "error",
      }),
    );
  });
  try {
    await assertAccessMigrationConnectionRole(pool);
    const count = await runAccessMigrations(pool);
    console.info(
      JSON.stringify({
        event: "brai_access_migrations_complete",
        level: "info",
        applied_count: count,
      }),
    );
  } finally {
    await pool.end();
  }
}

if (/migrate\.(?:js|ts)$/u.test(process.argv[1] ?? "")) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "brai_access_migrations_failed",
        level: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    process.exitCode = 1;
  });
}
