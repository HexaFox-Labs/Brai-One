import { Pool, type PoolClient } from "pg";

import { readAccessBootstrapConfig } from "./config.js";

export const ACCESS_MIGRATOR_ROLE = "brai_access_migrator";

type BooleanRow = { allowed: boolean };
type CountRow = { violation_count: string };

async function booleanCheck(
  client: Pick<PoolClient, "query">,
  query: string,
  parameters: unknown[] = [ACCESS_MIGRATOR_ROLE],
): Promise<boolean> {
  const result = await client.query<BooleanRow>(query, parameters);
  return result.rows[0]?.allowed === true;
}

async function violationCount(
  client: Pick<PoolClient, "query">,
  query: string,
): Promise<number> {
  const result = await client.query<CountRow>(query, [ACCESS_MIGRATOR_ROLE]);
  return Number(result.rows[0]?.violation_count ?? "0");
}

export async function assertAccessMigratorRoleIsolation(
  client: Pick<PoolClient, "query">,
  expectedLogin: boolean,
): Promise<void> {
  const violations: string[] = [];

  if (
    !(await booleanCheck(
      client,
      `
        SELECT (
          rolcanlogin = $2
          AND NOT rolsuper
          AND NOT rolcreatedb
          AND NOT rolcreaterole
          AND NOT rolinherit
          AND NOT rolreplication
          AND NOT rolbypassrls
          AND rolconnlimit = 1
          AND (
            rolvaliduntil IS NULL
            OR rolvaliduntil = 'infinity'::timestamptz
          )
          AND (
            ($2 AND rolpassword LIKE 'SCRAM-SHA-256$%')
            OR (NOT $2)
          )
        ) AS allowed
        FROM pg_catalog.pg_authid
        WHERE rolname = $1
      `,
      [ACCESS_MIGRATOR_ROLE, expectedLogin],
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
              'search_path',
              'statement_timeout',
              'lock_timeout',
              'idle_in_transaction_session_timeout'
            )
        )
        SELECT (
          (SELECT count(*) FROM configured
            WHERE setdatabase = 0
              AND option_name = 'search_path'
              AND option_value = 'brai_access, pg_catalog') = 1
          AND (SELECT count(*) FROM configured
            WHERE setdatabase = 0
              AND option_name = 'statement_timeout'
              AND option_value = '5min') = 1
          AND (SELECT count(*) FROM configured
            WHERE setdatabase = 0
              AND option_name = 'lock_timeout'
              AND option_value = '5s') = 1
          AND (SELECT count(*) FROM configured
            WHERE setdatabase = 0
              AND option_name = 'idle_in_transaction_session_timeout'
              AND option_value = '30s') = 1
          AND NOT EXISTS (
            SELECT 1 FROM configured WHERE setdatabase <> 0
          )
        ) AS allowed
      `,
    ))
  ) {
    violations.push("invalid_role_settings");
  }

  for (const membershipDirection of [
    `
      SELECT count(*)::text AS violation_count
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member
        ON member.oid = membership.member
      WHERE member.rolname = $1
    `,
    `
      SELECT count(*)::text AS violation_count
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS parent
        ON parent.oid = membership.roleid
      WHERE parent.rolname = $1
    `,
  ]) {
    if ((await violationCount(client, membershipDirection)) !== 0) {
      violations.push("unexpected_role_membership");
      break;
    }
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
          AND has_schema_privilege($1, 'brai_access', 'CREATE')
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
        SELECT owner.rolname = $1 AS allowed
        FROM pg_catalog.pg_namespace AS namespace
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = namespace.nspowner
        WHERE namespace.nspname = 'brai_access'
      `,
    ))
  ) {
    violations.push("schema_not_owned");
  }

  if (
    (await violationCount(
      client,
      `
        SELECT count(*)::text AS violation_count
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = relation.relowner
        WHERE namespace.nspname = 'brai_access'
          AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
          AND owner.rolname <> $1
      `,
    )) !== 0
  ) {
    violations.push("relation_not_owned");
  }

  if (
    (await violationCount(
      client,
      `
        SELECT count(*)::text AS violation_count
        FROM pg_catalog.pg_proc AS routine
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = routine.pronamespace
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = routine.proowner
        WHERE namespace.nspname = 'brai_access'
          AND owner.rolname <> $1
      `,
    )) !== 0
  ) {
    violations.push("routine_not_owned");
  }

  if (
    (await violationCount(
      client,
      `
        SELECT count(*)::text AS violation_count
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname NOT LIKE 'pg_%'
          AND namespace.nspname <> 'information_schema'
          AND namespace.nspname <> 'brai_access'
          AND has_schema_privilege($1, namespace.oid, 'USAGE')
          AND (
            has_table_privilege($1, relation.oid, 'SELECT')
            OR has_table_privilege($1, relation.oid, 'INSERT')
            OR has_table_privilege($1, relation.oid, 'UPDATE')
            OR has_table_privilege($1, relation.oid, 'DELETE')
          )
      `,
    )) !== 0
  ) {
    violations.push("foreign_relation_access");
  }

  if (violations.length > 0) {
    throw new Error(
      `brai-access migrator role audit failed: ${violations.join(", ")}`,
    );
  }
}

async function main(): Promise<void> {
  const config = readAccessBootstrapConfig();
  const pool = new Pool(config.database);
  const client = await pool.connect();
  try {
    await assertAccessMigratorRoleIsolation(client, true);
    console.info(
      JSON.stringify({
        event: "brai_access_migrator_role_audit_passed",
        level: "info",
        role: ACCESS_MIGRATOR_ROLE,
      }),
    );
  } finally {
    client.release();
    await pool.end();
  }
}

if (/audit-migration-role\.(?:js|ts)$/u.test(process.argv[1] ?? "")) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "brai_access_migrator_role_audit_failed",
        level: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    process.exitCode = 1;
  });
}
