import { Pool, type PoolClient } from "pg";

import {
  ACCESS_MIGRATOR_ROLE,
  assertAccessMigratorRoleIsolation,
} from "./audit-migration-role.js";
import { readAccessBootstrapConfig } from "./config.js";
import { readAccessMigrationFiles } from "./migration-files.js";

const BOOTSTRAP_LOCK = "brai-new:brai-access:migrator-bootstrap";

type AppliedMigrationRow = {
  version: string;
  checksum: string;
};

type BooleanRow = { allowed: boolean };
type FormattedStatementRow = { statement: string };
type LoginRow = { can_login: boolean };

async function assertFoundationChecksums(client: PoolClient): Promise<void> {
  const ledgerExists = await client.query<{ ledger: string | null }>(
    "SELECT to_regclass('brai_access.schema_migrations')::text AS ledger",
  );
  if (ledgerExists.rows[0]?.ledger !== "brai_access.schema_migrations") {
    throw new Error(
      "brai_access foundation is absent; apply checked-in migrations with the one-time bootstrap credential first",
    );
  }

  const applied = await client.query<AppliedMigrationRow>(`
    SELECT version, checksum
    FROM brai_access.schema_migrations
    ORDER BY version ASC
  `);
  const appliedByVersion = new Map(
    applied.rows.map((row) => [row.version, row.checksum]),
  );
  const checkedIn = await readAccessMigrationFiles();
  const checkedInVersions = new Set(
    checkedIn.map((migration) => migration.version),
  );

  for (const migration of checkedIn) {
    const actual = appliedByVersion.get(migration.version);
    if (actual === undefined) {
      throw new Error(
        `brai_access migration ${migration.version} has not been applied`,
      );
    }
    if (actual !== migration.checksum) {
      throw new Error(
        `brai_access migration ${migration.version} checksum differs from source`,
      );
    }
  }
  for (const row of applied.rows) {
    if (!checkedInVersions.has(row.version)) {
      throw new Error(
        `brai_access database contains unknown migration ${row.version}`,
      );
    }
  }
}

async function executeFormattedStatements(
  client: PoolClient,
  query: string,
): Promise<void> {
  const result = await client.query<FormattedStatementRow>(query);
  for (const row of result.rows) {
    if (!row.statement) {
      throw new Error("PostgreSQL returned an empty ownership statement");
    }
    await client.query(row.statement);
  }
}

