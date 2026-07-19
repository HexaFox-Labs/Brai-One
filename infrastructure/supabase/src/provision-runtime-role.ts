import { Pool } from "pg";

import { readMigrationConfig, readRuntimeRolePassword } from "./config.js";
import { assertRuntimeRoleIsolation } from "./audit-runtime-role.js";

const RUNTIME_ROLE = "brai_factory_runtime";
const ROLE_LOCK_NAME = "brai-new:brai-factory:runtime-role";

type FormattedStatementRow = {
  statement: string;
};

async function main(): Promise<void> {
  const config = readMigrationConfig();
  const password = readRuntimeRolePassword();
  const pool = new Pool({
    ...config.pool,
    application_name: "brai-factory-role-provisioner",
  });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [ROLE_LOCK_NAME],
    );

    const roleExists = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1) AS exists",
      [RUNTIME_ROLE],
    );

    if (!roleExists.rows[0]?.exists) {
      throw new Error(
        "Runtime role does not exist; apply database migrations first",
      );
    }

    const formatted = await client.query<FormattedStatementRow>(
      "SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS statement",
      [RUNTIME_ROLE, password],
    );
    const statement = formatted.rows[0]?.statement;

    if (!statement) {
      throw new Error("PostgreSQL did not produce a role statement");
    }

    await client.query(statement);
    await assertRuntimeRoleIsolation(client);
    await client.query("COMMIT");

    console.info(
      JSON.stringify({
        level: "info",
        event: "runtime_role_provisioned",
        role: RUNTIME_ROLE,
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
      level: "error",
      event: "runtime_role_provision_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  process.exitCode = 1;
});
