import type { Pool, PoolClient } from "pg";

import type {
  ActiveUserAccessState,
  TransitioningUserAccessState,
} from "@brai/contracts";
import { runtimeIdentitySchema } from "@brai/contracts";

import {
  allocationReservationForSlot,
  MAX_ALLOCATION_SLOT,
  type AllocationReservation,
} from "./allocation-policy.js";
import { AccessPersistenceError } from "./errors.js";
import type {
  VerifiedEnvironmentProvisionReceipt,
  VerifiedRuntimeClaim,
  VerifiedRuntimeExitReceipt,
  VerifiedRuntimeStartedReceipt,
  VerifiedRuntimeTerminationReceipt,
} from "./trusted-context.js";
import type {
  ActiveProjectMembership,
  CapturedRuntime,
  PendingAgentRun,
  ProjectMemberRole,
  ProvisioningUserEnvironment,
  StoredAccessState,
  UserEnvironment,
} from "./types.js";

type DatabaseClient = Pick<PoolClient, "query">;

type MembershipRow = {
  role: string;
  status: string;
  membership_generation: string | number;
};

type AccessStateRow = {
  user_id: string;
  status: string;
  developer_mode: boolean;
  access_generation: string | number;
  previous_developer_mode: boolean | null;
  requested_developer_mode: boolean | null;
  previous_access_generation: string | number | null;
  quota_bytes: string | number;
  quota_inodes: string | number;
};

type EnvironmentRow = {
  user_id: string;
  environment_id: string;
  status: string;
  provision_generation: string | number;
  provision_access_generation: string | number | null;
  quota_bytes: string | number;
  quota_inodes: string | number;
  enforced_quota_bytes: string | number | null;
  enforced_quota_inodes: string | number | null;
  allocation_slot: string | number | null;
  environment_name: string | null;
  outer_id_range_start: string | number | null;
  outer_id_range_count: string | number | null;
  unix_uid: string | number | null;
  unix_gid: string | number | null;
  subuid_start: string | number | null;
  subgid_start: string | number | null;
  subid_count: string | number | null;
  quota_project_id: string | number | null;
  storage_path: string | null;
  storage_mount_point: string | null;
  storage_device: string | null;
  project_inheritance: boolean | null;
  quota_enforcement_active: boolean | null;
  image_path: string | null;
  image_sha256: string | null;
  host_provisioned_at: Date | string | null;
};

type CapturedRuntimeRow = {
  project_id: string;
  run_id: string;
  profile: string;
  environment_id: string | null;
  access_generation: string | number;
  runtime_identity: unknown | null;
};

const STATE_SELECT_COLUMNS = `
  state.user_id,
  state.status,
  state.developer_mode,
  state.access_generation,
  state.previous_developer_mode,
  state.requested_developer_mode,
  state.previous_access_generation,
  environment.quota_bytes,
  environment.quota_inodes
`;

const ENVIRONMENT_COLUMNS = `
  user_id,
  environment_id,
  status,
  provision_generation,
  provision_access_generation,
  quota_bytes,
  quota_inodes,
  enforced_quota_bytes,
  enforced_quota_inodes,
  allocation_slot,
  environment_name,
  outer_id_range_start,
  outer_id_range_count,
  unix_uid,
  unix_gid,
  subuid_start,
  subgid_start,
  subid_count,
  quota_project_id,
  storage_path,
  storage_mount_point,
  storage_device,
  project_inheritance,
  quota_enforcement_active,
  image_path,
  image_sha256,
  host_provisioned_at
`;

function safeInteger(value: string | number, field: string): number {
  const converted = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(converted)) {
    throw new AccessPersistenceError(
      `Invalid safe integer in brai-access column ${field}`,
    );
  }
  return converted;
}

function nullableSafeInteger(
  value: string | number | null,
  field: string,
): number | null {
  return value === null ? null : safeInteger(value, field);
}

function nullableTimestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new AccessPersistenceError(
      "Invalid timestamp in brai-access environment row",
    );
  }
  return date.toISOString();
}

function jsonbDocument(value: unknown): string {
  const document = JSON.stringify(value);
  if (document === undefined) {
    throw new AccessPersistenceError("Unable to serialize typed receipt");
  }
  return document;
}

function accessStateFrom(row: AccessStateRow): StoredAccessState {
  if (row.status !== "active" && row.status !== "transitioning") {
    throw new AccessPersistenceError("Invalid brai-access state status");
  }

  return Object.freeze({
    userId: row.user_id,
    status: row.status,
    developerMode: row.developer_mode,
    accessGeneration: safeInteger(row.access_generation, "access_generation"),
    previousDeveloperMode: row.previous_developer_mode,
    requestedDeveloperMode: row.requested_developer_mode,
    previousAccessGeneration: nullableSafeInteger(
      row.previous_access_generation,
      "previous_access_generation",
    ),
    quota: Object.freeze({
      bytes: safeInteger(row.quota_bytes, "quota_bytes"),
      inodes: safeInteger(row.quota_inodes, "quota_inodes"),
    }),
  });
}

