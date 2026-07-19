import { Pool, type PoolClient } from "pg";

import { readAccessBootstrapConfig } from "./config.js";

const RUNTIME_ROLE = "brai_access_runtime";

type BooleanRow = { allowed: boolean };
type CountRow = { violation_count: string };

async function booleanCheck(
  client: Pick<PoolClient, "query">,
  query: string,
): Promise<boolean> {
  const result = await client.query<BooleanRow>(query, [RUNTIME_ROLE]);
  return result.rows[0]?.allowed === true;
}

async function violationCount(
  client: Pick<PoolClient, "query">,
  query: string,
): Promise<number> {
  const result = await client.query<CountRow>(query, [RUNTIME_ROLE]);
  return Number(result.rows[0]?.violation_count ?? "0");
}

export async function assertAccessRuntimeRoleIsolation(
  client: Pick<PoolClient, "query">,
): Promise<void> {
  const violations: string[] = [];

  if (
    !(await booleanCheck(
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
        AND rolpassword LIKE 'SCRAM-SHA-256$%'
        AND (
          rolvaliduntil IS NULL
          OR rolvaliduntil = 'infinity'::timestamptz
        )
      ) AS allowed
      FROM pg_catalog.pg_authid
      WHERE rolname = $1
      `,
    ))
  ) {
    violations.push("unsafe_role_attributes");
  }

  if (
    !(await booleanCheck(
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
          (SELECT count(*) FROM configured
            WHERE setdatabase = 0
              AND option_name = 'statement_timeout'
              AND option_value = '4s') = 1
          AND (SELECT count(*) FROM configured
            WHERE setdatabase = 0
              AND option_name = 'lock_timeout'
              AND option_value = '2s') = 1
          AND (SELECT count(*) FROM configured
            WHERE setdatabase = 0
              AND option_name = 'idle_in_transaction_session_timeout'
              AND option_value = '5s') = 1
          AND NOT EXISTS (
            SELECT 1 FROM configured WHERE setdatabase <> 0
          )
        ) AS allowed
      `,
    ))
  ) {
    violations.push("invalid_role_timeouts");
  }

  if (
    (await violationCount(
      client,
      `
        SELECT count(*)::text AS violation_count
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS member
          ON member.oid = membership.member
        WHERE member.rolname = $1
      `,
    )) !== 0
  ) {
    violations.push("unexpected_role_membership");
  }

  if (
    !(await booleanCheck(
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
    ))
  ) {
    violations.push("unexpected_database_privileges");
  }

  if (
    !(await booleanCheck(
      client,
      `
        SELECT (
          has_schema_privilege($1, 'brai_access', 'USAGE')
          AND NOT has_schema_privilege($1, 'brai_access', 'CREATE')
          AND NOT has_schema_privilege($1, 'public', 'USAGE')
          AND (
            to_regnamespace('net') IS NULL
            OR NOT has_schema_privilege($1, 'net', 'USAGE')
          )
        ) AS allowed
      `,
    ))
  ) {
    violations.push("invalid_schema_privileges");
  }

  if (
    (await violationCount(
      client,
      `
        SELECT count(*)::text AS violation_count
        FROM pg_catalog.pg_namespace
        WHERE nspname NOT LIKE 'pg_%'
          AND nspname <> 'information_schema'
          AND nspname <> 'brai_access'
          AND has_schema_privilege($1, oid, 'USAGE')
      `,
    )) !== 0
  ) {
    violations.push("foreign_schema_access");
  }

  if (
    !(await booleanCheck(
      client,
      `
        WITH expected(relname, can_select, can_insert, can_update) AS (
          VALUES
            ('project_memberships', true, false, false),
            ('allocation_policies', true, false, false),
            ('user_environments', true, true, true),
            ('user_access_states', true, true, true),
            ('access_transitions', true, true, true),
            ('agent_runs', true, true, true),
            ('access_transition_runs', true, true, true)
        )
        SELECT bool_and(
          has_table_privilege(
            $1,
            format('brai_access.%I', relname),
            'SELECT'
          ) = can_select
          AND has_table_privilege(
            $1,
            format('brai_access.%I', relname),
            'INSERT'
          ) = can_insert
          AND has_table_privilege(
            $1,
            format('brai_access.%I', relname),
            'UPDATE'
          ) = can_update
          AND NOT has_table_privilege(
            $1,
            format('brai_access.%I', relname),
            'DELETE'
          )
          AND NOT has_table_privilege(
            $1,
            format('brai_access.%I', relname),
            'TRUNCATE'
          )
          AND NOT has_table_privilege(
            $1,
            format('brai_access.%I', relname),
            'REFERENCES'
          )
          AND NOT has_table_privilege(
            $1,
            format('brai_access.%I', relname),
            'TRIGGER'
          )
        ) AS allowed
        FROM expected
      `,
    ))
  ) {
    violations.push("invalid_table_privileges");
  }

  if (
    (await violationCount(
      client,
      `
        SELECT count(*)::text AS violation_count
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
          AND namespace.nspname = 'brai_access'
          AND relation.relname NOT IN (
            'project_memberships',
            'allocation_policies',
            'user_environments',
            'user_access_states',
            'access_transitions',
            'agent_runs',
            'access_transition_runs'
          )
          AND (
            has_table_privilege($1, relation.oid, 'SELECT')
            OR has_table_privilege($1, relation.oid, 'INSERT')
            OR has_table_privilege($1, relation.oid, 'UPDATE')
            OR has_table_privilege($1, relation.oid, 'DELETE')
            OR (
              relation.relkind = 'S'
              AND has_sequence_privilege($1, relation.oid, 'USAGE')
            )
          )
      `,
    )) !== 0
  ) {
    violations.push("unexpected_owned_relation_privilege");
  }

  if (
    (await violationCount(
      client,
      `
        SELECT count(*)::text AS violation_count
        FROM pg_catalog.pg_proc AS routine
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = routine.pronamespace
        WHERE namespace.nspname = 'brai_access'
          AND has_function_privilege($1, routine.oid, 'EXECUTE')
      `,
    )) !== 0
  ) {
    violations.push("unexpected_routine_execute");
  }

  if (violations.length > 0) {
    throw new Error(
      `brai-access runtime role audit failed: ${violations.join(", ")}`,
    );
  }
}

async function main(): Promise<void> {
  const config = readAccessBootstrapConfig();
  const pool = new Pool(config.database);
  const client = await pool.connect();

  try {
    await assertAccessRuntimeRoleIsolation(client);
    console.info(
      JSON.stringify({
        event: "brai_access_runtime_role_audit_passed",
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
        event: "brai_access_runtime_role_audit_failed",
        level: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    process.exitCode = 1;
  });
}
