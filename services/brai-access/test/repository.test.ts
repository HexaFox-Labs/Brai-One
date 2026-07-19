import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  BRAI_SINGLE_RUNTIME_HOST_ID,
  RUNTIME_IDENTITY_SCHEMA_VERSION,
  type EmptyCgroupProof,
  type RuntimeIdentity,
} from "@brai/contracts";

import { allocationReservationForSlot } from "../src/allocation-policy.js";
import {
  PostgresAccessStoreRepository,
  PostgresAccessStoreTransaction,
} from "../src/repository.js";
import {
  trustedProvisioningContextFromServer,
  trustedRuntimeContextFromServer,
  verifiedEnvironmentProvisionReceiptFromHost,
  verifiedRuntimeClaimFromController,
  verifiedRuntimeExitReceiptFromController,
  verifiedRuntimeStartedReceiptFromController,
} from "../src/trusted-adapter.js";

const PROJECT_ONE = "1f88bde1-2b49-46cb-914d-7500afdf82d6";
const PROJECT_TWO = "2f88bde1-2b49-46cb-914d-7500afdf82d6";
const USER_ID = "3f88bde1-2b49-46cb-914d-7500afdf82d6";
const RUN_ID = "4f88bde1-2b49-46cb-914d-7500afdf82d6";
const ENVIRONMENT_ID = "5f88bde1-2b49-46cb-914d-7500afdf82d6";
const RUNTIME_IDENTITY = Object.freeze({
  schema_version: RUNTIME_IDENTITY_SCHEMA_VERSION,
  profile: "user-sandbox",
  runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
  boot_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  systemd_invocation_id: "a".repeat(32),
  unit: "brai-run.service",
  cgroup_path:
    "/machine.slice/machine-brai-u-1.scope/agent.slice/brai-run.service",
  cgroup_inode: 42_001,
  leader_pid: 12_345,
  leader_start_time_ticks: 987_654,
  machine: "brai-u-1",
}) satisfies RuntimeIdentity;
const EMPTY_CGROUP_PROOF = Object.freeze({
  observed_at: "2026-07-17T03:05:00.000Z",
  boot_id: RUNTIME_IDENTITY.boot_id,
  systemd_invocation_id: RUNTIME_IDENTITY.systemd_invocation_id,
  unit: RUNTIME_IDENTITY.unit,
  cgroup_path: RUNTIME_IDENTITY.cgroup_path,
  cgroup_inode: RUNTIME_IDENTITY.cgroup_inode,
  populated: false,
  leader_present: false,
}) satisfies EmptyCgroupProof;
const JOB_REFERENCE = `brai-job:${RUN_ID}`;
const COMMAND_SHA256 = "c".repeat(64);

function clientFrom(query: ReturnType<typeof vi.fn>): PoolClient {
  return {
    query,
    release: vi.fn(),
  } as unknown as PoolClient;
}

function normalizeSql(sql: unknown): string {
  return String(sql).replace(/\s+/gu, " ").trim();
}

function environmentRow(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    user_id: USER_ID,
    environment_id: ENVIRONMENT_ID,
    status: "unprovisioned",
    provision_generation: "0",
    provision_access_generation: null,
    quota_bytes: "5368709120",
    quota_inodes: "500000",
    enforced_quota_bytes: null,
    enforced_quota_inodes: null,
    allocation_slot: null,
    environment_name: null,
    outer_id_range_start: null,
    outer_id_range_count: null,
    unix_uid: null,
    unix_gid: null,
    subuid_start: null,
    subgid_start: null,
    subid_count: null,
    quota_project_id: null,
    storage_path: null,
    storage_mount_point: null,
    storage_device: null,
    project_inheritance: null,
    quota_enforcement_active: null,
    image_path: null,
    image_sha256: null,
    host_provisioned_at: null,
    ...overrides,
  };
}

