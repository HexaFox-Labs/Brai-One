-- brai-access typed runtime lifecycle v2.
--
-- This foundation migration deliberately refuses to invent bindings or OS
-- identities for a run created under the v1 opaque-evidence model.
DO $migration_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM brai_access.agent_runs) THEN
    RAISE EXCEPTION
      'typed runtime lifecycle migration requires an empty agent_runs table';
  END IF;
END
$migration_guard$;

DROP TRIGGER IF EXISTS reject_agent_run_snapshot_mutation
  ON brai_access.agent_runs;

ALTER TABLE brai_access.agent_runs
  DROP CONSTRAINT agent_runs_runtime_evidence_check,
  ALTER COLUMN environment_id DROP NOT NULL,
  ALTER COLUMN runtime_identity TYPE jsonb
    USING NULL::jsonb,
  DROP COLUMN runtime_claim_sha256,
  DROP COLUMN runtime_started_sha256,
  DROP COLUMN exit_evidence_sha256,
  DROP COLUMN termination_evidence_sha256,
  ADD COLUMN runtime_host_id text NOT NULL
    DEFAULT 'brai-runtime-host-1',
  ADD COLUMN job_reference text NOT NULL,
  ADD COLUMN command_sha256 text NOT NULL,
  ADD COLUMN runtime_claim_receipt jsonb,
  ADD COLUMN runtime_started_receipt jsonb,
  ADD COLUMN exit_receipt jsonb,
  ADD COLUMN termination_receipt jsonb;

