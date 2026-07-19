import { Pool } from "pg";

import { readAccessBootstrapConfig } from "./config.js";
import { runAccessMigrations } from "./migrate.js";

async function main(): Promise<void> {
  const config = readAccessBootstrapConfig();
  const pool = new Pool({
    ...config.database,
    application_name: "brai-access-one-time-foundation-bootstrap",
  });

  try {
    const client = await pool.connect();
    try {
      const authority = await client.query<{
        can_create_role: boolean;
        migrator_exists: boolean;
      }>(`
        SELECT
          COALESCE((
            SELECT role.rolcreaterole OR role.rolsuper
            FROM pg_catalog.pg_roles AS role
            WHERE role.rolname = current_user
          ), false) AS can_create_role,
          EXISTS (
            SELECT 1
            FROM pg_catalog.pg_roles
            WHERE rolname = 'brai_access_migrator'
          ) AS migrator_exists
      `);
      const row = authority.rows[0];
      if (!row?.can_create_role) {
        throw new Error(
          "one-time brai_access foundation bootstrap requires a protected PostgreSQL CREATEROLE bootstrap credential",
        );
      }
      if (row.migrator_exists) {
        throw new Error(
          "brai_access_migrator already exists; use the dedicated migration command",
        );
      }
    } finally {
      client.release();
    }

    const count = await runAccessMigrations(pool);
    console.info(
      JSON.stringify({
        event: "brai_access_foundation_bootstrap_complete",
        level: "info",
        applied_count: count,
      }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "brai_access_foundation_bootstrap_failed",
      level: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  process.exitCode = 1;
});
