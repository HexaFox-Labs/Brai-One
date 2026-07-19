CREATE SCHEMA IF NOT EXISTS brai_access;

REVOKE ALL ON SCHEMA brai_access FROM PUBLIC;

DO $role$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'brai_access_runtime'
  ) THEN
    CREATE ROLE brai_access_runtime
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION
      NOBYPASSRLS
      CONNECTION LIMIT 10;
  END IF;
END
$role$;

DO $role_safety$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'brai_access_runtime'
      AND (
        rolcanlogin
        OR rolsuper
        OR rolcreatedb
        OR rolcreaterole
        OR rolinherit
        OR rolreplication
        OR rolbypassrls
        OR rolconnlimit <> 10
      )
  ) THEN
    RAISE EXCEPTION
      'brai_access_runtime has unsafe role attributes';
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
    WHERE member.rolname = 'brai_access_runtime'
  LOOP
    EXECUTE format('REVOKE %I FROM brai_access_runtime', granted_role);
  END LOOP;
END
$memberships$;

ALTER ROLE brai_access_runtime
  SET search_path TO brai_access, pg_catalog;
ALTER ROLE brai_access_runtime
  SET statement_timeout TO '4s';
ALTER ROLE brai_access_runtime
  SET lock_timeout TO '2s';
ALTER ROLE brai_access_runtime
  SET idle_in_transaction_session_timeout TO '5s';

