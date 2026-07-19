CREATE SCHEMA IF NOT EXISTS brai_factory;

REVOKE ALL ON SCHEMA brai_factory FROM PUBLIC;

CREATE TABLE IF NOT EXISTS brai_factory.schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE brai_factory.schema_migrations FROM PUBLIC;

DO $role$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'brai_factory_runtime'
  ) THEN
    CREATE ROLE brai_factory_runtime
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END
$role$;

DO $role_safety$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'brai_factory_runtime'
      AND (
        rolsuper
        OR rolcreatedb
        OR rolcreaterole
        OR rolinherit
        OR rolreplication
        OR rolbypassrls
      )
  ) THEN
    RAISE EXCEPTION
      'brai_factory_runtime has unsafe role attributes';
  END IF;
END
$role_safety$;

DO $memberships$
DECLARE
  granted_role name;
BEGIN
  FOR granted_role IN
    SELECT parent.rolname
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS parent
      ON parent.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS member
      ON member.oid = membership.member
    WHERE member.rolname = 'brai_factory_runtime'
  LOOP
    EXECUTE format(
      'REVOKE %I FROM brai_factory_runtime',
      granted_role
    );
  END LOOP;
END
$memberships$;

ALTER ROLE brai_factory_runtime
  SET search_path TO brai_factory, pg_catalog;

CREATE TABLE IF NOT EXISTS brai_factory.activities (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  idempotency_key uuid NOT NULL,
  created_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activities_title_length_check
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 250),
  CONSTRAINT activities_description_length_check
    CHECK (char_length(description) <= 10000),
  CONSTRAINT activities_idempotency_key_key
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS activities_created_at_id_desc_idx
  ON brai_factory.activities (created_at DESC, id DESC);

COMMENT ON SCHEMA brai_factory IS
  'Private schema owned by the brai-factory service; not exposed through PostgREST.';
COMMENT ON TABLE brai_factory.activities IS
  'Append-only Activity records owned by brai-factory.';
COMMENT ON COLUMN brai_factory.activities.idempotency_key IS
  'Caller-provided UUID used to make create requests idempotent.';

REVOKE ALL ON ALL TABLES IN SCHEMA brai_factory FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA brai_factory FROM PUBLIC;
REVOKE ALL ON SCHEMA brai_factory FROM brai_factory_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA brai_factory FROM brai_factory_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA brai_factory FROM brai_factory_runtime;

DO $grant_connect$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO brai_factory_runtime',
    current_database()
  );
END
$grant_connect$;
GRANT USAGE ON SCHEMA brai_factory TO brai_factory_runtime;
GRANT SELECT, INSERT ON TABLE brai_factory.activities TO brai_factory_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA brai_factory
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA brai_factory
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