function environmentFrom(row: EnvironmentRow): UserEnvironment {
  if (
    row.status !== "unprovisioned" &&
    row.status !== "provisioning" &&
    row.status !== "ready" &&
    row.status !== "failed"
  ) {
    throw new AccessPersistenceError("Invalid user environment status");
  }

  const enforcedQuota =
    row.enforced_quota_bytes === null && row.enforced_quota_inodes === null
      ? null
      : Object.freeze({
          bytes: safeInteger(
            row.enforced_quota_bytes ?? Number.NaN,
            "enforced_quota_bytes",
          ),
          inodes: safeInteger(
            row.enforced_quota_inodes ?? Number.NaN,
            "enforced_quota_inodes",
          ),
        });

  return Object.freeze({
    userId: row.user_id,
    environmentId: row.environment_id,
    status: row.status,
    provisionGeneration: safeInteger(
      row.provision_generation,
      "provision_generation",
    ),
    provisionAccessGeneration: nullableSafeInteger(
      row.provision_access_generation,
      "provision_access_generation",
    ),
    quota: Object.freeze({
      bytes: safeInteger(row.quota_bytes, "quota_bytes"),
      inodes: safeInteger(row.quota_inodes, "quota_inodes"),
    }),
    enforcedQuota,
    allocationSlot: nullableSafeInteger(row.allocation_slot, "allocation_slot"),
    environmentName: row.environment_name,
    outerIdRangeStart: nullableSafeInteger(
      row.outer_id_range_start,
      "outer_id_range_start",
    ),
    outerIdRangeCount: nullableSafeInteger(
      row.outer_id_range_count,
      "outer_id_range_count",
    ),
    unixUid: nullableSafeInteger(row.unix_uid, "unix_uid"),
    unixGid: nullableSafeInteger(row.unix_gid, "unix_gid"),
    subuidStart: nullableSafeInteger(row.subuid_start, "subuid_start"),
    subgidStart: nullableSafeInteger(row.subgid_start, "subgid_start"),
    subidCount: nullableSafeInteger(row.subid_count, "subid_count"),
    quotaProjectId: nullableSafeInteger(
      row.quota_project_id,
      "quota_project_id",
    ),
    storagePath: row.storage_path,
    storageMountPoint: row.storage_mount_point,
    storageDevice: row.storage_device,
    projectInheritance: row.project_inheritance,
    quotaEnforcementActive: row.quota_enforcement_active,
    imagePath: row.image_path,
    imageSha256: row.image_sha256,
    hostProvisionedAt: nullableTimestamp(row.host_provisioned_at),
  });
}

function assertEnvironmentReservation(
  environment: UserEnvironment,
  reservation: AllocationReservation,
): void {
  if (
    environment.allocationSlot !== reservation.allocationSlot ||
    environment.environmentName !== reservation.environmentName ||
    environment.outerIdRangeStart !== reservation.outerIdRangeStart ||
    environment.outerIdRangeCount !== reservation.outerIdRangeCount ||
    environment.unixUid !== reservation.unixUid ||
    environment.unixGid !== reservation.unixGid ||
    environment.subuidStart !== reservation.subuidStart ||
    environment.subgidStart !== reservation.subgidStart ||
    environment.subidCount !== reservation.subidCount ||
    environment.quotaProjectId !== reservation.quotaProjectId ||
    environment.storagePath !== reservation.storagePath ||
    environment.storageMountPoint !== reservation.storageMountPoint
  ) {
    throw new AccessPersistenceError(
      "Persisted environment reservation does not match canonical allocation policy",
    );
  }
}

function provisioningEnvironmentFrom(
  row: EnvironmentRow,
): ProvisioningUserEnvironment {
  const environment = environmentFrom(row);
  if (
    environment.status !== "provisioning" ||
    environment.provisionGeneration < 1 ||
    environment.provisionAccessGeneration === null ||
    environment.allocationSlot === null
  ) {
    throw new AccessPersistenceError(
      "Provisioning environment is missing its durable reservation",
    );
  }
  const reservation = allocationReservationForSlot(environment.allocationSlot);
  assertEnvironmentReservation(environment, reservation);
  return environment as ProvisioningUserEnvironment;
}

