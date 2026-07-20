-- Each Dev or Preview runtime owns its PostgreSQL cluster. Apply the same
-- baseline isolation before any runtime login is provisioned. Preserve only
-- the explicit pre-existing TEMPORARY/public access of non-runtime roles.
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