function reservedEnvironmentRow(
  slot: number,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  const reservation = allocationReservationForSlot(slot);
  return environmentRow({
    status: "provisioning",
    provision_generation: "1",
    provision_access_generation: "1",
    allocation_slot: String(reservation.allocationSlot),
    environment_name: reservation.environmentName,
    outer_id_range_start: String(reservation.outerIdRangeStart),
    outer_id_range_count: String(reservation.outerIdRangeCount),
    unix_uid: String(reservation.unixUid),
    unix_gid: String(reservation.unixGid),
    subuid_start: String(reservation.subuidStart),
    subgid_start: String(reservation.subgidStart),
    subid_count: String(reservation.subidCount),
    quota_project_id: String(reservation.quotaProjectId),
    storage_path: reservation.storagePath,
    storage_mount_point: reservation.storageMountPoint,
    ...overrides,
  });
}

describe("PostgresAccessStoreRepository transaction boundary", () => {
  it("commits exactly one transaction on success", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: null });
    const client = clientFrom(query);
    const repository = new PostgresAccessStoreRepository({
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pick<Pool, "connect">);

    await expect(repository.transaction(async () => "committed")).resolves.toBe(
      "committed",
    );

    expect(query.mock.calls.map((call) => call[0])).toEqual([
      "BEGIN",
      "COMMIT",
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases on failure", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: null });
    const client = clientFrom(query);
    const repository = new PostgresAccessStoreRepository({
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pick<Pool, "connect">);

    await expect(
      repository.transaction(async () => {
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");

    expect(query.mock.calls.map((call) => call[0])).toEqual([
      "BEGIN",
      "ROLLBACK",
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe("PostgresAccessStoreTransaction global locking", () => {
  it("reads an active membership generation for the trigger-locked launch CAS", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ role: "member", status: "active", membership_generation: "7" }],
      rowCount: 1,
    });
    const transaction = new PostgresAccessStoreTransaction(clientFrom(query));
    await expect(
      transaction.getActiveMembership(PROJECT_ONE, USER_ID),
    ).resolves.toEqual({ role: "member", membershipGeneration: 7 });
    expect(query.mock.calls[0]?.[1]).toEqual([PROJECT_ONE, USER_ID]);
  });

  it("locks one global user state and its global quota row", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          user_id: USER_ID,
          status: "active",
          developer_mode: false,
          access_generation: "1",
          previous_developer_mode: null,
          requested_developer_mode: null,
          previous_access_generation: null,
          quota_bytes: "5368709120",
          quota_inodes: "500000",
        },
      ],
      rowCount: 1,
    });
    const transaction = new PostgresAccessStoreTransaction(clientFrom(query));

    await expect(
      transaction.getAccessStateForUpdate(USER_ID),
    ).resolves.toMatchObject({
      userId: USER_ID,
      status: "active",
      accessGeneration: 1,
      quota: { bytes: 5_368_709_120, inodes: 500_000 },
    });

    const sql = normalizeSql(query.mock.calls[0]?.[0]);
    expect(sql).toContain("FROM brai_access.user_access_states AS state");
    expect(sql).toContain("JOIN brai_access.user_environments AS environment");
    expect(sql).toContain("WHERE state.user_id = $1");
    expect(sql).toContain("FOR UPDATE OF state, environment");
    expect(query.mock.calls[0]?.[1]).toEqual([USER_ID]);
  });

  it("locks and orders all live runs across every project", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          project_id: PROJECT_ONE,
          run_id: RUN_ID,
          profile: "user-sandbox",
          environment_id: ENVIRONMENT_ID,
          access_generation: "1",
          runtime_identity: null,
        },
        {
          project_id: PROJECT_TWO,
          run_id: "5f88bde1-2b49-46cb-914d-7500afdf82d6",
          profile: "user-sandbox",
          environment_id: ENVIRONMENT_ID,
          access_generation: "1",
          runtime_identity: RUNTIME_IDENTITY,
        },
      ],
      rowCount: 2,
    });
    const transaction = new PostgresAccessStoreTransaction(clientFrom(query));

    await expect(
      transaction.listLiveRunsForUpdate(USER_ID),
    ).resolves.toMatchObject([
      { projectId: PROJECT_ONE, runtimeIdentity: null },
      { projectId: PROJECT_TWO, runtimeIdentity: RUNTIME_IDENTITY },
    ]);

    const sql = normalizeSql(query.mock.calls[0]?.[0]);
    expect(sql).toContain("WHERE user_id = $1");
    expect(sql).toContain(
      "status IN ( 'pending', 'starting', 'running', 'termination_requested' )",
    );
    expect(sql).toContain("ORDER BY project_id ASC, run_id ASC");
    expect(sql).toContain("FOR UPDATE");
    expect(query.mock.calls[0]?.[1]).toEqual([USER_ID]);
  });

  it("atomically captures the exact run before dispatch-failure termination", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          project_id: PROJECT_ONE,
          run_id: RUN_ID,
          profile: "user-sandbox",
          environment_id: ENVIRONMENT_ID,
          access_generation: "1",
          runtime_identity: RUNTIME_IDENTITY,
        },
      ],
      rowCount: 1,
    });
    const transaction = new PostgresAccessStoreTransaction(clientFrom(query));

    await expect(
      transaction.requestRunTermination(USER_ID, RUN_ID),
    ).resolves.toEqual({
      projectId: PROJECT_ONE,
      runId: RUN_ID,
      profile: "user-sandbox",
      environmentId: ENVIRONMENT_ID,
      accessGeneration: 1,
      runtimeIdentity: RUNTIME_IDENTITY,
    });
    const sql = normalizeSql(query.mock.calls[0]?.[0]);
    expect(sql).toContain("status = 'termination_requested'");
    expect(sql).toContain(
      "status IN ( 'pending', 'starting', 'running', 'termination_requested' )",
    );
    expect(sql).toContain("RETURNING project_id, run_id, profile");
    expect(query.mock.calls[0]?.[1]).toEqual([USER_ID, RUN_ID]);
  });

  it("uses one transaction-scoped advisory lock per user", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const transaction = new PostgresAccessStoreTransaction(clientFrom(query));

    await transaction.lockUserAccess(USER_ID);

    expect(normalizeSql(query.mock.calls[0]?.[0])).toContain(
      "pg_advisory_xact_lock",
    );
    expect(query.mock.calls[0]?.[1]).toEqual([
      `brai-access-environment:${USER_ID}`,
    ]);
  });

  it("reserves the lowest free canonical slot behind one cross-user allocation fence", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [environmentRow()], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ allocation_slot: "0" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [reservedEnvironmentRow(0)],
        rowCount: 1,
      });
    const transaction = new PostgresAccessStoreTransaction(clientFrom(query));

    await expect(
      transaction.markUserEnvironmentProvisioning(USER_ID, 1),
    ).resolves.toMatchObject({
      status: "provisioning",
      provisionGeneration: 1,
      provisionAccessGeneration: 1,
      allocationSlot: 0,
      environmentName: "brai-u-0",
      outerIdRangeStart: 1_879_048_192,
      quotaProjectId: 10_000,
      storagePath: "/srv/brai-user-data/brai-u-0",
    });

    expect(query.mock.calls[0]?.[1]).toEqual([
      "brai-access:environment-allocation",
    ]);
    expect(normalizeSql(query.mock.calls[2]?.[0])).toContain(
      "generate_series( 0::bigint, $1::bigint )",
    );
    expect(query.mock.calls[2]?.[1]).toEqual([2_046]);
    const updateSql = normalizeSql(query.mock.calls[3]?.[0]);
    expect(updateSql).toContain("allocation_slot = $3");
    expect(updateSql).toContain("storage_mount_point = $14");
    expect(query.mock.calls[3]?.[1]).toEqual([
      USER_ID,
      1,
      0,
      "brai-u-0",
      1_879_048_192,
      131_072,
      1_879_049_192,
      1_879_049_192,
      1_879_113_728,
      1_879_113_728,
      65_536,
      10_000,
      "/srv/brai-user-data/brai-u-0",
      "/srv/brai-user-data",
    ]);
  });

  it("retries with the exact durable reservation instead of allocating again", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [reservedEnvironmentRow(7)],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          reservedEnvironmentRow(7, {
            provision_generation: "2",
          }),
        ],
        rowCount: 1,
      });
    const transaction = new PostgresAccessStoreTransaction(clientFrom(query));

    await expect(
      transaction.markUserEnvironmentProvisioning(USER_ID, 1),
    ).resolves.toMatchObject({
      provisionGeneration: 2,
      allocationSlot: 7,
      environmentName: "brai-u-7",
      quotaProjectId: 10_007,
    });

    expect(query).toHaveBeenCalledTimes(3);
    expect(
      query.mock.calls.some(([sql]) =>
        normalizeSql(sql).includes("generate_series"),
      ),
    ).toBe(false);
    const expected = allocationReservationForSlot(7);
    expect(query.mock.calls[2]?.[1]?.slice(2)).toEqual([
      expected.allocationSlot,
      expected.environmentName,
      expected.outerIdRangeStart,
      expected.outerIdRangeCount,
      expected.unixUid,
      expected.unixGid,
      expected.subuidStart,
      expected.subgidStart,
      expected.subidCount,
      expected.quotaProjectId,
      expected.storagePath,
      expected.storageMountPoint,
    ]);
  });

  it("consumes readiness evidence only when it exactly matches the reservation", async () => {
    const reservation = allocationReservationForSlot(0);
    const provisioningContext = trustedProvisioningContextFromServer();
    const receipt = verifiedEnvironmentProvisionReceiptFromHost(
      provisioningContext,
      {
        environmentId: ENVIRONMENT_ID,
        provisionGeneration: 1,
        allocationSlot: 0,
        receipt: {
          version: 1,
          profile: "user-sandbox",
          userId: USER_ID,
          accessGeneration: 1,
          provisionedAt: "2026-07-17T03:00:00.000Z",
          runtime: {
            environmentName: reservation.environmentName,
            outerIdRangeStart: reservation.outerIdRangeStart,
            outerIdRangeCount: reservation.outerIdRangeCount,
            imageBraiUid: reservation.unixUid,
            imageBraiGid: reservation.unixGid,
            guestInnerSubuidStart: 65_536,
            guestInnerSubgidStart: 65_536,
            effectiveHostInnerSubuidStart: reservation.subuidStart,
            effectiveHostInnerSubgidStart: reservation.subgidStart,
            innerSubidCount: reservation.subidCount,
          },
          image: {
            path: "/srv/opt/brai-agent-runtime/user-sandbox.squashfs",
            sha256: "a".repeat(64),
          },
          storage: {
            mountPoint: reservation.storageMountPoint,
            device: "/dev/mapper/brai-user-data",
            dataPath: reservation.storagePath,
            xfsProjectId: reservation.quotaProjectId,
            hardLimitBytes: 5_368_709_120,
            hardLimitInodes: 500_000,
            projectInheritance: true,
            quotaEnforcementActive: true,
          },
        },
      },
    );
    const query = vi.fn().mockResolvedValue({
      rows: [
        reservedEnvironmentRow(0, {
          status: "ready",
          enforced_quota_bytes: "5368709120",
          enforced_quota_inodes: "500000",
          storage_device: "/dev/mapper/brai-user-data",
          project_inheritance: true,
          quota_enforcement_active: true,
          image_path: "/srv/opt/brai-agent-runtime/user-sandbox.squashfs",
          image_sha256: "a".repeat(64),
          host_provisioned_at: "2026-07-17T03:00:00.000Z",
        }),
      ],
      rowCount: 1,
    });
    const transaction = new PostgresAccessStoreTransaction(clientFrom(query));

    await expect(
      transaction.markUserEnvironmentReady(receipt),
    ).resolves.toMatchObject({ status: "ready", allocationSlot: 0 });

    const sql = normalizeSql(query.mock.calls[0]?.[0]);
    expect(sql).not.toContain("SET status = 'ready', allocation_slot = $5");
    expect(sql).toContain("AND allocation_slot = $5");
    expect(sql).toContain("AND storage_mount_point = $16");
  });

  it("atomically claims pending to starting against the active generation", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const transaction = new PostgresAccessStoreTransaction(clientFrom(query));
    const runtimeContext = trustedRuntimeContextFromServer();
    const claim = verifiedRuntimeClaimFromController(runtimeContext, {
      projectId: PROJECT_ONE,
      userId: USER_ID,
      environmentId: ENVIRONMENT_ID,
      runId: RUN_ID,
      profile: "user-sandbox",
      accessGeneration: 1,
      runtimeHostId: BRAI_SINGLE_RUNTIME_HOST_ID,
      jobReference: JOB_REFERENCE,
      commandSha256: COMMAND_SHA256,
      runtimeIdentity: RUNTIME_IDENTITY,
    });

    await expect(transaction.claimPendingRun(claim)).resolves.toBeUndefined();

    const sql = normalizeSql(query.mock.calls[0]?.[0]);
    expect(sql).toContain("SET status = 'starting'");
    expect(sql).toContain("run.status = 'pending'");
    expect(sql).toContain("state.status = 'active'");
    expect(sql).toContain("state.access_generation = run.access_generation");
    expect(query.mock.calls[0]?.[1]).toEqual([
      RUN_ID,
      PROJECT_ONE,
      USER_ID,
      1,
      ENVIRONMENT_ID,
      "user-sandbox",
      BRAI_SINGLE_RUNTIME_HOST_ID,
      JOB_REFERENCE,
      COMMAND_SHA256,
      JSON.stringify(claim.runtimeIdentity),
      JSON.stringify(claim),
    ]);
  });

  it("advances starting to running only for the exact claimed process tree", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const transaction = new PostgresAccessStoreTransaction(clientFrom(query));
    const runtimeContext = trustedRuntimeContextFromServer();
    const receipt = verifiedRuntimeStartedReceiptFromController(
      runtimeContext,
      {
        projectId: PROJECT_ONE,
        userId: USER_ID,
        runId: RUN_ID,
        accessGeneration: 1,
        runtimeIdentity: RUNTIME_IDENTITY,
        startedAt: new Date("2026-07-17T03:00:00.000Z"),
      },
    );

    await transaction.markClaimedRunRunning(receipt);
    const sql = normalizeSql(query.mock.calls[0]?.[0]);
    expect(sql).toContain("status = 'running'");
    expect(sql).toContain("run.status = 'starting'");
    expect(sql).toContain("run.runtime_identity = $5::jsonb");
    expect(sql).toContain("state.status = 'active'");
  });

  it("allows stale-start recovery only through an exact OS exit receipt", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const transaction = new PostgresAccessStoreTransaction(clientFrom(query));
    const runtimeContext = trustedRuntimeContextFromServer();
    const receipt = verifiedRuntimeExitReceiptFromController(runtimeContext, {
      projectId: PROJECT_ONE,
      userId: USER_ID,
      runId: RUN_ID,
      accessGeneration: 1,
      runtimeIdentity: RUNTIME_IDENTITY,
      outcome: "failed",
      exitCode: null,
      signal: "SIGKILL",
      exitedAt: new Date("2026-07-17T03:05:00.000Z"),
      emptyCgroup: EMPTY_CGROUP_PROOF,
    });

    await transaction.markClaimedRunExited(receipt);
    const sql = normalizeSql(query.mock.calls[0]?.[0]);
    expect(sql).toContain("status = $6");
    expect(sql).toContain("status IN ('starting', 'running')");
    expect(sql).toContain("runtime_identity = $5::jsonb");
    expect(query.mock.calls[0]?.[1]).toEqual([
      RUN_ID,
      PROJECT_ONE,
      USER_ID,
      1,
      JSON.stringify(receipt.runtimeIdentity),
      "failed",
      null,
      "SIGKILL",
      JSON.stringify(receipt),
      "2026-07-17T03:05:00.000Z",
    ]);
  });
});
