BEGIN;

SELECT pg_advisory_xact_lock(
  hashtextextended('brai-new:brai-factory:pg-net-hardening', 0)
);

DO $pg_net_hardening$
DECLARE
  allowed_role name;
BEGIN
  IF to_regnamespace('net') IS NULL THEN
    RETURN;
  END IF;

  FOR allowed_role IN
    SELECT role_name
    FROM (
      VALUES
        ('supabase_functions_admin'::name),
        ('postgres'::name),
        ('anon'::name),
        ('authenticated'::name),
        ('service_role'::name)
    ) AS allowed(role_name)
    WHERE EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles
      WHERE rolname = allowed.role_name
    )
  LOOP
    EXECUTE format(
      'GRANT USAGE ON SCHEMA net TO %I',
      allowed_role
    );
  END LOOP;

  REVOKE USAGE ON SCHEMA net FROM PUBLIC;
END
$pg_net_hardening$;

COMMIT;
