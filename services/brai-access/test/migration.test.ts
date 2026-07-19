import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

let migration = "";
let typedLifecycleMigration = "";

beforeAll(async () => {
  migration = await readFile(
    new URL("../migrations/0001_initial.sql", import.meta.url),
    "utf8",
  );
  typedLifecycleMigration = await readFile(
    new URL("../migrations/0002_typed_runtime_lifecycle.sql", import.meta.url),
    "utf8",
  );
});

describe("brai-access typed runtime lifecycle migration", () => {
  it("fails instead of fabricating bindings for legacy live runs", () => {
    expect(typedLifecycleMigration).toContain(
      "typed runtime lifecycle migration requires an empty agent_runs table",
    );
  });

  it("stores immutable launch bindings and typed JSON receipts", () => {
    expect(typedLifecycleMigration).toContain(
      "ADD COLUMN runtime_host_id text NOT NULL",
    );
    expect(typedLifecycleMigration).toContain(
      "ADD COLUMN job_reference text NOT NULL",
    );
    expect(typedLifecycleMigration).toContain(
      "ADD COLUMN command_sha256 text NOT NULL",
    );
    expect(typedLifecycleMigration).toContain(
      "ALTER COLUMN runtime_identity TYPE jsonb",
    );
    expect(typedLifecycleMigration).toContain(
      "ADD COLUMN runtime_claim_receipt jsonb",
    );
    expect(typedLifecycleMigration).toContain("ADD COLUMN exit_receipt jsonb");
    expect(typedLifecycleMigration).toContain(
      "ADD COLUMN termination_receipt jsonb",
    );
    expect(typedLifecycleMigration).not.toContain(
      "ADD COLUMN exit_evidence_sha256",
    );
  });

  it("requires exact cgroup-empty receipts and immutable one-use CAS state", () => {
    expect(typedLifecycleMigration).toContain(
      "runtime_claim_receipt -> 'runtimeIdentity' = runtime_identity",
    );
    expect(typedLifecycleMigration).toContain(
      "exit_receipt #>> '{emptyCgroup,populated}' = 'false'",
    );
    expect(typedLifecycleMigration).toContain(
      "termination_receipt #>> '{emptyCgroup,leader_present}'",
    );
    expect(typedLifecycleMigration).toContain(
      "starting run requires one-time typed runtime claim",
    );
    expect(typedLifecycleMigration).toContain(
      "agent run runtime identity is immutable after claim",
    );
  });
});

function tableDefinition(table: string, nextTable: string): string {
  const start = migration.indexOf(
    `CREATE TABLE IF NOT EXISTS brai_access.${table}`,
  );
  const next = migration.indexOf(
    `CREATE TABLE IF NOT EXISTS brai_access.${nextTable}`,
  );
  return migration.slice(start, next === -1 ? undefined : next);
}

