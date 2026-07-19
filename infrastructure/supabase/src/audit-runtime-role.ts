import { Pool, type PoolClient } from "pg";

import { readMigrationConfig } from "./config.js";

const RUNTIME_ROLE = "brai_factory_runtime";

type BooleanRow = {
  allowed: boolean;
};

type CountRow = {
  violation_count: string;
};

async function booleanCheck(
  client: PoolClient,
  query: string,
): Promise<boolean> {
  const result = await client.query<BooleanRow>(query, [RUNTIME_ROLE]);
  return result.rows[0]?.allowed === true;
}

async function violationCount(
  client: PoolClient,
  query: string,
): Promise<number> {
  const result = await client.query<CountRow>(query, [RUNTIME_ROLE]);
  return Number(result.rows[0]?.violation_count ?? "0");
}

export async function assertRuntimeRoleIsolation(
  client: PoolClient,
): Promise<void> {
  const violations: string[] = [];

  const safeAttributes = await booleanCheck(
    client,
    `
      SELECT (
        rolcanlogin
        AND NOT rolsuper
        AND NOT rolcreatedb
        AND NOT rolcreaterole
        AND NOT rolinherit
        AND NOT rolreplication
        AND NOT rolbypassrls
        AND rolconnlimit = 10
      ) AS allowed
      FROM pg_catalog.pg_roles
      WHERE rolname = $1
    `,
  );
  if (!safeAttributes) violations.push("unsafe_role_attributes");

  const boundedRoleSettings = await booleanCheck(
    client,
    `
      WITH configured AS (
        SELECT
          settings.setdatabase,
          option.option_name,
          option.option_value
        FROM pg_catalog.pg_db_role_setting AS settings
        CROSS JOIN LATERAL pg_catalog.pg_options_to_table(
          settings.setconfig
        ) AS option
        JOIN pg_catalog.pg_roles AS role
          ON role.oid = settings.setrole
        WHERE role.rolname = $1
          AND option.option_name IN (
            'statement_timeout',
            'lock_timeout',
            'idle_in_transaction_session_timeout'
          )
      )
      SELECT (
        (
          SELECT count(*)
          FROM configured
          WHERE setdatabase = 0
            AND option_name = 'statement_timeout'
            AND option_value = '4s'
        ) = 1
        AND (
          SELECT count(*)
          FROM configured
          WHERE setdatabase = 0
            AND option_name = 'lock_timeout'
            AND option_value = '2s'
        ) = 1
        AND (
          SELECT count(*)
          FROM configured
          WHERE setdatabase = 0
            AND option_name = 'idle_in_transaction_session_timeout'
            AND option_value = '5s'
        ) = 1
        AND NOT EXISTS (
          SELECT 1
          FROM configured
          WHERE setdatabase <> 0
        )
      ) AS allowed
    `,
  );
  if (!boundedRoleSettings) violations.push("invalid_role_timeouts");

  const noMemberships =
    (await violationCount(
      client,
      `
        SELECT count(*)::text AS violation_count
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS member
          ON member.oid = membership.member
        WHERE member.rolname = $1
      `,
    )) === 0;
  if (!noMemberships) violations.push("unexpected_role_membership");

  const databasePrivileges = await booleanCheck(
    client,
    `
      SELECT (
        has_database_privilege($1, current_database(), 'CONNECT')
        AND NOT has_database_privilege(
          $1,
          current_database(),
          'TEMPORARY'
        )
      ) AS allowed
    `,
  );
  if (!databasePrivileges) violations.push("unexpected_database_privileges");

  const ownSchemaPrivileges = await booleanCheck(
    client,
    `
      SELECT (
        has_schema_privilege($1, 'brai_factory', 'USAGE')
        AND NOT has_schema_privilege($1, 'brai_factory', 'CREATE')
      ) AS allowed
    `,
  );
  if (!ownSchemaPrivileges) violations.push("invalid_owned_schema_privileges");

  const pgNetIsDenied = await booleanCheck(
    client,
    `
      SELECT (
        to_regnamespace('net') IS NULL
        OR NOT has_schema_privilege($1, 'net', 'USAGE')
      ) AS allowed
    `,
  );
  if (!pgNetIsDenied) violations.push("pg_net_schema_access");

  const foreignSchemas = await violationCount(
    client,
    `
      SELECT count(*)::text AS violation_count
      FROM pg_catalog.pg_namespace
      WHERE nspname NOT LIKE 'pg_%'
        AND nspname <> 'information_schema'
        AND nspname <> 'brai_factory'
        AND has_schema_privilege($1, oid, 'USAGE')
    `,
  );
  if (foreignSchemas > 0) violations.push("foreign_schema_access");

  const activityPrivileges = await booleanCheck(
    client,
    `
      SELECT (
        has_table_privilege($1, 'brai_factory.activities', 'SELECT')
        AND has_table_privilege($1, 'brai_factory.activities', 'INSERT')
        AND NOT has_table_privilege($1, 'brai_factory.activities', 'UPDATE')
        AND NOT has_table_privilege($1, 'brai_factory.activities', 'DELETE')
        AND NOT has_table_privilege(
          $1,
          'brai_factory.schema_migrations',
          'SELECT'
        )
      ) AS allowed
    `,
  );
  if (!activityPrivileges) violations.push("invalid_activity_privileges");

  const foreignRelations = await violationCount(
    client,
    `
      SELECT count(*)::text AS violation_count
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND namespace.nspname NOT LIKE 'pg_%'
        AND namespace.nspname <> 'information_schema'
        AND namespace.nspname <> 'brai_factory'
        AND has_schema_privilege($1, namespace.oid, 'USAGE')
        AND (
          has_table_privilege($1, relation.oid, 'SELECT')
          OR has_table_privilege($1, relation.oid, 'INSERT')
          OR has_table_privilege($1, relation.oid, 'UPDATE')
          OR has_table_privilege($1, relation.oid, 'DELETE')
        )
    `,
  );
  if (foreignRelations > 0) violations.push("foreign_relation_access");

  const foreignSequences = await violationCount(
    client,
    `
      SELECT count(*)::text AS violation_count
      FROM pg_catalog.pg_class AS sequence
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = sequence.relnamespace
      WHERE sequence.relkind = 'S'
        AND namespace.nspname NOT LIKE 'pg_%'
        AND namespace.nspname <> 'information_schema'
        AND namespace.nspname <> 'brai_factory'
        AND has_schema_privilege($1, namespace.oid, 'USAGE')
        AND (
          has_sequence_privilege($1, sequence.oid, 'USAGE')
          OR has_sequence_privilege($1, sequence.oid, 'SELECT')
          OR has_sequence_privilege($1, sequence.oid, 'UPDATE')
        )
    `,
  );
  if (foreignSequences > 0) violations.push("foreign_sequence_access");

  const callableForeignRoutines = await violationCount(
    client,
    `
      SELECT count(*)::text AS violation_count
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname NOT LIKE 'pg_%'
        AND namespace.nspname <> 'information_schema'
        AND namespace.nspname <> 'brai_factory'
        AND has_schema_privilege($1, namespace.oid, 'USAGE')
        AND has_function_privilege($1, routine.oid, 'EXECUTE')
        AND routine.prorettype NOT IN (
          'trigger'::regtype,
          'event_trigger'::regtype
        )
    `,
  );
  if (callableForeignRoutines > 0) {
    violations.push("foreign_routine_access");
  }

  if (violations.length > 0) {
    throw new Error(
      `Runtime role isolation audit failed: ${violations.join(", ")}`,
    );
  }
}

async function main(): Promise<void> {
  const config = readMigrationConfig();
  const pool = new Pool({
    ...config.pool,
    application_name: "brai-factory-role-audit",
  });
  const client = await pool.connect();

  try {
    await assertRuntimeRoleIsolation(client);
    console.info(
      JSON.stringify({
        event: "runtime_role_audit_passed",
        level: "info",
        role: RUNTIME_ROLE,
      }),
    );
  } finally {
    client.release();
    await pool.end();
  }
}

if (/audit-runtime-role\.(?:js|ts)$/u.test(process.argv[1] ?? "")) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "runtime_role_audit_failed",
        level: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    process.exitCode = 1;
  });
}