ALTER TABLE brai_access.agent_runs
  ALTER COLUMN runtime_host_id DROP DEFAULT,
  ADD CONSTRAINT agent_runs_launch_binding_check
    CHECK (
      runtime_host_id = 'brai-runtime-host-1'
      AND char_length(job_reference) BETWEEN 1 AND 1024
      AND job_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/@+\-]*$'
      AND command_sha256 ~ '^[a-f0-9]{64}$'
      AND (
        (profile = 'user-sandbox' AND environment_id IS NOT NULL)
        OR (profile = 'developer' AND environment_id IS NULL)
      )
    ),
  ADD CONSTRAINT agent_runs_typed_runtime_lifecycle_check
    CHECK ((
      (
        status = 'pending'
        AND runtime_identity IS NULL
        AND runtime_claim_receipt IS NULL
        AND runtime_claimed_at IS NULL
        AND runtime_started_receipt IS NULL
        AND runtime_started_at IS NULL
        AND exit_code IS NULL
        AND exit_signal IS NULL
        AND exit_receipt IS NULL
        AND exited_at IS NULL
        AND termination_kind IS NULL
        AND termination_receipt IS NULL
        AND terminated_at IS NULL
      )
      OR
      (
        status = 'starting'
        AND jsonb_typeof(runtime_identity) = 'object'
        AND jsonb_typeof(runtime_claim_receipt) = 'object'
        AND runtime_claim_receipt -> 'runtimeIdentity' = runtime_identity
        AND runtime_claimed_at IS NOT NULL
        AND runtime_started_receipt IS NULL
        AND runtime_started_at IS NULL
        AND exit_code IS NULL
        AND exit_signal IS NULL
        AND exit_receipt IS NULL
        AND exited_at IS NULL
        AND termination_kind IS NULL
        AND termination_receipt IS NULL
        AND terminated_at IS NULL
      )
      OR
      (
        status = 'running'
        AND jsonb_typeof(runtime_identity) = 'object'
        AND jsonb_typeof(runtime_claim_receipt) = 'object'
        AND runtime_claim_receipt -> 'runtimeIdentity' = runtime_identity
        AND runtime_claimed_at IS NOT NULL
        AND jsonb_typeof(runtime_started_receipt) = 'object'
        AND runtime_started_receipt -> 'runtimeIdentity' = runtime_identity
        AND runtime_started_at IS NOT NULL
        AND exit_code IS NULL
        AND exit_signal IS NULL
        AND exit_receipt IS NULL
        AND exited_at IS NULL
        AND termination_kind IS NULL
        AND termination_receipt IS NULL
        AND terminated_at IS NULL
      )
      OR
      (
        status IN ('succeeded', 'failed')
        AND jsonb_typeof(runtime_identity) = 'object'
        AND jsonb_typeof(runtime_claim_receipt) = 'object'
        AND runtime_claim_receipt -> 'runtimeIdentity' = runtime_identity
        AND runtime_claimed_at IS NOT NULL
        AND (
          (runtime_started_receipt IS NULL AND runtime_started_at IS NULL)
          OR (
            jsonb_typeof(runtime_started_receipt) = 'object'
            AND runtime_started_receipt -> 'runtimeIdentity' =
              runtime_identity
            AND runtime_started_at IS NOT NULL
          )
        )
        AND jsonb_typeof(exit_receipt) = 'object'
        AND exit_receipt -> 'runtimeIdentity' = runtime_identity
        AND exit_receipt #>> '{emptyCgroup,populated}' = 'false'
        AND exit_receipt #>> '{emptyCgroup,leader_present}' = 'false'
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
        AND termination_receipt IS NULL
        AND terminated_at IS NULL
      )
      OR
      (
        status = 'termination_requested'
        AND exit_code IS NULL
        AND exit_signal IS NULL
        AND exit_receipt IS NULL
        AND exited_at IS NULL
        AND termination_kind IS NULL
        AND termination_receipt IS NULL
        AND terminated_at IS NULL
        AND (
          (
            runtime_identity IS NULL
            AND runtime_claim_receipt IS NULL
            AND runtime_claimed_at IS NULL
            AND runtime_started_receipt IS NULL
            AND runtime_started_at IS NULL
          )
          OR (
            jsonb_typeof(runtime_identity) = 'object'
            AND jsonb_typeof(runtime_claim_receipt) = 'object'
            AND runtime_claim_receipt -> 'runtimeIdentity' =
              runtime_identity
            AND runtime_claimed_at IS NOT NULL
            AND (
              (runtime_started_receipt IS NULL AND runtime_started_at IS NULL)
              OR (
                jsonb_typeof(runtime_started_receipt) = 'object'
                AND runtime_started_receipt -> 'runtimeIdentity' =
                  runtime_identity
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
        AND exit_receipt IS NULL
        AND exited_at IS NULL
        AND jsonb_typeof(termination_receipt) = 'object'
        AND terminated_at IS NOT NULL
        AND (
          (
            runtime_identity IS NULL
            AND runtime_claim_receipt IS NULL
            AND runtime_claimed_at IS NULL
            AND runtime_started_receipt IS NULL
            AND runtime_started_at IS NULL
            AND termination_kind = 'cancelled_before_start'
            AND termination_receipt -> 'runtimeIdentity' = 'null'::jsonb
            AND termination_receipt -> 'emptyCgroup' = 'null'::jsonb
          )
          OR (
            jsonb_typeof(runtime_identity) = 'object'
            AND jsonb_typeof(runtime_claim_receipt) = 'object'
            AND runtime_claim_receipt -> 'runtimeIdentity' =
              runtime_identity
            AND runtime_claimed_at IS NOT NULL
            AND termination_kind = 'process_tree_killed'
            AND termination_receipt -> 'runtimeIdentity' =
              runtime_identity
            AND termination_receipt #>> '{emptyCgroup,populated}' = 'false'
            AND termination_receipt #>> '{emptyCgroup,leader_present}' =
              'false'
          )
        )
      )
    ) IS TRUE);

ALTER TABLE brai_access.access_transition_runs
  DROP CONSTRAINT access_transition_runs_receipt_check,
  ALTER COLUMN runtime_identity TYPE jsonb
    USING NULL::jsonb,
  DROP COLUMN termination_evidence_sha256,
  ADD COLUMN termination_receipt jsonb,
  ADD CONSTRAINT access_transition_runs_typed_receipt_check
    CHECK ((
      (
        terminated_at IS NULL
        AND termination_kind IS NULL
        AND termination_receipt IS NULL
      )
      OR
      (
        terminated_at IS NOT NULL
        AND jsonb_typeof(termination_receipt) = 'object'
        AND (
          (
            runtime_identity IS NULL
            AND termination_kind = 'cancelled_before_start'
            AND termination_receipt -> 'runtimeIdentity' = 'null'::jsonb
            AND termination_receipt -> 'emptyCgroup' = 'null'::jsonb
          )
          OR (
            jsonb_typeof(runtime_identity) = 'object'
            AND termination_kind = 'process_tree_killed'
            AND termination_receipt -> 'runtimeIdentity' =
              runtime_identity
            AND termination_receipt #>> '{emptyCgroup,populated}' = 'false'
            AND termination_receipt #>> '{emptyCgroup,leader_present}' =
              'false'
          )
        )
      )
    ) IS TRUE);

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
  current_environment_id uuid;
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
      RAISE EXCEPTION
        'agent run membership snapshot does not match active membership';
    END IF;

    SELECT
      state.status,
      state.developer_mode,
      state.access_generation,
      environment.environment_id,
      environment.status,
      environment.quota_bytes,
      environment.quota_inodes
    INTO
      current_access_status,
      current_developer_mode,
      current_access_generation,
      current_environment_id,
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
      OR NEW.runtime_host_id <> 'brai-runtime-host-1'
      OR (
        NEW.profile = 'user-sandbox'
        AND (
          current_environment_status <> 'ready'
          OR NEW.environment_id IS DISTINCT FROM current_environment_id
        )
      )
      OR (NEW.profile = 'developer' AND NEW.environment_id IS NOT NULL)
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
      OR NEW.runtime_claim_receipt IS NOT NULL
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
    OR NEW.runtime_host_id IS DISTINCT FROM OLD.runtime_host_id
    OR NEW.job_reference IS DISTINCT FROM OLD.job_reference
    OR NEW.command_sha256 IS DISTINCT FROM OLD.command_sha256
    OR NEW.access_generation IS DISTINCT FROM OLD.access_generation
    OR NEW.membership_generation IS DISTINCT FROM OLD.membership_generation
    OR NEW.quota_bytes IS DISTINCT FROM OLD.quota_bytes
    OR NEW.quota_inodes IS DISTINCT FROM OLD.quota_inodes
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'agent run launch snapshot is immutable';
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'starting' THEN
    IF OLD.runtime_identity IS NOT NULL
      OR jsonb_typeof(NEW.runtime_identity) IS DISTINCT FROM 'object'
      OR jsonb_typeof(NEW.runtime_claim_receipt) IS DISTINCT FROM 'object'
      OR NEW.runtime_claim_receipt -> 'runtimeIdentity' IS DISTINCT FROM
        NEW.runtime_identity
      OR NEW.runtime_claimed_at IS NULL
    THEN
      RAISE EXCEPTION 'starting run requires one-time typed runtime claim';
    END IF;
  ELSIF NEW.runtime_identity IS DISTINCT FROM OLD.runtime_identity
    OR NEW.runtime_claim_receipt IS DISTINCT FROM OLD.runtime_claim_receipt
    OR NEW.runtime_claimed_at IS DISTINCT FROM OLD.runtime_claimed_at
  THEN
    RAISE EXCEPTION 'agent run runtime identity is immutable after claim';
  END IF;

  IF OLD.status = 'starting' AND NEW.status = 'running' THEN
    IF jsonb_typeof(NEW.runtime_started_receipt) IS DISTINCT FROM 'object'
      OR NEW.runtime_started_receipt -> 'runtimeIdentity' IS DISTINCT FROM
        NEW.runtime_identity
      OR NEW.runtime_started_at IS NULL
    THEN
      RAISE EXCEPTION 'running run requires a typed runtime-start receipt';
    END IF;
  ELSIF NEW.runtime_started_receipt IS DISTINCT FROM
      OLD.runtime_started_receipt
    OR NEW.runtime_started_at IS DISTINCT FROM OLD.runtime_started_at
  THEN
    RAISE EXCEPTION 'runtime-start receipt is immutable';
  END IF;

  IF OLD.status IN ('starting', 'running')
    AND NEW.status IN ('succeeded', 'failed')
  THEN
    IF jsonb_typeof(NEW.exit_receipt) IS DISTINCT FROM 'object'
      OR NEW.exit_receipt -> 'runtimeIdentity' IS DISTINCT FROM
        NEW.runtime_identity
      OR NEW.exit_receipt #>> '{emptyCgroup,populated}' IS DISTINCT FROM
        'false'
      OR NEW.exit_receipt #>> '{emptyCgroup,leader_present}' IS DISTINCT FROM
        'false'
      OR NEW.exited_at IS NULL
    THEN
      RAISE EXCEPTION
        'terminal run requires a typed cgroup-empty exit receipt';
    END IF;
  ELSIF NEW.exit_code IS DISTINCT FROM OLD.exit_code
    OR NEW.exit_signal IS DISTINCT FROM OLD.exit_signal
    OR NEW.exit_receipt IS DISTINCT FROM OLD.exit_receipt
    OR NEW.exited_at IS DISTINCT FROM OLD.exited_at
  THEN
    RAISE EXCEPTION 'runtime exit receipt is immutable';
  END IF;

  IF OLD.status = 'termination_requested' AND NEW.status = 'terminated' THEN
    IF jsonb_typeof(NEW.termination_receipt) IS DISTINCT FROM 'object'
      OR NEW.terminated_at IS NULL
      OR (
        OLD.runtime_identity IS NULL
        AND (
          NEW.termination_kind <> 'cancelled_before_start'
          OR NEW.termination_receipt -> 'runtimeIdentity' IS DISTINCT FROM
            'null'::jsonb
          OR NEW.termination_receipt -> 'emptyCgroup' IS DISTINCT FROM
            'null'::jsonb
        )
      )
      OR (
        OLD.runtime_identity IS NOT NULL
        AND (
          NEW.termination_kind <> 'process_tree_killed'
          OR NEW.termination_receipt -> 'runtimeIdentity' IS DISTINCT FROM
            OLD.runtime_identity
          OR NEW.termination_receipt #>> '{emptyCgroup,populated}'
            IS DISTINCT FROM 'false'
          OR NEW.termination_receipt #>> '{emptyCgroup,leader_present}'
            IS DISTINCT FROM 'false'
        )
      )
    THEN
      RAISE EXCEPTION
        'terminated run requires a matching typed cgroup-empty receipt';
    END IF;
  ELSIF NEW.termination_kind IS DISTINCT FROM OLD.termination_kind
    OR NEW.termination_receipt IS DISTINCT FROM OLD.termination_receipt
    OR NEW.terminated_at IS DISTINCT FROM OLD.terminated_at
  THEN
    RAISE EXCEPTION 'runtime termination receipt is immutable';
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
    RAISE EXCEPTION
      'termination_requested run requires request timestamp';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER reject_agent_run_snapshot_mutation
BEFORE INSERT OR UPDATE ON brai_access.agent_runs
FOR EACH ROW
EXECUTE FUNCTION brai_access.reject_agent_run_snapshot_mutation();

REVOKE ALL
  ON FUNCTION brai_access.reject_agent_run_snapshot_mutation()
  FROM PUBLIC, brai_access_runtime;

COMMENT ON COLUMN brai_access.agent_runs.runtime_identity IS
  'Exact typed systemd/cgroup identity; immutable after one-time claim.';
COMMENT ON COLUMN brai_access.agent_runs.runtime_claim_receipt IS
  'Verified typed runtime claim document; no opaque evidence hash.';
COMMENT ON COLUMN brai_access.agent_runs.exit_receipt IS
  'Verified typed exit plus exact empty-cgroup proof.';
COMMENT ON COLUMN brai_access.agent_runs.termination_receipt IS
  'Verified typed termination plus exact empty-cgroup proof.';