async function assertExistingRoleIsBounded(
  client: PoolClient,
): Promise<boolean | undefined> {
  const result = await client.query<BooleanRow & LoginRow>(
    `
      SELECT
        (
          NOT rolsuper
          AND NOT rolcreatedb
          AND NOT rolcreaterole
          AND NOT rolinherit
          AND NOT rolreplication
          AND NOT rolbypassrls
          AND rolconnlimit = 1
        ) AS allowed,
        rolcanlogin AS can_login
      FROM pg_catalog.pg_roles
      WHERE rolname = $1
    `,
    [ACCESS_MIGRATOR_ROLE],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  if (!row.allowed) {
    throw new Error("existing brai_access_migrator has unsafe attributes");
  }
  return row.can_login;
}

export async function bootstrapAccessMigratorRole(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [BOOTSTRAP_LOCK],
    );
    await assertFoundationChecksums(client);

    const existingLogin = await assertExistingRoleIsBounded(client);
    if (existingLogin === undefined) {
      await client.query(`
        CREATE ROLE brai_access_migrator
          NOLOGIN
          NOSUPERUSER
          NOCREATEDB
          NOCREATEROLE
          NOINHERIT
          NOREPLICATION
          NOBYPASSRLS
          CONNECTION LIMIT 1
      `);
      // PostgreSQL 17 grants a non-superuser CREATEROLE creator automatic
      // ADMIN membership in each role it creates. Remove that implicit edge
      // immediately; the strict bidirectional membership audit below then
      // proves that no authority path remains.
      await executeFormattedStatements(
        client,
        `
          SELECT format(
            'REVOKE brai_access_migrator FROM %I',
            member.rolname
          ) AS statement
          FROM pg_catalog.pg_auth_members AS membership
          JOIN pg_catalog.pg_roles AS parent
            ON parent.oid = membership.roleid
          JOIN pg_catalog.pg_roles AS member
            ON member.oid = membership.member
          WHERE parent.rolname = 'brai_access_migrator'
            AND member.rolname = current_user
        `,
      );
    }

    const membershipCount = await client.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS parent
          ON parent.oid = membership.roleid
        JOIN pg_catalog.pg_roles AS member
          ON member.oid = membership.member
        WHERE parent.rolname = $1 OR member.rolname = $1
      `,
      [ACCESS_MIGRATOR_ROLE],
    );
    if (membershipCount.rows[0]?.count !== "0") {
      throw new Error("brai_access_migrator must not have role memberships");
    }

    await client.query(`
      ALTER ROLE brai_access_migrator
        SET search_path TO brai_access, pg_catalog;
      ALTER ROLE brai_access_migrator
        SET statement_timeout TO '5min';
      ALTER ROLE brai_access_migrator
        SET lock_timeout TO '5s';
      ALTER ROLE brai_access_migrator
        SET idle_in_transaction_session_timeout TO '30s';
    `);

    await executeFormattedStatements(
      client,
      `
        SELECT format(
          'GRANT CONNECT ON DATABASE %I TO brai_access_migrator',
          current_database()
        ) AS statement
        UNION ALL
        SELECT format(
          'REVOKE TEMPORARY ON DATABASE %I FROM brai_access_migrator',
          current_database()
        ) AS statement
      `,
    );

    await client.query(`
      REVOKE ALL ON SCHEMA brai_access FROM PUBLIC;
      GRANT USAGE, CREATE ON SCHEMA brai_access TO brai_access_migrator;
      ALTER SCHEMA brai_access OWNER TO brai_access_migrator;
    `);

    await executeFormattedStatements(
      client,
      `
        SELECT format(
          CASE relation.relkind
            WHEN 'r' THEN 'ALTER TABLE %I.%I OWNER TO brai_access_migrator'
            WHEN 'p' THEN 'ALTER TABLE %I.%I OWNER TO brai_access_migrator'
            WHEN 'S' THEN 'ALTER SEQUENCE %I.%I OWNER TO brai_access_migrator'
            WHEN 'v' THEN 'ALTER VIEW %I.%I OWNER TO brai_access_migrator'
            WHEN 'm' THEN
              'ALTER MATERIALIZED VIEW %I.%I OWNER TO brai_access_migrator'
            WHEN 'f' THEN
              'ALTER FOREIGN TABLE %I.%I OWNER TO brai_access_migrator'
          END,
          namespace.nspname,
          relation.relname
        ) AS statement
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'brai_access'
          AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        ORDER BY relation.oid
      `,
    );

    await executeFormattedStatements(
      client,
      `
        SELECT format(
          CASE routine.prokind
            WHEN 'p' THEN
              'ALTER PROCEDURE %I.%I(%s) OWNER TO brai_access_migrator'
            ELSE
              'ALTER FUNCTION %I.%I(%s) OWNER TO brai_access_migrator'
          END,
          namespace.nspname,
          routine.proname,
          pg_catalog.pg_get_function_identity_arguments(routine.oid)
        ) AS statement
        FROM pg_catalog.pg_proc AS routine
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = routine.pronamespace
        WHERE namespace.nspname = 'brai_access'
          AND routine.prokind IN ('f', 'p', 'w')
        ORDER BY routine.oid
      `,
    );

    await client.query(`
      ALTER DEFAULT PRIVILEGES
        FOR ROLE brai_access_migrator
        IN SCHEMA brai_access
        REVOKE ALL ON TABLES FROM PUBLIC;
      ALTER DEFAULT PRIVILEGES
        FOR ROLE brai_access_migrator
        IN SCHEMA brai_access
        REVOKE ALL ON SEQUENCES FROM PUBLIC;
      ALTER DEFAULT PRIVILEGES
        FOR ROLE brai_access_migrator
        IN SCHEMA brai_access
        REVOKE ALL ON FUNCTIONS FROM PUBLIC;
    `);

    await assertAccessMigratorRoleIsolation(client, existingLogin ?? false);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const config = readAccessBootstrapConfig();
  const pool = new Pool(config.database);
  try {
    await bootstrapAccessMigratorRole(pool);
    console.info(
      JSON.stringify({
        event: "brai_access_migrator_bootstrapped",
        level: "info",
        role: ACCESS_MIGRATOR_ROLE,
      }),
    );
  } finally {
    await pool.end();
  }
}

if (/bootstrap-migration-role\.(?:js|ts)$/u.test(process.argv[1] ?? "")) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "brai_access_migrator_bootstrap_failed",
        level: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    process.exitCode = 1;
  });
}
