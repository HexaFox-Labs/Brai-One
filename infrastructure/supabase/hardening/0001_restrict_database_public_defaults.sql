BEGIN;

SELECT pg_advisory_xact_lock(
  hashtextextended('brai-new:brai-factory:database-public-hardening', 0)
);

DO $database_public_hardening$
DECLARE
  existing_role record;
  runtime_role name;
BEGIN
  FOR existing_role IN
    SELECT
      rolname,
      has_database_privilege(
        rolname,
        current_database(),
        'TEMPORARY'
      ) AS had_temporary,
      has_schema_privilege(
        rolname,
        'public',
        'USAGE'
      ) AS had_public_usage
    FROM pg_catalog.pg_roles
    -- Every generated Brai service runtime role is intentionally isolated
    -- from database TEMP and the public schema. Keep this pattern generic so
    -- rerunning hardening cannot silently broaden a newly added service.
    WHERE rolname !~ '^brai_[a-z0-9_]+_runtime$'
      AND (
        has_database_privilege(
          rolname,
          current_database(),
          'TEMPORARY'
        )
        OR has_schema_privilege(rolname, 'public', 'USAGE')
      )
  LOOP
    -- Preserve only privileges the role actually had before PUBLIC is
    -- revoked. On later idempotent runs this must not grant privileges to a
    -- role created after the hardening boundary.
    IF existing_role.had_temporary THEN
      EXECUTE format(
        'GRANT TEMPORARY ON DATABASE %I TO %I',
        current_database(),
        existing_role.rolname
      );
    END IF;
    IF existing_role.had_public_usage THEN
      EXECUTE format(
        'GRANT USAGE ON SCHEMA public TO %I',
        existing_role.rolname
      );
    END IF;
  END LOOP;

  FOR runtime_role IN
    SELECT rolname
    FROM pg_catalog.pg_roles
    WHERE rolname ~ '^brai_[a-z0-9_]+_runtime$'
  LOOP
    EXECUTE format(
      'REVOKE TEMPORARY ON DATABASE %I FROM %I',
      current_database(),
      runtime_role
    );
    EXECUTE format(
      'REVOKE ALL ON SCHEMA public FROM %I',
      runtime_role
    );
  END LOOP;

  EXECUTE format(
    'REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC',
    current_database()
  );
  REVOKE USAGE ON SCHEMA public FROM PUBLIC;
END
$database_public_hardening$;

COMMIT;