CREATE TABLE IF NOT EXISTS brai_access.project_memberships (
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  membership_generation bigint NOT NULL DEFAULT 1,
  revocation_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id),
  CONSTRAINT project_memberships_role_check
    CHECK (role IN ('owner', 'admin', 'member')),
  CONSTRAINT project_memberships_status_check
    CHECK (status IN ('active', 'revoking', 'revoked')),
  CONSTRAINT project_memberships_generation_check
    CHECK (membership_generation BETWEEN 1 AND 9007199254740991),
  CONSTRAINT project_memberships_revocation_check
    CHECK (
      (status = 'active' AND revocation_started_at IS NULL)
      OR (status IN ('revoking', 'revoked') AND revocation_started_at IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS brai_access.allocation_policies (
  policy_id text PRIMARY KEY,
  storage_root text NOT NULL,
  outer_id_range_base bigint NOT NULL,
  outer_id_range_size bigint NOT NULL,
  image_brai_id bigint NOT NULL,
  inner_subordinate_offset bigint NOT NULL,
  inner_subordinate_range_size bigint NOT NULL,
  xfs_project_id_base bigint NOT NULL,
  CONSTRAINT allocation_policies_singleton_check
    CHECK (policy_id = 'user-sandbox-v1')
);

INSERT INTO brai_access.allocation_policies (
  policy_id,
  storage_root,
  outer_id_range_base,
  outer_id_range_size,
  image_brai_id,
  inner_subordinate_offset,
  inner_subordinate_range_size,
  xfs_project_id_base
)
VALUES (
  'user-sandbox-v1',
  '/srv/brai-user-data',
  1879048192,
  131072,
  1000,
  65536,
  65536,
  10000
)
ON CONFLICT (policy_id) DO NOTHING;

DO $allocation_policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM brai_access.allocation_policies
    WHERE policy_id = 'user-sandbox-v1'
      AND storage_root = '/srv/brai-user-data'
      AND outer_id_range_base = 1879048192
      AND outer_id_range_size = 131072
      AND image_brai_id = 1000
      AND inner_subordinate_offset = 65536
      AND inner_subordinate_range_size = 65536
      AND xfs_project_id_base = 10000
  ) THEN
    RAISE EXCEPTION 'brai-access allocation policy drift';
  END IF;
END
$allocation_policy$;

CREATE TABLE IF NOT EXISTS brai_access.user_environments (
  user_id uuid PRIMARY KEY,
  environment_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'unprovisioned',
  provision_generation bigint NOT NULL DEFAULT 0,
  provision_access_generation bigint,
  quota_bytes bigint NOT NULL DEFAULT 5368709120,
  quota_inodes bigint NOT NULL DEFAULT 500000,
  enforced_quota_bytes bigint,
  enforced_quota_inodes bigint,
  allocation_slot bigint UNIQUE,
  environment_name text UNIQUE,
  outer_id_range_start bigint UNIQUE,
  outer_id_range_count bigint,
  unix_uid bigint UNIQUE,
  unix_gid bigint UNIQUE,
  subuid_start bigint UNIQUE,
  subgid_start bigint UNIQUE,
  subid_count bigint,
  quota_project_id bigint UNIQUE,
  storage_path text UNIQUE,
  storage_mount_point text,
  storage_device text,
  project_inheritance boolean,
  quota_enforcement_active boolean,
  image_path text,
  image_sha256 text,
  host_provisioned_at timestamptz,
  provision_receipt_sha256 text,
  ready_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_environments_user_environment_key
    UNIQUE (user_id, environment_id),
  CONSTRAINT user_environments_status_check
    CHECK (status IN ('unprovisioned', 'provisioning', 'ready', 'failed')),
  CONSTRAINT user_environments_generation_check
    CHECK (
      provision_generation BETWEEN 0 AND 9007199254740991
      AND (
        (
          status = 'unprovisioned'
          AND provision_generation = 0
          AND provision_access_generation IS NULL
        )
        OR (
          status IN ('provisioning', 'ready', 'failed')
          AND provision_generation >= 1
          AND provision_access_generation BETWEEN 1 AND 9007199254740991
        )
      )
    ),
  CONSTRAINT user_environments_quota_check
    CHECK (
      quota_bytes BETWEEN 1 AND 9007199254740991
      AND quota_inodes BETWEEN 1 AND 9007199254740991
    ),
  CONSTRAINT user_environments_reservation_check
    CHECK (
      (
        status = 'unprovisioned'
        AND allocation_slot IS NULL
        AND environment_name IS NULL
        AND outer_id_range_start IS NULL
        AND outer_id_range_count IS NULL
        AND unix_uid IS NULL
        AND unix_gid IS NULL
        AND subuid_start IS NULL
        AND subgid_start IS NULL
        AND subid_count IS NULL
        AND quota_project_id IS NULL
        AND storage_path IS NULL
        AND storage_mount_point IS NULL
      )
      OR
      (
        status IN ('provisioning', 'ready', 'failed')
        AND allocation_slot IS NOT NULL
        AND environment_name IS NOT NULL
        AND outer_id_range_start IS NOT NULL
        AND outer_id_range_count IS NOT NULL
        AND unix_uid IS NOT NULL
        AND unix_gid IS NOT NULL
        AND subuid_start IS NOT NULL
        AND subgid_start IS NOT NULL
        AND subid_count IS NOT NULL
        AND quota_project_id IS NOT NULL
        AND storage_path IS NOT NULL
        AND storage_mount_point IS NOT NULL
        AND allocation_slot BETWEEN 0 AND 2046
        AND environment_name =
          'brai-u-' ||
          CASE
            WHEN allocation_slot < 36 THEN
              substr(
                '0123456789abcdefghijklmnopqrstuvwxyz',
                allocation_slot::integer + 1,
                1
              )
            WHEN allocation_slot < 1296 THEN
              substr(
                '0123456789abcdefghijklmnopqrstuvwxyz',
                (allocation_slot / 36)::integer + 1,
                1
              ) ||
              substr(
                '0123456789abcdefghijklmnopqrstuvwxyz',
                (allocation_slot % 36)::integer + 1,
                1
              )
            ELSE
              substr(
                '0123456789abcdefghijklmnopqrstuvwxyz',
                (allocation_slot / 1296)::integer + 1,
                1
              ) ||
              substr(
                '0123456789abcdefghijklmnopqrstuvwxyz',
                ((allocation_slot / 36) % 36)::integer + 1,
                1
              ) ||
              substr(
                '0123456789abcdefghijklmnopqrstuvwxyz',
                (allocation_slot % 36)::integer + 1,
                1
              )
          END
        AND outer_id_range_start =
          1879048192 + allocation_slot * 131072
        AND outer_id_range_count = 131072
        AND unix_uid = outer_id_range_start + 1000
        AND unix_gid = unix_uid
        AND subuid_start = outer_id_range_start + 65536
        AND subgid_start = subuid_start
        AND subid_count = 65536
        AND quota_project_id = 10000 + allocation_slot
        AND storage_path = '/srv/brai-user-data/' || environment_name
        AND storage_mount_point = '/srv/brai-user-data'
      )
    ),
  CONSTRAINT user_environments_ready_check
    CHECK (
      (
        status = 'ready'
        AND enforced_quota_bytes IS NOT NULL
        AND enforced_quota_inodes IS NOT NULL
        AND storage_device IS NOT NULL
        AND project_inheritance IS NOT NULL
        AND quota_enforcement_active IS NOT NULL
        AND image_path IS NOT NULL
        AND image_sha256 IS NOT NULL
        AND host_provisioned_at IS NOT NULL
        AND provision_receipt_sha256 IS NOT NULL
        AND ready_at IS NOT NULL
        AND enforced_quota_bytes = quota_bytes
        AND enforced_quota_inodes = quota_inodes
        AND char_length(storage_device) BETWEEN 1 AND 4096
        AND project_inheritance IS TRUE
        AND quota_enforcement_active IS TRUE
        AND image_path LIKE '/%'
        AND image_sha256 ~ '^[0-9a-f]{64}$'
        AND host_provisioned_at IS NOT NULL
        AND provision_receipt_sha256 ~ '^[0-9a-f]{64}$'
        AND ready_at IS NOT NULL
      )
      OR
      (
        status <> 'ready'
        AND enforced_quota_bytes IS NULL
        AND enforced_quota_inodes IS NULL
        AND storage_device IS NULL
        AND project_inheritance IS NULL
        AND quota_enforcement_active IS NULL
        AND image_path IS NULL
        AND image_sha256 IS NULL
        AND host_provisioned_at IS NULL
        AND provision_receipt_sha256 IS NULL
        AND ready_at IS NULL
      )
    ),
  CONSTRAINT user_environments_subuid_non_overlap
    EXCLUDE USING gist (
      int8range(subuid_start, subuid_start + subid_count, '[)') WITH &&
    )
    WHERE (allocation_slot IS NOT NULL),
  CONSTRAINT user_environments_outer_id_non_overlap
    EXCLUDE USING gist (
      int8range(
        outer_id_range_start,
        outer_id_range_start + outer_id_range_count,
        '[)'
      ) WITH &&
    )
    WHERE (allocation_slot IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS brai_access.user_access_states (
  user_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'active',
  developer_mode boolean NOT NULL DEFAULT false,
  access_generation bigint NOT NULL DEFAULT 1,
  previous_developer_mode boolean,
  requested_developer_mode boolean,
  previous_access_generation bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_access_states_environment_fk
    FOREIGN KEY (user_id)
    REFERENCES brai_access.user_environments (user_id)
    ON DELETE RESTRICT,
  CONSTRAINT user_access_states_generation_check
    CHECK (
      access_generation BETWEEN 1 AND 9007199254740991
      AND (
        previous_access_generation IS NULL
        OR previous_access_generation BETWEEN 1 AND 9007199254740991
      )
    ),
  CONSTRAINT user_access_states_transition_check
    CHECK (
      (
        status = 'active'
        AND previous_developer_mode IS NULL
        AND requested_developer_mode IS NULL
        AND previous_access_generation IS NULL
      )
      OR
      (
        status = 'transitioning'
        AND previous_developer_mode IS NOT NULL
        AND requested_developer_mode IS NOT NULL
        AND previous_access_generation IS NOT NULL
        AND developer_mode = previous_developer_mode
        AND requested_developer_mode <> previous_developer_mode
        AND access_generation = previous_access_generation + 1
      )
    )
);

CREATE TABLE IF NOT EXISTS brai_access.access_transitions (
  user_id uuid NOT NULL,
  access_generation bigint NOT NULL,
  requested_by_platform_admin_user_id uuid NOT NULL,
  previous_developer_mode boolean NOT NULL,
  requested_developer_mode boolean NOT NULL,
  previous_access_generation bigint NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (user_id, access_generation),
  CONSTRAINT access_transitions_state_fk
    FOREIGN KEY (user_id)
    REFERENCES brai_access.user_access_states (user_id)
    ON DELETE RESTRICT,
  CONSTRAINT access_transitions_generation_check
    CHECK (
      previous_access_generation BETWEEN 1 AND 9007199254740990
      AND access_generation = previous_access_generation + 1
    ),
  CONSTRAINT access_transitions_mode_check
    CHECK (requested_developer_mode <> previous_developer_mode),
  CONSTRAINT access_transitions_status_check
    CHECK (
      (status = 'terminating' AND completed_at IS NULL)
      OR (status = 'completed' AND completed_at IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS brai_access.agent_runs (
  run_id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  profile text NOT NULL,
  access_generation bigint NOT NULL,
  membership_generation bigint NOT NULL,
  quota_bytes bigint NOT NULL,
  quota_inodes bigint NOT NULL,
  status text NOT NULL,
  runtime_identity text,
  runtime_claim_sha256 text,
  runtime_claimed_at timestamptz,
  runtime_started_sha256 text,
  runtime_started_at timestamptz,
  exit_code integer,
  exit_signal text,
  exit_evidence_sha256 text,
  exited_at timestamptz,
  termination_kind text,
  termination_evidence_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  termination_requested_at timestamptz,
  terminated_at timestamptz,
  CONSTRAINT agent_runs_access_state_fk
    FOREIGN KEY (user_id)
    REFERENCES brai_access.user_access_states (user_id)
    ON DELETE RESTRICT,
  CONSTRAINT agent_runs_membership_fk
    FOREIGN KEY (project_id, user_id)
    REFERENCES brai_access.project_memberships (project_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT agent_runs_environment_fk
    FOREIGN KEY (user_id, environment_id)
    REFERENCES brai_access.user_environments (user_id, environment_id)
    ON DELETE RESTRICT,
  CONSTRAINT agent_runs_profile_check
    CHECK (profile IN ('user-sandbox', 'developer')),
  CONSTRAINT agent_runs_generation_check
    CHECK (
      access_generation BETWEEN 1 AND 9007199254740991
      AND membership_generation BETWEEN 1 AND 9007199254740991
    ),
  CONSTRAINT agent_runs_quota_check
    CHECK (
      quota_bytes BETWEEN 1 AND 9007199254740991
      AND quota_inodes BETWEEN 1 AND 9007199254740991
    ),
  CONSTRAINT agent_runs_status_check
    CHECK (
      status IN (
        'pending',
        'starting',
        'running',
        'termination_requested',
        'succeeded',
        'terminated',
        'failed'
      )
    ),
  CONSTRAINT agent_runs_runtime_evidence_check
    CHECK (
      (
        status = 'pending'
        AND runtime_identity IS NULL
        AND runtime_claim_sha256 IS NULL
        AND runtime_claimed_at IS NULL
        AND runtime_started_sha256 IS NULL
        AND runtime_started_at IS NULL
        AND exit_code IS NULL
        AND exit_signal IS NULL
        AND exit_evidence_sha256 IS NULL
        AND exited_at IS NULL
        AND termination_kind IS NULL
        AND termination_evidence_sha256 IS NULL
        AND terminated_at IS NULL
      )
      OR
      (
        status = 'starting'
        AND runtime_identity IS NOT NULL
        AND char_length(runtime_identity) BETWEEN 1 AND 1024
        AND runtime_claim_sha256 ~ '^[0-9a-f]{64}$'
        AND runtime_claimed_at IS NOT NULL
        AND runtime_started_sha256 IS NULL
        AND runtime_started_at IS NULL
        AND exit_code IS NULL
        AND exit_signal IS NULL
        AND exit_evidence_sha256 IS NULL
        AND exited_at IS NULL
        AND termination_kind IS NULL
        AND termination_evidence_sha256 IS NULL
        AND terminated_at IS NULL
      )
      OR
      (
        status = 'running'
        AND runtime_identity IS NOT NULL
        AND runtime_claim_sha256 ~ '^[0-9a-f]{64}$'
        AND runtime_claimed_at IS NOT NULL
        AND runtime_started_sha256 ~ '^[0-9a-f]{64}$'
        AND runtime_started_at IS NOT NULL
        AND exit_code IS NULL
        AND exit_signal IS NULL
        AND exit_evidence_sha256 IS NULL
        AND exited_at IS NULL
        AND termination_kind IS NULL
        AND termination_evidence_sha256 IS NULL
        AND terminated_at IS NULL
      )
      OR
      (
        status IN ('succeeded', 'failed')
        AND runtime_identity IS NOT NULL
        AND runtime_claim_sha256 ~ '^[0-9a-f]{64}$'
        AND runtime_claimed_at IS NOT NULL
        AND (
          (runtime_started_sha256 IS NULL AND runtime_started_at IS NULL)
          OR (
            runtime_started_sha256 ~ '^[0-9a-f]{64}$'
            AND runtime_started_at IS NOT NULL
          )
        )
        AND exit_evidence_sha256 ~ '^[0-9a-f]{64}$'
        AND exited_at IS NOT NULL
        AND (
          (
            status = 'succeeded'
            AND exit_code = 0
            AND exit_signal IS NULL
          )
          OR (
            status = 'failed'
            AND (
              (exit_code BETWEEN 1 AND 255 AND exit_signal IS NULL)
              OR (exit_code IS NULL AND exit_signal ~ '^SIG[A-Z0-9]+$')
            )
          )
        )
        AND termination_kind IS NULL
        AND termination_evidence_sha256 IS NULL
        AND terminated_at IS NULL
      )
      OR
      (
        status = 'termination_requested'
        AND exit_code IS NULL
        AND exit_signal IS NULL
        AND exit_evidence_sha256 IS NULL
        AND exited_at IS NULL
        AND termination_kind IS NULL
        AND termination_evidence_sha256 IS NULL
        AND terminated_at IS NULL
        AND (
          (
            runtime_identity IS NULL
            AND runtime_claim_sha256 IS NULL
            AND runtime_claimed_at IS NULL
            AND runtime_started_sha256 IS NULL
            AND runtime_started_at IS NULL
          )
          OR (
            runtime_identity IS NOT NULL
            AND runtime_claim_sha256 ~ '^[0-9a-f]{64}$'
            AND runtime_claimed_at IS NOT NULL
            AND (
              (runtime_started_sha256 IS NULL AND runtime_started_at IS NULL)
              OR (
                runtime_started_sha256 ~ '^[0-9a-f]{64}$'
                AND runtime_started_at IS NOT NULL
              )
            )
          )
        )
      )
      OR
      (
        status = 'terminated'
        AND exit_code IS NULL
        AND exit_signal IS NULL
        AND exit_evidence_sha256 IS NULL
        AND exited_at IS NULL
        AND termination_evidence_sha256 ~ '^[0-9a-f]{64}$'
        AND terminated_at IS NOT NULL
        AND (
          (
            runtime_identity IS NULL
            AND runtime_claim_sha256 IS NULL
            AND runtime_claimed_at IS NULL
            AND runtime_started_sha256 IS NULL
            AND runtime_started_at IS NULL
            AND termination_kind = 'cancelled_before_start'
          )
          OR (
            runtime_identity IS NOT NULL
            AND runtime_claim_sha256 ~ '^[0-9a-f]{64}$'
            AND runtime_claimed_at IS NOT NULL
            AND termination_kind = 'process_tree_killed'
          )
        )
      )
    ),
  CONSTRAINT agent_runs_snapshot_key
    UNIQUE (run_id, project_id, user_id, access_generation)
);

CREATE INDEX IF NOT EXISTS agent_runs_live_user_idx
  ON brai_access.agent_runs (user_id, project_id, run_id)
  WHERE status IN (
    'pending',
    'starting',
    'running',
    'termination_requested'
  );

CREATE TABLE IF NOT EXISTS brai_access.access_transition_runs (
  user_id uuid NOT NULL,
  transition_generation bigint NOT NULL,
  project_id uuid NOT NULL,
  run_id uuid NOT NULL,
  run_access_generation bigint NOT NULL,
  runtime_identity text,
  termination_kind text,
  termination_evidence_sha256 text,
  terminated_at timestamptz,
  PRIMARY KEY (user_id, transition_generation, run_id),
  CONSTRAINT access_transition_runs_transition_fk
    FOREIGN KEY (user_id, transition_generation)
    REFERENCES brai_access.access_transitions (
      user_id,
      access_generation
    )
    ON DELETE RESTRICT,
  CONSTRAINT access_transition_runs_run_fk
    FOREIGN KEY (run_id, project_id, user_id, run_access_generation)
    REFERENCES brai_access.agent_runs (
      run_id,
      project_id,
      user_id,
      access_generation
    )
    ON DELETE RESTRICT,
  CONSTRAINT access_transition_runs_receipt_check
    CHECK (
      (
        terminated_at IS NULL
        AND termination_kind IS NULL
        AND termination_evidence_sha256 IS NULL
      )
      OR
      (
        terminated_at IS NOT NULL
        AND termination_evidence_sha256 ~ '^[0-9a-f]{64}$'
        AND (
          (runtime_identity IS NULL AND termination_kind = 'cancelled_before_start')
          OR
          (runtime_identity IS NOT NULL AND termination_kind = 'process_tree_killed')
        )
      )
    )
);

CREATE OR REPLACE FUNCTION brai_access.reject_agent_run_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  current_access_status text;
  current_developer_mode boolean;
  current_access_generation bigint;
  current_environment_status text;
  current_quota_bytes bigint;
  current_quota_inodes bigint;
  current_membership_status text;
  current_membership_generation bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT membership.status, membership.membership_generation
    INTO current_membership_status, current_membership_generation
    FROM brai_access.project_memberships AS membership
    WHERE membership.project_id = NEW.project_id
      AND membership.user_id = NEW.user_id
    FOR UPDATE;

    IF NOT FOUND
      OR current_membership_status <> 'active'
      OR NEW.membership_generation <> current_membership_generation
    THEN
      RAISE EXCEPTION 'agent run membership snapshot does not match active membership';
    END IF;

    SELECT
      state.status,
      state.developer_mode,
      state.access_generation,
      environment.status,
      environment.quota_bytes,
      environment.quota_inodes
    INTO
      current_access_status,
      current_developer_mode,
      current_access_generation,
      current_environment_status,
      current_quota_bytes,
      current_quota_inodes
    FROM brai_access.user_access_states AS state
    JOIN brai_access.user_environments AS environment
      ON environment.user_id = state.user_id
    WHERE state.user_id = NEW.user_id
    FOR SHARE;

    IF NOT FOUND
      OR current_access_status <> 'active'
      OR NEW.access_generation <> current_access_generation
      OR NEW.quota_bytes <> current_quota_bytes
      OR NEW.quota_inodes <> current_quota_inodes
      OR (
        NEW.profile = 'user-sandbox'
        AND current_environment_status <> 'ready'
      )
      OR NEW.profile <> (
        CASE
          WHEN current_developer_mode THEN 'developer'
          ELSE 'user-sandbox'
        END
      )
    THEN
      RAISE EXCEPTION 'agent run access snapshot does not match active state';
    END IF;

    IF NEW.status <> 'pending'
      OR NEW.termination_requested_at IS NOT NULL
      OR NEW.terminated_at IS NOT NULL
      OR NEW.runtime_identity IS NOT NULL
      OR NEW.runtime_claim_sha256 IS NOT NULL
      OR NEW.runtime_claimed_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'new agent run must start pending';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.run_id IS DISTINCT FROM OLD.run_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.environment_id IS DISTINCT FROM OLD.environment_id
    OR NEW.profile IS DISTINCT FROM OLD.profile
    OR NEW.access_generation IS DISTINCT FROM OLD.access_generation
    OR NEW.membership_generation IS DISTINCT FROM OLD.membership_generation
    OR NEW.quota_bytes IS DISTINCT FROM OLD.quota_bytes
    OR NEW.quota_inodes IS DISTINCT FROM OLD.quota_inodes
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'agent run access snapshot is immutable';
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'starting' THEN
    IF OLD.runtime_identity IS NOT NULL
      OR NEW.runtime_identity IS NULL
      OR NEW.runtime_claim_sha256 !~ '^[0-9a-f]{64}$'
      OR NEW.runtime_claimed_at IS NULL
    THEN
      RAISE EXCEPTION 'starting run requires one-time runtime claim evidence';
    END IF;
  ELSIF NEW.runtime_identity IS DISTINCT FROM OLD.runtime_identity
    OR NEW.runtime_claim_sha256 IS DISTINCT FROM OLD.runtime_claim_sha256
    OR NEW.runtime_claimed_at IS DISTINCT FROM OLD.runtime_claimed_at
  THEN
    RAISE EXCEPTION 'agent run runtime identity is immutable after claim';
  END IF;

  IF OLD.status = 'starting' AND NEW.status = 'running' THEN
    IF NEW.runtime_started_sha256 !~ '^[0-9a-f]{64}$'
      OR NEW.runtime_started_at IS NULL
    THEN
      RAISE EXCEPTION 'running run requires exact runtime started evidence';
    END IF;
  ELSIF NEW.runtime_started_sha256 IS DISTINCT FROM OLD.runtime_started_sha256
    OR NEW.runtime_started_at IS DISTINCT FROM OLD.runtime_started_at
  THEN
    RAISE EXCEPTION 'runtime started evidence is immutable';
  END IF;

  IF OLD.status IN ('starting', 'running')
    AND NEW.status IN ('succeeded', 'failed')
  THEN
    IF NEW.exit_evidence_sha256 !~ '^[0-9a-f]{64}$'
      OR NEW.exited_at IS NULL
    THEN
      RAISE EXCEPTION 'terminal run requires exact OS exit evidence';
    END IF;
  ELSIF NEW.exit_code IS DISTINCT FROM OLD.exit_code
    OR NEW.exit_signal IS DISTINCT FROM OLD.exit_signal
    OR NEW.exit_evidence_sha256 IS DISTINCT FROM OLD.exit_evidence_sha256
    OR NEW.exited_at IS DISTINCT FROM OLD.exited_at
  THEN
    RAISE EXCEPTION 'runtime exit evidence is immutable';
  END IF;

  IF OLD.status = 'termination_requested' AND NEW.status = 'terminated' THEN
    IF NEW.termination_evidence_sha256 !~ '^[0-9a-f]{64}$'
      OR NEW.terminated_at IS NULL
      OR (
        OLD.runtime_identity IS NULL
        AND NEW.termination_kind <> 'cancelled_before_start'
      )
      OR (
        OLD.runtime_identity IS NOT NULL
        AND NEW.termination_kind <> 'process_tree_killed'
      )
    THEN
      RAISE EXCEPTION 'terminated run requires exact OS process-tree evidence';
    END IF;
  ELSIF NEW.termination_kind IS DISTINCT FROM OLD.termination_kind
    OR NEW.termination_evidence_sha256 IS DISTINCT FROM OLD.termination_evidence_sha256
    OR NEW.terminated_at IS DISTINCT FROM OLD.terminated_at
  THEN
    RAISE EXCEPTION 'runtime termination evidence is immutable';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
    AND NOT (
       (OLD.status = 'pending' AND NEW.status IN (
         'starting',
         'termination_requested'
       ))
       OR (OLD.status = 'starting' AND NEW.status IN (
         'running',
         'termination_requested',
         'succeeded',
         'failed'
       ))
       OR (OLD.status = 'running' AND NEW.status IN (
         'termination_requested',
         'succeeded',
         'failed'
      ))
      OR (
        OLD.status = 'termination_requested'
        AND NEW.status = 'terminated'
      )
    )
  THEN
    RAISE EXCEPTION 'invalid agent run status transition';
  END IF;

  IF NEW.status = 'termination_requested'
    AND NEW.termination_requested_at IS NULL
  THEN
    RAISE EXCEPTION 'termination_requested run requires request timestamp';
  END IF;

  IF NEW.status = 'terminated' AND NEW.terminated_at IS NULL THEN
    RAISE EXCEPTION 'terminated run requires termination timestamp';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS reject_agent_run_snapshot_mutation
  ON brai_access.agent_runs;
CREATE TRIGGER reject_agent_run_snapshot_mutation
BEFORE INSERT OR UPDATE ON brai_access.agent_runs
FOR EACH ROW
EXECUTE FUNCTION brai_access.reject_agent_run_snapshot_mutation();

CREATE OR REPLACE FUNCTION brai_access.enforce_project_membership_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'project membership history cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active'
      OR NEW.membership_generation <> 1
      OR NEW.revocation_started_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'new project membership must start active at generation one';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'project membership identity is immutable';
  END IF;

  IF OLD.status = 'active' AND NEW.status = 'revoking' THEN
    IF NEW.role IS DISTINCT FROM OLD.role
      OR NEW.membership_generation NOT IN (
        OLD.membership_generation,
        OLD.membership_generation + 1
      )
    THEN
      RAISE EXCEPTION 'membership revoke must preserve role and advance one generation';
    END IF;
    NEW.membership_generation := OLD.membership_generation + 1;
    NEW.revocation_started_at := clock_timestamp();

    UPDATE brai_access.agent_runs
    SET
      status = 'termination_requested',
      termination_requested_at = clock_timestamp()
    WHERE project_id = OLD.project_id
      AND user_id = OLD.user_id
      AND status IN ('pending', 'starting', 'running');
  ELSIF OLD.status = 'revoking' AND NEW.status = 'revoked' THEN
    IF NEW.role IS DISTINCT FROM OLD.role
      OR NEW.membership_generation <> OLD.membership_generation
      OR NEW.revocation_started_at IS DISTINCT FROM OLD.revocation_started_at
    THEN
      RAISE EXCEPTION 'membership finalize must preserve the revoked generation';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM brai_access.agent_runs AS run
      WHERE run.project_id = OLD.project_id
        AND run.user_id = OLD.user_id
        AND run.status IN (
          'pending',
          'starting',
          'running',
          'termination_requested'
        )
    ) THEN
      RAISE EXCEPTION 'membership cannot become revoked while project runs are live';
    END IF;
  ELSIF OLD.status = 'revoked' AND NEW.status = 'active' THEN
    IF NEW.membership_generation NOT IN (
      OLD.membership_generation,
      OLD.membership_generation + 1
    ) THEN
      RAISE EXCEPTION 'membership reactivation must advance one generation';
    END IF;
    NEW.membership_generation := OLD.membership_generation + 1;
    NEW.revocation_started_at := NULL;
  ELSIF NEW.status = OLD.status THEN
    IF NEW.role IS DISTINCT FROM OLD.role
      OR NEW.membership_generation <> OLD.membership_generation
      OR NEW.revocation_started_at IS DISTINCT FROM OLD.revocation_started_at
    THEN
      RAISE EXCEPTION 'membership rights change requires revoke/reactivate transition';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid project membership status transition';
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS enforce_project_membership_transition
  ON brai_access.project_memberships;
CREATE TRIGGER enforce_project_membership_transition
BEFORE INSERT OR UPDATE OR DELETE ON brai_access.project_memberships
FOR EACH ROW
EXECUTE FUNCTION brai_access.enforce_project_membership_transition();

CREATE OR REPLACE FUNCTION brai_access.enforce_user_environment_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'environment reservation cannot be deleted or reused without verified teardown';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'unprovisioned'
      OR NEW.provision_generation <> 0
      OR NEW.provision_access_generation IS NOT NULL
      OR NEW.allocation_slot IS NOT NULL
    THEN
      RAISE EXCEPTION
        'environment must be inserted unprovisioned and without a reservation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.environment_id IS DISTINCT FROM OLD.environment_id
    OR NEW.quota_bytes IS DISTINCT FROM OLD.quota_bytes
    OR NEW.quota_inodes IS DISTINCT FROM OLD.quota_inodes
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'environment identity and configured quota are immutable';
  END IF;

  IF OLD.allocation_slot IS NOT NULL AND (
    NEW.allocation_slot IS DISTINCT FROM OLD.allocation_slot
    OR NEW.environment_name IS DISTINCT FROM OLD.environment_name
    OR NEW.outer_id_range_start IS DISTINCT FROM OLD.outer_id_range_start
    OR NEW.outer_id_range_count IS DISTINCT FROM OLD.outer_id_range_count
    OR NEW.unix_uid IS DISTINCT FROM OLD.unix_uid
    OR NEW.unix_gid IS DISTINCT FROM OLD.unix_gid
    OR NEW.subuid_start IS DISTINCT FROM OLD.subuid_start
    OR NEW.subgid_start IS DISTINCT FROM OLD.subgid_start
    OR NEW.subid_count IS DISTINCT FROM OLD.subid_count
    OR NEW.quota_project_id IS DISTINCT FROM OLD.quota_project_id
    OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
    OR NEW.storage_mount_point IS DISTINCT FROM OLD.storage_mount_point
  ) THEN
    RAISE EXCEPTION
      'environment reservation is immutable until a future verified teardown';
  END IF;

  IF OLD.status = 'ready' AND (
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW.provision_generation IS DISTINCT FROM OLD.provision_generation
    OR NEW.provision_access_generation IS DISTINCT FROM OLD.provision_access_generation
    OR NEW.allocation_slot IS DISTINCT FROM OLD.allocation_slot
    OR NEW.environment_name IS DISTINCT FROM OLD.environment_name
    OR NEW.outer_id_range_start IS DISTINCT FROM OLD.outer_id_range_start
    OR NEW.outer_id_range_count IS DISTINCT FROM OLD.outer_id_range_count
    OR NEW.unix_uid IS DISTINCT FROM OLD.unix_uid
    OR NEW.unix_gid IS DISTINCT FROM OLD.unix_gid
    OR NEW.subuid_start IS DISTINCT FROM OLD.subuid_start
    OR NEW.subgid_start IS DISTINCT FROM OLD.subgid_start
    OR NEW.subid_count IS DISTINCT FROM OLD.subid_count
    OR NEW.quota_project_id IS DISTINCT FROM OLD.quota_project_id
    OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
    OR NEW.storage_mount_point IS DISTINCT FROM OLD.storage_mount_point
    OR NEW.storage_device IS DISTINCT FROM OLD.storage_device
    OR NEW.project_inheritance IS DISTINCT FROM OLD.project_inheritance
    OR NEW.quota_enforcement_active IS DISTINCT FROM OLD.quota_enforcement_active
    OR NEW.image_path IS DISTINCT FROM OLD.image_path
    OR NEW.image_sha256 IS DISTINCT FROM OLD.image_sha256
    OR NEW.host_provisioned_at IS DISTINCT FROM OLD.host_provisioned_at
    OR NEW.enforced_quota_bytes IS DISTINCT FROM OLD.enforced_quota_bytes
    OR NEW.enforced_quota_inodes IS DISTINCT FROM OLD.enforced_quota_inodes
    OR NEW.provision_receipt_sha256 IS DISTINCT FROM OLD.provision_receipt_sha256
    OR NEW.ready_at IS DISTINCT FROM OLD.ready_at
  ) THEN
    RAISE EXCEPTION 'ready environment allocation and enforced quota are immutable';
  END IF;

  IF OLD.status IN ('unprovisioned', 'provisioning', 'failed')
    AND NEW.status = 'provisioning'
  THEN
    IF NEW.provision_generation <> OLD.provision_generation + 1 THEN
      RAISE EXCEPTION 'provisioning retry must advance exactly one generation';
    END IF;
    IF NEW.provision_access_generation IS NULL THEN
      RAISE EXCEPTION 'provisioning must bind the active access generation';
    END IF;
  ELSIF OLD.status = 'provisioning' AND NEW.status IN ('ready', 'failed') THEN
    IF NEW.provision_generation <> OLD.provision_generation
      OR NEW.provision_access_generation <> OLD.provision_access_generation
    THEN
      RAISE EXCEPTION 'provision completion cannot change its generations';
    END IF;
  ELSIF NEW.status = OLD.status THEN
    IF NEW.provision_generation <> OLD.provision_generation
      OR NEW.provision_access_generation IS DISTINCT FROM OLD.provision_access_generation
    THEN
      RAISE EXCEPTION 'environment generations changed outside provisioning';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid user environment status transition';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS enforce_user_environment_mutation
  ON brai_access.user_environments;
CREATE TRIGGER enforce_user_environment_mutation
BEFORE INSERT OR UPDATE OR DELETE ON brai_access.user_environments
FOR EACH ROW
EXECUTE FUNCTION brai_access.enforce_user_environment_mutation();

COMMENT ON SCHEMA brai_access IS
  'Private access-control state owned exclusively by the brai-access service.';
COMMENT ON TABLE brai_access.user_access_states IS
  'Platform-admin-controlled global developer mode and access generation per user.';
COMMENT ON TABLE brai_access.user_environments IS
  'One persistent environment, durable allocation reservation, and one non-reserving hard quota per user.';
COMMENT ON TABLE brai_access.agent_runs IS
  'Immutable server-derived run access snapshots with a mutable lifecycle status.';
COMMENT ON TABLE brai_access.access_transition_runs IS
  'Exact run/generation set that must produce termination receipts before activation.';
COMMENT ON TABLE brai_access.project_memberships IS
  'Generation-stamped memberships; revoke atomically blocks launches and requests termination of every live project run.';

REVOKE ALL ON ALL TABLES IN SCHEMA brai_access FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA brai_access FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA brai_access FROM PUBLIC;
REVOKE ALL ON SCHEMA brai_access FROM brai_access_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA brai_access FROM brai_access_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA brai_access FROM brai_access_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA brai_access FROM brai_access_runtime;

DO $grant_connect$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO brai_access_runtime',
    current_database()
  );
END
$grant_connect$;

GRANT USAGE ON SCHEMA brai_access TO brai_access_runtime;
GRANT SELECT
  ON TABLE
    brai_access.project_memberships,
    brai_access.allocation_policies
  TO brai_access_runtime;
GRANT SELECT, INSERT, UPDATE
  ON TABLE
    brai_access.user_environments,
    brai_access.user_access_states,
    brai_access.access_transitions,
    brai_access.agent_runs,
    brai_access.access_transition_runs
  TO brai_access_runtime;

REVOKE ALL
  ON FUNCTION brai_access.reject_agent_run_snapshot_mutation()
  FROM PUBLIC, brai_access_runtime;
REVOKE ALL
  ON FUNCTION brai_access.enforce_project_membership_transition()
  FROM PUBLIC, brai_access_runtime;
REVOKE ALL
  ON FUNCTION brai_access.enforce_user_environment_mutation()
  FROM PUBLIC, brai_access_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA brai_access
  REVOKE ALL ON TABLES FROM PUBLIC, brai_access_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA brai_access
  REVOKE ALL ON SEQUENCES FROM PUBLIC, brai_access_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA brai_access
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, brai_access_runtime;
