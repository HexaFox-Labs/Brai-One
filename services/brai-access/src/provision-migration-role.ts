import { Pool } from "pg";

import {
  ACCESS_MIGRATOR_ROLE,
  assertAccessMigratorRoleIsolation,
} from "./audit-migration-role.js";
import {
  readAccessBootstrapConfig,
  readAccessMigratorPassword,
} from "./config.js";

const PROVISION_LOCK = "brai-new:brai-access:migrator-provision";

type FormattedStatementRow = { statement: string };

async function main(): Promise<void> {
  const config = readAccessBootstrapConfig();
  const password = readAccessMigratorPassword();
  const pool = new Pool(config.database);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [PROVISION_LOCK],
    );

    const roleExists = await client.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1
        ) AS exists
      `,
      [ACCESS_MIGRATOR_ROLE],
    );
    if (!roleExists.rows[0]?.exists) {
      throw new Error(
        "brai_access_migrator does not exist; bootstrap it first",
      );
    }

    await client.query("SET LOCAL password_encryption = 'scram-sha-256'");
    const formatted = await client.query<FormattedStatementRow>(
      `
        SELECT format(
          'ALTER ROLE %I LOGIN PASSWORD %L CONNECTION LIMIT 1 VALID UNTIL %L',
          $1::text,
          $2::text,
          'infinity'
        ) AS statement
      `,
      [ACCESS_MIGRATOR_ROLE, password],
    );
    const statement = formatted.rows[0]?.statement;
    if (!statement) {
      throw new Error("PostgreSQL did not produce a safe role statement");
    }

    await client.query(statement);
    await assertAccessMigratorRoleIsolation(client, true);
    await client.query("COMMIT");
    console.info(
      JSON.stringify({
        event: "brai_access_migrator_role_provisioned",
        level: "info",
        role: ACCESS_MIGRATOR_ROLE,
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "brai_access_migrator_role_provision_failed",
      level: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  process.exitCode = 1;
});