function capturedRuntimeFrom(row: CapturedRuntimeRow): CapturedRuntime {
  if (row.profile !== "developer" && row.profile !== "user-sandbox") {
    throw new AccessPersistenceError(
      "Invalid access profile in captured runtime",
    );
  }
  if (
    (row.profile === "developer" && row.environment_id !== null) ||
    (row.profile === "user-sandbox" && row.environment_id === null)
  ) {
    throw new AccessPersistenceError(
      "Captured runtime profile does not match its environment binding",
    );
  }
  const runtimeIdentity =
    row.runtime_identity === null
      ? null
      : runtimeIdentitySchema.safeParse(row.runtime_identity);
  if (runtimeIdentity !== null && !runtimeIdentity.success) {
    throw new AccessPersistenceError(
      "Invalid typed runtime identity in brai-access row",
    );
  }
  return Object.freeze({
    projectId: row.project_id,
    runId: row.run_id,
    profile: row.profile,
    environmentId: row.environment_id,
    accessGeneration: safeInteger(row.access_generation, "access_generation"),
    runtimeIdentity: runtimeIdentity === null ? null : runtimeIdentity.data,
  });
}

function memberRoleFrom(value: string): ProjectMemberRole {
  if (value === "owner" || value === "admin" || value === "member") {
    return value;
  }
  throw new AccessPersistenceError("Invalid brai-access membership role");
}

export interface AccessStoreTransaction {
  lockUserAccess(userId: string): Promise<void>;
  getActiveMembership(
    projectId: string,
    userId: string,
  ): Promise<ActiveProjectMembership | null>;
  getAccessStateForUpdate(userId: string): Promise<StoredAccessState | null>;
  createInitialAccessState(
    state: ActiveUserAccessState,
  ): Promise<StoredAccessState>;
  listLiveRunsForUpdate(userId: string): Promise<readonly CapturedRuntime[]>;
  requestRunTermination(
    userId: string,
    runId: string,
  ): Promise<CapturedRuntime>;
  persistTransition(
    requestedByPlatformAdminUserId: string,
    transition: TransitioningUserAccessState,
    capturedRuns: readonly CapturedRuntime[],
  ): Promise<void>;
  getTransitionRunsForUpdate(
    userId: string,
    accessGeneration: number,
  ): Promise<readonly CapturedRuntime[]>;
  persistTransitionCompletion(
    next: ActiveUserAccessState,
    receipts: readonly VerifiedRuntimeTerminationReceipt[],
  ): Promise<void>;
  ensureUserEnvironment(
    userId: string,
    candidateEnvironmentId: string,
  ): Promise<UserEnvironment>;
  markUserEnvironmentProvisioning(
    userId: string,
    accessGeneration: number,
  ): Promise<ProvisioningUserEnvironment>;
  markUserEnvironmentReady(
    receipt: VerifiedEnvironmentProvisionReceipt,
  ): Promise<UserEnvironment>;
  claimPendingRun(claim: VerifiedRuntimeClaim): Promise<void>;
  markClaimedRunRunning(receipt: VerifiedRuntimeStartedReceipt): Promise<void>;
  markClaimedRunExited(receipt: VerifiedRuntimeExitReceipt): Promise<void>;
  isRuntimeReceiptApplied(
    kind: "claim" | "started" | "exit",
    receipt:
      | VerifiedRuntimeClaim
      | VerifiedRuntimeStartedReceipt
      | VerifiedRuntimeExitReceipt,
  ): Promise<boolean>;
  persistRequestedRunTermination(
    receipt: VerifiedRuntimeTerminationReceipt,
  ): Promise<void>;
  insertPendingRun(run: PendingAgentRun): Promise<void>;
}

export interface AccessStoreRepository {
  transaction<T>(
    operation: (transaction: AccessStoreTransaction) => Promise<T>,
  ): Promise<T>;
}

export class PostgresAccessStoreTransaction implements AccessStoreTransaction {
  public constructor(private readonly client: DatabaseClient) {}