describe("brai-access migration policy", () => {
  it("creates a bounded NOLOGIN least-privilege runtime role", () => {
    expect(migration).toMatch(
      /CREATE ROLE brai_access_runtime[\s\S]*?NOLOGIN[\s\S]*?NOINHERIT[\s\S]*?CONNECTION LIMIT 10;/,
    );
    expect(migration).toContain(
      "brai_access_runtime has unsafe role attributes",
    );
    expect(migration).toContain("rolconnlimit <> 10");
    expect(migration).toContain("SET statement_timeout TO '4s'");
    expect(migration).toContain("SET lock_timeout TO '2s'");
    expect(migration).toContain(
      "SET idle_in_transaction_session_timeout TO '5s'",
    );
    expect(migration).toContain(
      "REVOKE ALL ON ALL TABLES IN SCHEMA brai_access FROM PUBLIC",
    );
    expect(migration).toContain(
      "REVOKE ALL ON ALL FUNCTIONS IN SCHEMA brai_access FROM PUBLIC",
    );
    expect(migration).not.toMatch(/GRANT[\s\S]{0,200}\bTO PUBLIC\b/);
  });

  it("stores global developer mode, one environment, and quota limit per user", () => {
    const environment = tableDefinition(
      "user_environments",
      "user_access_states",
    );
    const accessState = tableDefinition(
      "user_access_states",
      "access_transitions",
    );
    const transition = tableDefinition("access_transitions", "agent_runs");

    expect(environment).toMatch(/user_id uuid PRIMARY KEY/u);
    expect(environment).toContain("UNIQUE (user_id, environment_id)");
    expect(environment).toContain(
      "status text NOT NULL DEFAULT 'unprovisioned'",
    );
    expect(environment).toContain(
      "quota_bytes bigint NOT NULL DEFAULT 5368709120",
    );
    expect(environment).toContain(
      "quota_inodes bigint NOT NULL DEFAULT 500000",
    );
    expect(environment).toContain("enforced_quota_bytes bigint");
    expect(environment).toContain("provision_access_generation bigint");
    expect(migration).toContain(
      "provisioning must bind the active access generation",
    );
    expect(environment).toContain("enforced_quota_bytes = quota_bytes");
    expect(environment).toContain("enforced_quota_inodes = quota_inodes");
    expect(environment).toContain(
      "status IN ('provisioning', 'ready', 'failed')",
    );
    expect(environment).toContain(
      "CONSTRAINT user_environments_reservation_check",
    );
    expect(environment).toContain("WHERE (allocation_slot IS NOT NULL)");
    expect(environment).toContain(
      "CONSTRAINT user_environments_outer_id_non_overlap",
    );
    expect(accessState).toMatch(/user_id uuid PRIMARY KEY/u);
    expect(accessState).not.toContain("project_id");
    expect(accessState).not.toContain("quota_bytes");
    expect(transition).not.toContain("project_id");
    expect(transition).toContain("PRIMARY KEY (user_id, access_generation)");
    expect(transition).toContain(
      "requested_by_platform_admin_user_id uuid NOT NULL",
    );
  });

  it("pins every host allocation to the canonical non-reserving policy", () => {
    expect(migration).toContain("'user-sandbox-v1'");
    expect(migration).toContain("'/srv/brai-user-data'");
    expect(migration).toMatch(
      /VALUES \(\s*'user-sandbox-v1',\s*'\/srv\/brai-user-data',\s*1879048192,\s*131072,\s*1000,\s*65536,\s*65536,\s*10000\s*\)/u,
    );
    expect(migration).toContain(
      "storage_path = '/srv/brai-user-data/' || environment_name",
    );
    expect(migration).toContain(
      "outer_id_range_start =\n          1879048192 + allocation_slot * 131072",
    );
    expect(migration).toContain("quota_project_id = 10000 + allocation_slot");
    expect(migration).toContain("'0123456789abcdefghijklmnopqrstuvwxyz'");
    expect(migration).not.toContain("/srv/agent-users");
    expect(migration).not.toMatch(/reserv(?:e|ed|ation)_bytes/iu);
    expect(migration).toContain("storage_device text");
    expect(migration).toContain("project_inheritance boolean");
    expect(migration).toContain("quota_enforcement_active boolean");
    expect(migration).toContain("image_sha256 text");
    expect(migration).toContain("host_provisioned_at timestamptz");
    expect(migration).toContain(
      "environment identity and configured quota are immutable",
    );
    expect(migration).toContain(
      "environment reservation is immutable until a future verified teardown",
    );
    expect(migration).toContain(
      "environment reservation cannot be deleted or reused without verified teardown",
    );
    expect(migration).toContain(
      "BEFORE INSERT OR UPDATE OR DELETE ON brai_access.user_environments",
    );
  });

  it("makes run snapshots immutable and runtime claims one-time", () => {
    expect(migration).toContain(
      "CHECK (profile IN ('user-sandbox', 'developer'))",
    );
    expect(migration).toContain(
      "FUNCTION brai_access.reject_agent_run_snapshot_mutation()",
    );
    expect(migration).toContain("NEW.profile IS DISTINCT FROM OLD.profile");
    expect(migration).toContain(
      "NEW.access_generation IS DISTINCT FROM OLD.access_generation",
    );
    expect(migration).toContain(
      "agent run access snapshot does not match active state",
    );
    expect(migration).toContain("NEW.profile = 'user-sandbox'");
    expect(migration).toContain("current_environment_status <> 'ready'");
    expect(migration).toContain("'starting'");
    expect(migration).toContain(
      "OLD.status = 'pending' AND NEW.status = 'starting'",
    );
    expect(migration).toContain(
      "starting run requires one-time runtime claim evidence",
    );
    expect(migration).toContain(
      "agent run runtime identity is immutable after claim",
    );
    expect(migration).toContain(
      "running run requires exact runtime started evidence",
    );
    expect(migration).toContain("terminal run requires exact OS exit evidence");
    expect(migration).toContain("status IN ('succeeded', 'failed')");
    expect(migration).toContain("BEFORE INSERT OR UPDATE");
    expect(migration).toContain("invalid agent run status transition");
  });

  it("closes membership launch/revoke races at the database boundary", () => {
    const membership = tableDefinition(
      "project_memberships",
      "allocation_policies",
    );
    const runs = tableDefinition("agent_runs", "access_transition_runs");
    expect(membership).toContain("status IN ('active', 'revoking', 'revoked')");
    expect(membership).toContain("membership_generation bigint NOT NULL");
    expect(runs).toContain("membership_generation bigint NOT NULL");
    expect(runs).toContain("CONSTRAINT agent_runs_membership_fk");
    expect(migration).toContain(
      "agent run membership snapshot does not match active membership",
    );
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain(
      "CREATE TRIGGER enforce_project_membership_transition",
    );
    expect(migration).toContain(
      "membership cannot become revoked while project runs are live",
    );
    expect(migration).toMatch(
      /UPDATE brai_access\.agent_runs[\s\S]*?status = 'termination_requested'/u,
    );
  });

  it("captures exact all-project process identities and typed termination evidence", () => {
    const captures = tableDefinition(
      "access_transition_runs",
      "__no_later_table__",
    );
    expect(captures).toContain("project_id uuid NOT NULL");
    expect(captures).toContain("run_access_generation bigint NOT NULL");
    expect(captures).toContain("runtime_identity text");
    expect(captures).toContain(
      "PRIMARY KEY (user_id, transition_generation, run_id)",
    );
    expect(captures).toContain("termination_evidence_sha256");
    expect(captures).toContain("termination_kind = 'cancelled_before_start'");
    expect(captures).toContain("termination_kind = 'process_tree_killed'");
  });

  it("does not grant the service role a path to self-authorize membership", () => {
    expect(migration).toMatch(
      /GRANT SELECT\s+ON TABLE\s+brai_access\.project_memberships,\s+brai_access\.allocation_policies\s+TO brai_access_runtime;/u,
    );
    expect(migration).not.toMatch(
      /GRANT SELECT, INSERT, UPDATE[\s\S]*?project_memberships/u,
    );
    expect(migration).toContain(
      "REVOKE ALL\n  ON FUNCTION brai_access.reject_agent_run_snapshot_mutation()",
    );
  });
});
