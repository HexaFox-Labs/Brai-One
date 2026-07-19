import { Pool } from "pg";

import { assertAccessRuntimeRoleIsolation } from "./audit-runtime-role.js";
import {
  readAccessBootstrapConfig,
  readAccessRuntimePassword,
} from "./config.js";

const RUNTIME_ROLE = "brai_access_runtime";
const ROLE_LOCK_NAME = "brai-new:brai-access:runtime-role";

type FormattedStatementRow = { statement: string };

async function main(): Promise<void> {
  const config = readAccessBootstrapConfig();
  const password = readAccessRuntimePassword();
  const pool = new Pool({
    ...config.database,
    application_name: "brai-access-role-provisioner",
  });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [ROLE_LOCK_NAME],
    );

    const roleExists = await client.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1
        ) AS exists
      `,
      [RUNTIME_ROLE],
    );
    if (!roleExists.rows[0]?.exists) {
      throw new Error(
        "brai_access_runtime does not exist; apply migrations first",
      );
    }

    await client.query("SET LOCAL password_encryption = 'scram-sha-256'");
    const formatted = await client.query<FormattedStatementRow>(
      `
        SELECT format(
          'ALTER ROLE %I LOGIN PASSWORD %L CONNECTION LIMIT 10 VALID UNTIL %L',
          $1::text,
          $2::text,
          'infinity'
        ) AS statement
      `,
      [RUNTIME_ROLE, password],
    );
    const statement = formatted.rows[0]?.statement;
    if (!statement) {
      throw new Error("PostgreSQL did not produce a safe role statement");
    }

    await client.query(statement);
    await assertAccessRuntimeRoleIsolation(client);
    await client.query("COMMIT");

    console.info(
      JSON.stringify({
        event: "brai_access_runtime_role_provisioned",
        level: "info",
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
      event: "brai_access_runtime_role_provision_failed",
      level: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  process.exitCode = 1;
});