  public async lockUserAccess(userId: string): Promise<void> {
    await this.client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`brai-access-environment:${userId}`],
    );
  }

  public async getActiveMembership(
    projectId: string,
    userId: string,
  ): Promise<ActiveProjectMembership | null> {
    const result = await this.client.query<MembershipRow>(
      `
        SELECT role, status, membership_generation
        FROM brai_access.project_memberships
        WHERE project_id = $1 AND user_id = $2
      `,
      [projectId, userId],
    );
    const row = result.rows[0];
    if (!row || row.status !== "active") return null;
    return Object.freeze({
      role: memberRoleFrom(row.role),
      membershipGeneration: safeInteger(
        row.membership_generation,
        "membership_generation",
      ),
    });
  }

  public async getAccessStateForUpdate(
    userId: string,
  ): Promise<StoredAccessState | null> {
    const result = await this.client.query<AccessStateRow>(
      `
        SELECT ${STATE_SELECT_COLUMNS}
        FROM brai_access.user_access_states AS state
        JOIN brai_access.user_environments AS environment
          ON environment.user_id = state.user_id
        WHERE state.user_id = $1
        FOR UPDATE OF state, environment
      `,
      [userId],
    );
    const row = result.rows[0];
    return row ? accessStateFrom(row) : null;
  }

  public async createInitialAccessState(
    state: ActiveUserAccessState,
  ): Promise<StoredAccessState> {
    const result = await this.client.query<{ user_id: string }>(
      `
        INSERT INTO brai_access.user_access_states (
          user_id,
          status,
          developer_mode,
          access_generation
        )
        VALUES ($1, 'active', $2, $3)
        RETURNING user_id
      `,
      [state.user_id, state.developer_mode, state.access_generation],
    );
    const row = result.rows[0];
    if (!row) {
      throw new AccessPersistenceError("Unable to create access state");
    }
    return Object.freeze({
      userId: state.user_id,
      status: "active",
      developerMode: state.developer_mode,
      accessGeneration: state.access_generation,
      previousDeveloperMode: null,
      requestedDeveloperMode: null,
      previousAccessGeneration: null,
      quota: state.quota,
    });
  }

  public async listLiveRunsForUpdate(
    userId: string,
  ): Promise<readonly CapturedRuntime[]> {
    const result = await this.client.query<CapturedRuntimeRow>(
      `
        SELECT
          project_id,
          run_id,
          profile,
          environment_id,
          access_generation,
          runtime_identity
        FROM brai_access.agent_runs
        WHERE user_id = $1
          AND status IN (
            'pending',
            'starting',
            'running',
            'termination_requested'
          )
        ORDER BY project_id ASC, run_id ASC
        FOR UPDATE
      `,
      [userId],
    );
    return Object.freeze(result.rows.map(capturedRuntimeFrom));
  }

  public async requestRunTermination(
    userId: string,
    runId: string,
  ): Promise<CapturedRuntime> {
    const result = await this.client.query<CapturedRuntimeRow>(
      `
        UPDATE brai_access.agent_runs
        SET
          status = 'termination_requested',
          termination_requested_at =
            COALESCE(termination_requested_at, clock_timestamp())
        WHERE user_id = $1
          AND run_id = $2
          AND status IN (
            'pending',
            'starting',
            'running',
            'termination_requested'
          )
        RETURNING
          project_id,
          run_id,
          profile,
          environment_id,
          access_generation,
          runtime_identity
      `,
      [userId, runId],
    );
    const row = result.rows[0];
    if (result.rowCount !== 1 || row === undefined) {
      throw new AccessPersistenceError(
        "Run is no longer eligible for dispatch-failure termination",
      );
    }
    return capturedRuntimeFrom(row);
  }

  public async persistTransition(
    requestedByPlatformAdminUserId: string,
    transition: TransitioningUserAccessState,
    capturedRuns: readonly CapturedRuntime[],
  ): Promise<void> {
    const updated = await this.client.query(
      `
        UPDATE brai_access.user_access_states
        SET
          status = 'transitioning',
          access_generation = $2,
          previous_developer_mode = $3,
          requested_developer_mode = $4,
          previous_access_generation = $5,
          updated_at = clock_timestamp()
        WHERE user_id = $1
          AND status = 'active'
          AND developer_mode = $3
          AND access_generation = $5
      `,
      [
        transition.user_id,
        transition.access_generation,
        transition.previous_developer_mode,
        transition.requested_developer_mode,
        transition.previous_access_generation,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new AccessPersistenceError(
        "Access state changed during transition",
      );
    }

    await this.client.query(
      `
        INSERT INTO brai_access.access_transitions (
          user_id,
          access_generation,
          requested_by_platform_admin_user_id,
          previous_developer_mode,
          requested_developer_mode,
          previous_access_generation,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'terminating')
      `,
      [
        transition.user_id,
        transition.access_generation,
        requestedByPlatformAdminUserId,
        transition.previous_developer_mode,
        transition.requested_developer_mode,
        transition.previous_access_generation,
      ],
    );

    for (const captured of capturedRuns) {
      await this.client.query(
        `
          INSERT INTO brai_access.access_transition_runs (
            user_id,
            transition_generation,
            project_id,
            run_id,
            run_access_generation,
            runtime_identity
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        `,
        [
          transition.user_id,
          transition.access_generation,
          captured.projectId,
          captured.runId,
          captured.accessGeneration,
          captured.runtimeIdentity === null
            ? null
            : jsonbDocument(captured.runtimeIdentity),
        ],
      );

      const requested = await this.client.query(
        `
          UPDATE brai_access.agent_runs
          SET status = 'termination_requested',
              termination_requested_at = clock_timestamp()
          WHERE run_id = $1
            AND project_id = $2
            AND user_id = $3
            AND access_generation = $4
            AND status IN (
              'pending',
              'starting',
              'running',
              'termination_requested'
            )
        `,
        [
          captured.runId,
          captured.projectId,
          transition.user_id,
          captured.accessGeneration,
        ],
      );
      if (requested.rowCount !== 1) {
        throw new AccessPersistenceError(
          "Live run changed while transition was being persisted",
        );
      }
    }
  }

  public async getTransitionRunsForUpdate(
    userId: string,
    accessGeneration: number,
  ): Promise<readonly CapturedRuntime[]> {
    const result = await this.client.query<CapturedRuntimeRow>(
      `
        SELECT
          transition_run.project_id,
          transition_run.run_id,
          run.profile,
          run.environment_id,
          transition_run.run_access_generation AS access_generation,
          transition_run.runtime_identity
        FROM brai_access.access_transition_runs AS transition_run
        JOIN brai_access.agent_runs AS run
          ON run.project_id = transition_run.project_id
         AND run.run_id = transition_run.run_id
         AND run.user_id = transition_run.user_id
         AND run.access_generation =
           transition_run.run_access_generation
        WHERE transition_run.user_id = $1
          AND transition_run.transition_generation = $2
        ORDER BY transition_run.project_id ASC, transition_run.run_id ASC
        FOR UPDATE OF transition_run
      `,
      [userId, accessGeneration],
    );
    return Object.freeze(result.rows.map(capturedRuntimeFrom));
  }

  public async persistTransitionCompletion(
    next: ActiveUserAccessState,
    receipts: readonly VerifiedRuntimeTerminationReceipt[],
  ): Promise<void> {
    for (const receipt of receipts) {
      const terminated = await this.client.query(
        `
          UPDATE brai_access.agent_runs
          SET
            status = 'terminated',
            termination_kind = $6,
            termination_receipt = $7::jsonb,
            terminated_at = $8::timestamptz
          WHERE run_id = $1
            AND project_id = $2
            AND user_id = $3
            AND access_generation = $4
            AND runtime_identity IS NOT DISTINCT FROM $5::jsonb
            AND status = 'termination_requested'
        `,
        [
          receipt.runId,
          receipt.projectId,
          next.user_id,
          receipt.accessGeneration,
          receipt.runtimeIdentity === null
            ? null
            : jsonbDocument(receipt.runtimeIdentity),
          receipt.kind,
          jsonbDocument(receipt),
          receipt.terminatedAt,
        ],
      );
      if (terminated.rowCount !== 1) {
        throw new AccessPersistenceError(
          "OS termination receipt does not match a terminating process tree",
        );
      }

      const recorded = await this.client.query(
        `
          UPDATE brai_access.access_transition_runs
          SET
            termination_kind = $7,
            termination_receipt = $8::jsonb,
            terminated_at = $9::timestamptz
          WHERE user_id = $1
            AND transition_generation = $2
            AND project_id = $3
            AND run_id = $4
            AND run_access_generation = $5
            AND runtime_identity IS NOT DISTINCT FROM $6::jsonb
            AND terminated_at IS NULL
        `,
        [
          next.user_id,
          next.access_generation,
          receipt.projectId,
          receipt.runId,
          receipt.accessGeneration,
          receipt.runtimeIdentity === null
            ? null
            : jsonbDocument(receipt.runtimeIdentity),
          receipt.kind,
          jsonbDocument(receipt),
          receipt.terminatedAt,
        ],
      );
      if (recorded.rowCount !== 1) {
        throw new AccessPersistenceError(
          "Termination receipt was already used or is not captured",
        );
      }
    }

    const completed = await this.client.query(
      `
        UPDATE brai_access.access_transitions
        SET status = 'completed', completed_at = clock_timestamp()
        WHERE user_id = $1
          AND access_generation = $2
          AND status = 'terminating'
      `,
      [next.user_id, next.access_generation],
    );
    if (completed.rowCount !== 1) {
      throw new AccessPersistenceError("Access transition is not terminating");
    }

    const activated = await this.client.query(
      `
        UPDATE brai_access.user_access_states
        SET
          status = 'active',
          developer_mode = $3,
          previous_developer_mode = NULL,
          requested_developer_mode = NULL,
          previous_access_generation = NULL,
          updated_at = clock_timestamp()
        WHERE user_id = $1
          AND status = 'transitioning'
          AND access_generation = $2
      `,
      [next.user_id, next.access_generation, next.developer_mode],
    );
    if (activated.rowCount !== 1) {
      throw new AccessPersistenceError("Unable to activate transitioned state");
    }
  }

  public async ensureUserEnvironment(
    userId: string,
    candidateEnvironmentId: string,
  ): Promise<UserEnvironment> {
    const inserted = await this.client.query<EnvironmentRow>(
      `
        INSERT INTO brai_access.user_environments (user_id, environment_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO NOTHING
        RETURNING ${ENVIRONMENT_COLUMNS}
      `,
      [userId, candidateEnvironmentId],
    );
    const insertedRow = inserted.rows[0];
    if (insertedRow) {
      return environmentFrom(insertedRow);
    }

    const existing = await this.client.query<EnvironmentRow>(
      `
        SELECT ${ENVIRONMENT_COLUMNS}
        FROM brai_access.user_environments
        WHERE user_id = $1
        FOR UPDATE
      `,
      [userId],
    );
    const existingRow = existing.rows[0];
    if (!existingRow) {
      throw new AccessPersistenceError("Unable to resolve user environment");
    }
    return environmentFrom(existingRow);
  }

  public async markUserEnvironmentProvisioning(
    userId: string,
    accessGeneration: number,
  ): Promise<ProvisioningUserEnvironment> {
    await this.client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["brai-access:environment-allocation"],
    );

    const currentResult = await this.client.query<EnvironmentRow>(
      `
        SELECT ${ENVIRONMENT_COLUMNS}
        FROM brai_access.user_environments
        WHERE user_id = $1
        FOR UPDATE
      `,
      [userId],
    );
    const currentRow = currentResult.rows[0];
    if (!currentRow) {
      throw new AccessPersistenceError("User environment does not exist");
    }
    const current = environmentFrom(currentRow);
    if (
      current.status !== "unprovisioned" &&
      current.status !== "provisioning" &&
      current.status !== "failed"
    ) {
      throw new AccessPersistenceError(
        "Environment cannot enter provisioning from its current state",
      );
    }

    let reservation: AllocationReservation;
    if (current.allocationSlot === null) {
      const candidateResult = await this.client.query<{
        allocation_slot: string | number;
      }>(
        `
          SELECT candidate.allocation_slot
          FROM generate_series(
            0::bigint,
            $1::bigint
          ) AS candidate(allocation_slot)
          WHERE NOT EXISTS (
            SELECT 1
            FROM brai_access.user_environments AS reserved
            WHERE reserved.allocation_slot = candidate.allocation_slot
          )
          ORDER BY candidate.allocation_slot ASC
          LIMIT 1
        `,
        [MAX_ALLOCATION_SLOT],
      );
      const candidate = candidateResult.rows[0];
      if (!candidate) {
        throw new AccessPersistenceError(
          "No environment allocation slots are available",
        );
      }
      reservation = allocationReservationForSlot(
        safeInteger(candidate.allocation_slot, "allocation_slot"),
      );
    } else {
      reservation = allocationReservationForSlot(current.allocationSlot);
      assertEnvironmentReservation(current, reservation);
    }

    const result = await this.client.query<EnvironmentRow>(
      `
        UPDATE brai_access.user_environments
        SET
          status = 'provisioning',
          provision_generation = provision_generation + 1,
          provision_access_generation = $2,
          allocation_slot = $3,
          environment_name = $4,
          outer_id_range_start = $5,
          outer_id_range_count = $6,
          unix_uid = $7,
          unix_gid = $8,
          subuid_start = $9,
          subgid_start = $10,
          subid_count = $11,
          quota_project_id = $12,
          storage_path = $13,
          storage_mount_point = $14,
          updated_at = clock_timestamp()
        WHERE user_id = $1
          AND status IN ('unprovisioned', 'provisioning', 'failed')
        RETURNING ${ENVIRONMENT_COLUMNS}
      `,
      [
        userId,
        accessGeneration,
        reservation.allocationSlot,
        reservation.environmentName,
        reservation.outerIdRangeStart,
        reservation.outerIdRangeCount,
        reservation.unixUid,
        reservation.unixGid,
        reservation.subuidStart,
        reservation.subgidStart,
        reservation.subidCount,
        reservation.quotaProjectId,
        reservation.storagePath,
        reservation.storageMountPoint,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new AccessPersistenceError(
        "Environment cannot enter provisioning from its current state",
      );
    }
    return provisioningEnvironmentFrom(row);
  }

  public async markUserEnvironmentReady(
    receipt: VerifiedEnvironmentProvisionReceipt,
  ): Promise<UserEnvironment> {
    const result = await this.client.query<EnvironmentRow>(
      `
        UPDATE brai_access.user_environments
        SET
          status = 'ready',
          storage_device = $17,
          project_inheritance = $18,
          quota_enforcement_active = $19,
          image_path = $20,
          image_sha256 = $21,
          host_provisioned_at = $22::timestamptz,
          enforced_quota_bytes = $23,
          enforced_quota_inodes = $24,
          provision_receipt_sha256 = $25,
          ready_at = clock_timestamp(),
          updated_at = clock_timestamp()
        FROM brai_access.allocation_policies AS policy
        WHERE user_id = $1
          AND environment_id = $2
          AND provision_generation = $3
          AND provision_access_generation = $4
          AND status = 'provisioning'
          AND policy.policy_id = 'user-sandbox-v1'
          AND allocation_slot = $5
          AND environment_name = $6
          AND outer_id_range_start = $7
          AND outer_id_range_count = $8
          AND unix_uid = $9
          AND unix_gid = $10
          AND subuid_start = $11
          AND subgid_start = $12
          AND subid_count = $13
          AND quota_project_id = $14
          AND storage_path = $15
          AND storage_mount_point = $16
          AND EXISTS (
            SELECT 1
            FROM brai_access.user_access_states AS state
            WHERE state.user_id = $1
              AND state.status = 'active'
              AND state.access_generation = $4
          )
          AND $7 = policy.outer_id_range_base
            + $5 * policy.outer_id_range_size
          AND $8 = policy.outer_id_range_size
          AND $9 = $7 + policy.image_brai_id
          AND $10 = $7 + policy.image_brai_id
          AND $11 = $7 + policy.inner_subordinate_offset
          AND $12 = $7 + policy.inner_subordinate_offset
          AND $13 = policy.inner_subordinate_range_size
          AND $14 = policy.xfs_project_id_base + $5
          AND $15 = policy.storage_root || '/' || $6
          AND $16 = policy.storage_root
          AND $18 IS TRUE
          AND $19 IS TRUE
          AND quota_bytes = $23
          AND quota_inodes = $24
        RETURNING ${ENVIRONMENT_COLUMNS}
      `,
      [
        receipt.userId,
        receipt.environmentId,
        receipt.provisionGeneration,
        receipt.accessGeneration,
        receipt.allocationSlot,
        receipt.environmentName,
        receipt.outerIdRangeStart,
        receipt.outerIdRangeCount,
        receipt.unixUid,
        receipt.unixGid,
        receipt.subuidStart,
        receipt.subgidStart,
        receipt.subidCount,
        receipt.quotaProjectId,
        receipt.storagePath,
        receipt.storageMountPoint,
        receipt.storageDevice,
        receipt.projectInheritance,
        receipt.quotaEnforcementActive,
        receipt.imagePath,
        receipt.imageSha256,
        receipt.hostProvisionedAt,
        receipt.quotaBytes,
        receipt.quotaInodes,
        receipt.evidenceSha256,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new AccessPersistenceError(
        "Environment is not provisioning or receipt was already consumed",
      );
    }
    return environmentFrom(row);
  }

  public async claimPendingRun(claim: VerifiedRuntimeClaim): Promise<void> {
    const result = await this.client.query(
      `
        UPDATE brai_access.agent_runs AS run
        SET
          status = 'starting',
          runtime_identity = $10::jsonb,
          runtime_claim_receipt = $11::jsonb,
          runtime_claimed_at = clock_timestamp()
        FROM brai_access.user_access_states AS state
        WHERE run.run_id = $1
          AND run.project_id = $2
          AND run.user_id = $3
          AND run.access_generation = $4
          AND run.environment_id IS NOT DISTINCT FROM $5
          AND run.profile = $6
          AND run.runtime_host_id = $7
          AND run.job_reference = $8
          AND run.command_sha256 = $9
          AND run.status = 'pending'
          AND state.user_id = run.user_id
          AND state.status = 'active'
          AND state.access_generation = run.access_generation
      `,
      [
        claim.runId,
        claim.projectId,
        claim.userId,
        claim.accessGeneration,
        claim.environmentId,
        claim.profile,
        claim.runtimeHostId,
        claim.jobReference,
        claim.commandSha256,
        jsonbDocument(claim.runtimeIdentity),
        jsonbDocument(claim),
      ],
    );
    if (result.rowCount !== 1) {
      throw new AccessPersistenceError(
        "Pending run is stale, transitioning, or already claimed",
      );
    }
  }

  public async markClaimedRunRunning(
    receipt: VerifiedRuntimeStartedReceipt,
  ): Promise<void> {
    const result = await this.client.query(
      `
        UPDATE brai_access.agent_runs AS run
        SET
          status = 'running',
          runtime_started_receipt = $6::jsonb,
          runtime_started_at = $7::timestamptz
        FROM brai_access.user_access_states AS state
        WHERE run.run_id = $1
          AND run.project_id = $2
          AND run.user_id = $3
          AND run.access_generation = $4
          AND run.runtime_identity = $5::jsonb
          AND run.status = 'starting'
          AND state.user_id = run.user_id
          AND state.status = 'active'
          AND state.access_generation = run.access_generation
      `,
      [
        receipt.runId,
        receipt.projectId,
        receipt.userId,
        receipt.accessGeneration,
        jsonbDocument(receipt.runtimeIdentity),
        jsonbDocument(receipt),
        receipt.startedAt,
      ],
    );
    if (result.rowCount !== 1) {
      throw new AccessPersistenceError(
        "Claimed run is stale, terminating, or already started",
      );
    }
  }

  public async markClaimedRunExited(
    receipt: VerifiedRuntimeExitReceipt,
  ): Promise<void> {
    const result = await this.client.query(
      `
        UPDATE brai_access.agent_runs
        SET
          status = $6,
          exit_code = $7,
          exit_signal = $8,
          exit_receipt = $9::jsonb,
          exited_at = $10::timestamptz
        WHERE run_id = $1
          AND project_id = $2
          AND user_id = $3
          AND access_generation = $4
          AND runtime_identity = $5::jsonb
          AND status IN ('starting', 'running')
      `,
      [
        receipt.runId,
        receipt.projectId,
        receipt.userId,
        receipt.accessGeneration,
        jsonbDocument(receipt.runtimeIdentity),
        receipt.outcome,
        receipt.exitCode,
        receipt.signal,
        jsonbDocument(receipt),
        receipt.exitedAt,
      ],
    );
    if (result.rowCount !== 1) {
      throw new AccessPersistenceError(
        "Runtime exit receipt is stale or was already consumed",
      );
    }
  }

  public async isRuntimeReceiptApplied(
    kind: "claim" | "started" | "exit",
    receipt:
      | VerifiedRuntimeClaim
      | VerifiedRuntimeStartedReceipt
      | VerifiedRuntimeExitReceipt,
  ): Promise<boolean> {
    const column = {
      claim: "runtime_claim_receipt",
      started: "runtime_started_receipt",
      exit: "exit_receipt",
    }[kind];
    const result = await this.client.query<{ applied: boolean }>(
      `
        SELECT ${column} = $5::jsonb AS applied
        FROM brai_access.agent_runs
        WHERE run_id = $1
          AND project_id = $2
          AND user_id = $3
          AND access_generation = $4
      `,
      [
        receipt.runId,
        receipt.projectId,
        receipt.userId,
        receipt.accessGeneration,
        jsonbDocument(receipt),
      ],
    );
    return result.rows[0]?.applied === true;
  }

  public async persistRequestedRunTermination(
    receipt: VerifiedRuntimeTerminationReceipt,
  ): Promise<void> {
    const result = await this.client.query(
      `
        UPDATE brai_access.agent_runs
        SET
          status = 'terminated',
          termination_kind = $6,
          termination_receipt = $7::jsonb,
          terminated_at = $8::timestamptz
        WHERE run_id = $1
          AND project_id = $2
          AND user_id = $3
          AND access_generation = $4
          AND runtime_identity IS NOT DISTINCT FROM $5::jsonb
          AND status = 'termination_requested'
          AND NOT EXISTS (
            SELECT 1
            FROM brai_access.access_transition_runs AS transition_run
            JOIN brai_access.access_transitions AS transition
              ON transition.user_id = transition_run.user_id
             AND transition.access_generation =
               transition_run.transition_generation
            WHERE transition.status = 'terminating'
              AND transition_run.project_id = $2
              AND transition_run.run_id = $1
              AND transition_run.user_id = $3
              AND transition_run.run_access_generation = $4
          )
      `,
      [
        receipt.runId,
        receipt.projectId,
        receipt.userId,
        receipt.accessGeneration,
        receipt.runtimeIdentity === null
          ? null
          : jsonbDocument(receipt.runtimeIdentity),
        receipt.kind,
        jsonbDocument(receipt),
        receipt.terminatedAt,
      ],
    );
    if (result.rowCount !== 1) {
      throw new AccessPersistenceError(
        "Termination receipt is stale, mismatched, or already consumed",
      );
    }
  }

  public async insertPendingRun(run: PendingAgentRun): Promise<void> {
    const inserted = await this.client.query(
      `
        INSERT INTO brai_access.agent_runs (
          run_id,
          project_id,
          user_id,
          environment_id,
          profile,
          runtime_host_id,
          job_reference,
          command_sha256,
          access_generation,
          membership_generation,
          quota_bytes,
          quota_inodes,
          status
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending'
        )
      `,
      [
        run.runId,
        run.projectId,
        run.userId,
        run.environmentId,
        run.profile,
        run.runtimeHostId,
        run.jobReference,
        run.commandSha256,
        run.accessGeneration,
        run.membershipGeneration,
        run.quota.bytes,
        run.quota.inodes,
      ],
    );
    if (inserted.rowCount !== 1) {
      throw new AccessPersistenceError("Unable to insert pending run");
    }
  }
}

export class PostgresAccessStoreRepository implements AccessStoreRepository {
  public constructor(private readonly pool: Pick<Pool, "connect">) {}

  public async transaction<T>(
    operation: (transaction: AccessStoreTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await operation(
        new PostgresAccessStoreTransaction(client),
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
