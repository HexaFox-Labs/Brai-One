import { generateKeyPairSync, sign as signBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  BRAI_SINGLE_RUNTIME_HOST_ID,
  RUNTIME_IDENTITY_SCHEMA_VERSION,
  type EmptyCgroupProof,
  type ActiveUserAccessState,
  type RuntimeIdentity,
  type TransitioningUserAccessState,
} from "@brai/contracts";

import { allocationReservationForSlot } from "../src/allocation-policy.js";
import { AccessService } from "../src/access-service.js";
import { AccessPersistenceError, AccessServiceError } from "../src/errors.js";
import type {
  AccessStoreRepository,
  AccessStoreTransaction,
} from "../src/repository.js";
import {
  trustedAccessContextFromServerIdentity,
  trustedPlatformAdminContextFromServerIdentity,
  trustedProvisioningContextFromEd25519KeyResolver,
  trustedProvisioningContextFromServer,
  trustedReceiptEnvelopeSigningBytes,
  trustedRuntimeContextFromEd25519KeyResolver,
  trustedRuntimeContextFromServer,
  verifiedEnvironmentProvisionReceiptFromHost,
  verifiedEnvironmentProvisionReceiptFromSignedEnvelope,
  verifiedRuntimeClaimFromController,
  verifiedRuntimeClaimFromSignedEnvelope,
  verifiedRuntimeExitReceiptFromController,
  verifiedRuntimeTerminationReceiptFromController,
  type HostProvisioningReceipt,
  type SignedTrustedReceiptEnvelope,
  type TrustedReceiptPurpose,
  type VerifiedEnvironmentProvisionReceipt,
  type VerifiedRuntimeClaim,
  type VerifiedRuntimeExitReceipt,
  type VerifiedRuntimeStartedReceipt,
  type VerifiedRuntimeTerminationReceipt,
} from "../src/trusted-adapter.js";
import type {
  CapturedRuntime,
  PendingAgentRun,
  ProjectMemberRole,
  ProvisioningUserEnvironment,
  StoredAccessState,
  UserEnvironment,
} from "../src/types.js";

const PROJECT_ONE = "1f88bde1-2b49-46cb-914d-7500afdf82d6";
const PROJECT_TWO = "2f88bde1-2b49-46cb-914d-7500afdf82d6";
const PLATFORM_ADMIN = "3f88bde1-2b49-46cb-914d-7500afdf82d6";
const USER_ID = "4f88bde1-2b49-46cb-914d-7500afdf82d6";
const RUN_ONE = "5f88bde1-2b49-46cb-914d-7500afdf82d6";
const RUN_TWO = "6f88bde1-2b49-46cb-914d-7500afdf82d6";
const NEW_RUN = "7f88bde1-2b49-46cb-914d-7500afdf82d6";
const ENVIRONMENT_ID = "8f88bde1-2b49-46cb-914d-7500afdf82d6";
const RUNTIME_IDENTITY = Object.freeze({
  schema_version: RUNTIME_IDENTITY_SCHEMA_VERSION,
  profile: "user-sandbox",
  runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
  boot_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  systemd_invocation_id: "a".repeat(32),
  unit: "brai-run-two.service",
  cgroup_path:
    "/machine.slice/machine-brai-u-1.scope/agent.slice/brai-run-two.service",
  cgroup_inode: 42_001,
  leader_pid: 12_345,
  leader_start_time_ticks: 987_654,
  machine: "brai-u-1",
}) satisfies RuntimeIdentity;
const EMPTY_CGROUP_PROOF = Object.freeze({
  observed_at: "2026-07-17T03:00:01.000Z",
  boot_id: RUNTIME_IDENTITY.boot_id,
  systemd_invocation_id: RUNTIME_IDENTITY.systemd_invocation_id,
  unit: RUNTIME_IDENTITY.unit,
  cgroup_path: RUNTIME_IDENTITY.cgroup_path,
  cgroup_inode: RUNTIME_IDENTITY.cgroup_inode,
  populated: false,
  leader_present: false,
}) satisfies EmptyCgroupProof;
const JOB_REFERENCE = `brai-job:${RUN_ONE}`;
const COMMAND_SHA256 = "c".repeat(64);

function storedFrom(
  state: ActiveUserAccessState | TransitioningUserAccessState,
): StoredAccessState {
  if (state.status === "active") {
    return {
      userId: state.user_id,
      status: "active",
      developerMode: state.developer_mode,
      accessGeneration: state.access_generation,
      previousDeveloperMode: null,
      requestedDeveloperMode: null,
      previousAccessGeneration: null,
      quota: state.quota,
    };
  }
  return {
    userId: state.user_id,
    status: "transitioning",
    developerMode: state.previous_developer_mode,
    accessGeneration: state.access_generation,
    previousDeveloperMode: state.previous_developer_mode,
    requestedDeveloperMode: state.requested_developer_mode,
    previousAccessGeneration: state.previous_access_generation,
    quota: state.quota,
  };
}

function newEnvironment(): UserEnvironment {
  return {
    userId: USER_ID,
    environmentId: ENVIRONMENT_ID,
    status: "unprovisioned",
    provisionGeneration: 0,
    provisionAccessGeneration: null,
    quota: { bytes: 5_368_709_120, inodes: 500_000 },
    enforcedQuota: null,
    allocationSlot: null,
    environmentName: null,
    outerIdRangeStart: null,
    outerIdRangeCount: null,
    unixUid: null,
    unixGid: null,
    subuidStart: null,
    subgidStart: null,
    subidCount: null,
    quotaProjectId: null,
    storagePath: null,
    storageMountPoint: null,
    storageDevice: null,
    projectInheritance: null,
    quotaEnforcementActive: null,
    imagePath: null,
    imageSha256: null,
    hostProvisionedAt: null,
  };
}

class FakeTransaction implements AccessStoreTransaction {
  public readonly memberships = new Map<string, ProjectMemberRole>();
  public readonly calls: string[] = [];
  public readonly insertedRuns: PendingAgentRun[] = [];
  public state: StoredAccessState | null = null;
  public environment: UserEnvironment | null = null;
  public liveRuns: readonly CapturedRuntime[] = [];
  public capturedRuns: readonly CapturedRuntime[] = [];
  public transitionActorUserId: string | null = null;
  public completedReceipts:
    readonly VerifiedRuntimeTerminationReceipt[] | null = null;
  public claimedRun: VerifiedRuntimeClaim | null = null;
  public startedReceipt: VerifiedRuntimeStartedReceipt | null = null;
  public exitReceipt: VerifiedRuntimeExitReceipt | null = null;

  public async lockUserAccess(userId: string): Promise<void> {
    this.calls.push(`lock:${userId}`);
  }

  public async getActiveMembership(
    projectId: string,
    userId: string,
  ): Promise<Readonly<{
    role: ProjectMemberRole;
    membershipGeneration: number;
  }> | null> {
    const role = this.memberships.get(`${projectId}:${userId}`) ?? null;
    return role ? { role, membershipGeneration: 1 } : null;
  }

  public async getAccessStateForUpdate(): Promise<StoredAccessState | null> {
    return this.state;
  }

  public async createInitialAccessState(
    state: ActiveUserAccessState,
  ): Promise<StoredAccessState> {
    this.state = storedFrom(state);
    return this.state;
  }

  public async listLiveRunsForUpdate(): Promise<readonly CapturedRuntime[]> {
    return this.liveRuns;
  }

  public async requestRunTermination(
    _userId: string,
    runId: string,
  ): Promise<CapturedRuntime> {
    const run = this.liveRuns.find((candidate) => candidate.runId === runId);
    if (run === undefined) throw new Error("missing run");
    return run;
  }

  public async persistTransition(
    requestedByPlatformAdminUserId: string,
    transition: TransitioningUserAccessState,
    capturedRuns: readonly CapturedRuntime[],
  ): Promise<void> {
    this.transitionActorUserId = requestedByPlatformAdminUserId;
    this.state = storedFrom(transition);
    this.capturedRuns = capturedRuns;
  }

  public async getTransitionRunsForUpdate(): Promise<
    readonly CapturedRuntime[]
  > {
    return this.capturedRuns;
  }

  public async persistTransitionCompletion(
    next: ActiveUserAccessState,
    receipts: readonly VerifiedRuntimeTerminationReceipt[],
  ): Promise<void> {
    this.state = storedFrom(next);
    this.completedReceipts = receipts;
  }

  public async ensureUserEnvironment(
    _userId: string,
    _candidateEnvironmentId: string,
  ): Promise<UserEnvironment> {
    this.environment ??= newEnvironment();
    return this.environment;
  }

  public async markUserEnvironmentProvisioning(
    _userId: string,
    accessGeneration: number,
  ): Promise<ProvisioningUserEnvironment> {
    if (!this.environment) throw new Error("missing environment");
    const reservation = allocationReservationForSlot(
      this.environment.allocationSlot ?? 1,
    );
    this.environment = {
      ...this.environment,
      ...reservation,
      status: "provisioning",
      provisionGeneration: this.environment.provisionGeneration + 1,
      provisionAccessGeneration: accessGeneration,
    };
    return this.environment as ProvisioningUserEnvironment;
  }

  public async markUserEnvironmentReady(
    receipt: VerifiedEnvironmentProvisionReceipt,
  ): Promise<UserEnvironment> {
    if (
      !this.environment ||
      receipt.environmentId !== this.environment.environmentId ||
      receipt.provisionGeneration !== this.environment.provisionGeneration ||
      receipt.accessGeneration !== this.environment.provisionAccessGeneration ||
      receipt.allocationSlot !== this.environment.allocationSlot ||
      receipt.environmentName !== this.environment.environmentName ||
      receipt.outerIdRangeStart !== this.environment.outerIdRangeStart ||
      receipt.outerIdRangeCount !== this.environment.outerIdRangeCount ||
      receipt.unixUid !== this.environment.unixUid ||
      receipt.unixGid !== this.environment.unixGid ||
      receipt.subuidStart !== this.environment.subuidStart ||
      receipt.subgidStart !== this.environment.subgidStart ||
      receipt.subidCount !== this.environment.subidCount ||
      receipt.quotaProjectId !== this.environment.quotaProjectId ||
      receipt.storagePath !== this.environment.storagePath ||
      receipt.storageMountPoint !== this.environment.storageMountPoint
    ) {
      throw new AccessPersistenceError("stale provision receipt");
    }
    this.environment = {
      ...this.environment,
      status: "ready",
      enforcedQuota: {
        bytes: receipt.quotaBytes,
        inodes: receipt.quotaInodes,
      },
      storageDevice: receipt.storageDevice,
      projectInheritance: receipt.projectInheritance,
      quotaEnforcementActive: receipt.quotaEnforcementActive,
      imagePath: receipt.imagePath,
      imageSha256: receipt.imageSha256,
      hostProvisionedAt: receipt.hostProvisionedAt,
    };
    return this.environment;
  }

  public async claimPendingRun(claim: VerifiedRuntimeClaim): Promise<void> {
    if (this.claimedRun) throw new AccessPersistenceError("already claimed");
    this.claimedRun = claim;
  }

  public async markClaimedRunRunning(
    receipt: VerifiedRuntimeStartedReceipt,
  ): Promise<void> {
    this.startedReceipt = receipt;
  }

  public async markClaimedRunExited(
    receipt: VerifiedRuntimeExitReceipt,
  ): Promise<void> {
    this.exitReceipt = receipt;
  }

  public async isRuntimeReceiptApplied(
    kind: "claim" | "started" | "exit",
    receipt:
      | VerifiedRuntimeClaim
      | VerifiedRuntimeStartedReceipt
      | VerifiedRuntimeExitReceipt,
  ): Promise<boolean> {
    const stored = {
      claim: this.claimedRun,
      started: this.startedReceipt,
      exit: this.exitReceipt,
    }[kind];
    return (
      stored !== null && JSON.stringify(stored) === JSON.stringify(receipt)
    );
  }

  public async persistRequestedRunTermination(): Promise<void> {}

  public async insertPendingRun(run: PendingAgentRun): Promise<void> {
    this.insertedRuns.push(run);
  }
}

class FakeRepository implements AccessStoreRepository {
  public constructor(public readonly tx: FakeTransaction) {}
  public async transaction<T>(
    operation: (transaction: AccessStoreTransaction) => Promise<T>,
  ): Promise<T> {
    return operation(this.tx);
  }
}

function idGenerator(): () => string {
  const ids = [ENVIRONMENT_ID, NEW_RUN, NEW_RUN, NEW_RUN];
  return () => ids.shift() ?? NEW_RUN;
}

const platformContext =
  trustedPlatformAdminContextFromServerIdentity(PLATFORM_ADMIN);
const userContext = trustedAccessContextFromServerIdentity(USER_ID);
const projectAdminContext =
  trustedAccessContextFromServerIdentity(PLATFORM_ADMIN);
const runtimeContext = trustedRuntimeContextFromServer();
const provisioningContext = trustedProvisioningContextFromServer();
const receiptKeys = generateKeyPairSync("ed25519");
const signedRuntimeContext = trustedRuntimeContextFromEd25519KeyResolver(
  (keyId) =>
    keyId === "test-runtime-2026-07" ? receiptKeys.publicKey : undefined,
);
const signedProvisioningContext =
  trustedProvisioningContextFromEd25519KeyResolver((keyId) =>
    keyId === "test-runtime-2026-07" ? receiptKeys.publicKey : undefined,
  );

function signedEnvelope(
  purpose: TrustedReceiptPurpose,
  payload: unknown,
): SignedTrustedReceiptEnvelope {
  const unsigned = {
    version: 1,
    purpose,
    key_id: "test-runtime-2026-07",
    payload: JSON.stringify(payload),
  } as const;
  return {
    ...unsigned,
    signature: signBytes(
      null,
      trustedReceiptEnvelopeSigningBytes(unsigned),
      receiptKeys.privateKey,
    ).toString("base64url"),
  };
}

function hostProvisioningReceipt(
  accessGeneration = 1,
): HostProvisioningReceipt {
  const outerStart = 1_879_048_192 + 131_072;
  return {
    version: 1,
    profile: "user-sandbox",
    userId: USER_ID,
    accessGeneration,
    provisionedAt: "2026-07-17T03:00:00.000Z",
    runtime: {
      environmentName: "brai-u-1",
      outerIdRangeStart: outerStart,
      outerIdRangeCount: 131_072,
      imageBraiUid: outerStart + 1_000,
      imageBraiGid: outerStart + 1_000,
      guestInnerSubuidStart: 65_536,
      guestInnerSubgidStart: 65_536,
      effectiveHostInnerSubuidStart: outerStart + 65_536,
      effectiveHostInnerSubgidStart: outerStart + 65_536,
      innerSubidCount: 65_536,
    },
    image: {
      path: "/srv/opt/brai-agent-runtime/user-sandbox.squashfs",
      sha256: "a".repeat(64),
    },
    storage: {
      mountPoint: "/srv/brai-user-data",
      device: "/dev/mapper/brai-user-data",
      dataPath: "/srv/brai-user-data/brai-u-1",
      xfsProjectId: 10_001,
      hardLimitBytes: 5_368_709_120,
      hardLimitInodes: 500_000,
      projectInheritance: true,
      quotaEnforcementActive: true,
    },
  };
}

function capturedRuns(): readonly CapturedRuntime[] {
  return [
    {
      projectId: PROJECT_ONE,
      runId: RUN_ONE,
      profile: "user-sandbox",
      environmentId: ENVIRONMENT_ID,
      accessGeneration: 1,
      runtimeIdentity: null,
    },
    {
      projectId: PROJECT_TWO,
      runId: RUN_TWO,
      profile: "user-sandbox",
      environmentId: ENVIRONMENT_ID,
      accessGeneration: 1,
      runtimeIdentity: RUNTIME_IDENTITY,
    },
  ];
}

function terminationReceipts(): readonly VerifiedRuntimeTerminationReceipt[] {
  return [
    verifiedRuntimeTerminationReceiptFromController(runtimeContext, {
      projectId: PROJECT_ONE,
      userId: USER_ID,
      runId: RUN_ONE,
      accessGeneration: 1,
      kind: "cancelled_before_start",
      runtimeIdentity: null,
      terminatedAt: new Date("2026-07-17T03:00:00.000Z"),
      emptyCgroup: null,
    }),
    verifiedRuntimeTerminationReceiptFromController(runtimeContext, {
      projectId: PROJECT_TWO,
      userId: USER_ID,
      runId: RUN_TWO,
      accessGeneration: 1,
      kind: "process_tree_killed",
      runtimeIdentity: RUNTIME_IDENTITY,
      terminatedAt: new Date("2026-07-17T03:00:01.000Z"),
      emptyCgroup: EMPTY_CGROUP_PROOF,
    }),
  ];
}

async function beginCrossProjectTransition(
  service: AccessService,
  tx: FakeTransaction,
): Promise<void> {
  tx.liveRuns = capturedRuns();
  await service.beginDeveloperModeTransition(platformContext, {
    target_user_id: USER_ID,
    requested_developer_mode: true,
  });
}

describe("global developer mode", () => {
  it("rejects project admin and accepts only platform-superadmin context", async () => {
    const tx = new FakeTransaction();
    tx.memberships.set(`${PROJECT_ONE}:${PLATFORM_ADMIN}`, "owner");
    const service = new AccessService(new FakeRepository(tx), idGenerator());

    await expect(
      service.beginDeveloperModeTransition(projectAdminContext as never, {
        target_user_id: USER_ID,
        requested_developer_mode: true,
      }),
    ).rejects.toMatchObject({ code: "access_admin_required" });

    await expect(
      service.beginDeveloperModeTransition(platformContext, {
        target_user_id: USER_ID,
        requested_developer_mode: true,
      }),
    ).resolves.toMatchObject({ changed: true, access_generation: 2 });
  });

  it("captures live runs across every project under one user generation", async () => {
    const tx = new FakeTransaction();
    tx.liveRuns = capturedRuns();
    const service = new AccessService(new FakeRepository(tx), idGenerator());

    const result = await service.beginDeveloperModeTransition(platformContext, {
      target_user_id: USER_ID,
      requested_developer_mode: true,
    });
    expect(result).toMatchObject({
      changed: true,
      user_id: USER_ID,
      access_generation: 2,
      runs_to_terminate: [
        { run_id: RUN_ONE, access_generation: 1 },
        { run_id: RUN_TWO, access_generation: 1 },
      ],
    });
    expect(tx.capturedRuns.map((run) => run.projectId)).toEqual([
      PROJECT_ONE,
      PROJECT_TWO,
    ]);
    expect(tx.transitionActorUserId).toBe(PLATFORM_ADMIN);
  });

  it("resumes the same fail-closed transition after a controller or request failure", async () => {
    const tx = new FakeTransaction();
    tx.liveRuns = capturedRuns();
    const service = new AccessService(new FakeRepository(tx), idGenerator());

    const first = await service.beginDeveloperModeTransition(platformContext, {
      target_user_id: USER_ID,
      requested_developer_mode: true,
    });
    const retry = await service.beginDeveloperModeTransition(platformContext, {
      target_user_id: USER_ID,
      requested_developer_mode: true,
    });

    expect(retry).toEqual(first);
    await expect(
      service.beginDeveloperModeTransition(platformContext, {
        target_user_id: USER_ID,
        requested_developer_mode: false,
      }),
    ).rejects.toMatchObject({
      code: "access_transition_in_progress",
    });
  });

  it("rejects partial, forged, or wrong-process termination evidence", async () => {
    const tx = new FakeTransaction();
    const service = new AccessService(new FakeRepository(tx), idGenerator());
    await beginCrossProjectTransition(service, tx);
    const receipts = terminationReceipts();

    await expect(
      service.completeDeveloperModeTransitionFromTrustedRuntime(
        runtimeContext,
        { user_id: USER_ID },
        [receipts[0]!],
      ),
    ).rejects.toMatchObject({ code: "runtime_termination_incomplete" });

    const forged = {
      ...receipts[1],
      runtimeIdentity: { ...RUNTIME_IDENTITY, cgroup_inode: 99_999 },
    } as never;
    await expect(
      service.completeDeveloperModeTransitionFromTrustedRuntime(
        runtimeContext,
        { user_id: USER_ID },
        [receipts[0]!, forged],
      ),
    ).rejects.toMatchObject({ code: "access_trusted_context_required" });
    expect(tx.completedReceipts).toBeNull();

    await expect(
      service.completeDeveloperModeTransitionFromTrustedRuntime(
        runtimeContext,
        { user_id: USER_ID },
        receipts,
      ),
    ).resolves.toMatchObject({
      status: "active",
      developer_mode: true,
      access_generation: 2,
    });
  });

  it("rejects receipts smuggled through the serialized command", async () => {
    const service = new AccessService(
      new FakeRepository(new FakeTransaction()),
      idGenerator(),
    );
    await expect(
      service.completeDeveloperModeTransitionFromTrustedRuntime(
        runtimeContext,
        { user_id: USER_ID, termination_receipts: [] },
        [],
      ),
    ).rejects.toMatchObject({ code: "access_input_invalid" });
  });
});

describe("launch and runtime claim", () => {
  it("blocks normal launch until the single global environment is ready", async () => {
    const tx = new FakeTransaction();
    tx.memberships.set(`${PROJECT_ONE}:${USER_ID}`, "member");
    const service = new AccessService(new FakeRepository(tx), idGenerator());
    await expect(
      service.createPendingLaunch(userContext, {
        project_id: PROJECT_ONE,
        job_reference: JOB_REFERENCE,
        command_sha256: COMMAND_SHA256,
      }),
    ).rejects.toMatchObject({ code: "access_environment_unavailable" });
    expect(tx.insertedRuns).toHaveLength(0);
  });

  it("allows global developer launch without pretending XFS is ready", async () => {
    const tx = new FakeTransaction();
    tx.memberships.set(`${PROJECT_ONE}:${USER_ID}`, "member");
    tx.state = {
      userId: USER_ID,
      status: "active",
      developerMode: true,
      accessGeneration: 2,
      previousDeveloperMode: null,
      requestedDeveloperMode: null,
      previousAccessGeneration: null,
      quota: { bytes: 5_368_709_120, inodes: 500_000 },
    };
    const service = new AccessService(new FakeRepository(tx), idGenerator());
    await expect(
      service.createPendingLaunch(userContext, {
        project_id: PROJECT_ONE,
        job_reference: JOB_REFERENCE,
        command_sha256: COMMAND_SHA256,
      }),
    ).resolves.toMatchObject({
      environment_id: null,
      runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
      job: {
        reference: JOB_REFERENCE,
        command_sha256: COMMAND_SHA256,
      },
      access: { profile: "developer", access_generation: 2 },
    });
    expect(tx.environment?.status).toBe("unprovisioned");
  });

  it("applies a pending claim once and safely acknowledges an exact replay", async () => {
    const tx = new FakeTransaction();
    const service = new AccessService(new FakeRepository(tx), idGenerator());
    const claim = verifiedRuntimeClaimFromController(runtimeContext, {
      projectId: PROJECT_ONE,
      userId: USER_ID,
      environmentId: ENVIRONMENT_ID,
      runId: RUN_ONE,
      profile: "user-sandbox",
      accessGeneration: 1,
      runtimeHostId: BRAI_SINGLE_RUNTIME_HOST_ID,
      jobReference: JOB_REFERENCE,
      commandSha256: COMMAND_SHA256,
      runtimeIdentity: RUNTIME_IDENTITY,
    });
    await expect(
      service.claimPendingRunFromTrustedRuntime(runtimeContext, claim),
    ).resolves.toBe("applied");
    await expect(
      service.claimPendingRunFromTrustedRuntime(runtimeContext, claim),
    ).resolves.toBe("replayed");
  });

  it("verifies cross-process Ed25519 claims before the same one-use DB CAS", async () => {
    const tx = new FakeTransaction();
    const service = new AccessService(new FakeRepository(tx), idGenerator());
    const envelope = signedEnvelope("runtime-claim-v2", {
      projectId: PROJECT_ONE,
      userId: USER_ID,
      environmentId: ENVIRONMENT_ID,
      runId: RUN_ONE,
      profile: "user-sandbox",
      accessGeneration: 1,
      runtimeHostId: BRAI_SINGLE_RUNTIME_HOST_ID,
      jobReference: JOB_REFERENCE,
      commandSha256: COMMAND_SHA256,
      runtimeIdentity: RUNTIME_IDENTITY,
    });
    const claim = verifiedRuntimeClaimFromSignedEnvelope(
      signedRuntimeContext,
      envelope,
    );
    await expect(
      service.claimPendingRunFromTrustedRuntime(signedRuntimeContext, claim),
    ).resolves.toBe("applied");
    const replayed = verifiedRuntimeClaimFromSignedEnvelope(
      signedRuntimeContext,
      envelope,
    );
    await expect(
      service.claimPendingRunFromTrustedRuntime(signedRuntimeContext, replayed),
    ).resolves.toBe("replayed");

    expect(() =>
      verifiedRuntimeClaimFromSignedEnvelope(signedRuntimeContext, {
        ...envelope,
        payload: envelope.payload.replace("scope", "tampered.scope"),
      }),
    ).toThrow(/signature is invalid/u);
  });

  it("fails closed when an exit proof names a different cgroup", () => {
    expect(() =>
      verifiedRuntimeExitReceiptFromController(runtimeContext, {
        projectId: PROJECT_ONE,
        userId: USER_ID,
        runId: RUN_ONE,
        accessGeneration: 1,
        runtimeIdentity: RUNTIME_IDENTITY,
        outcome: "failed",
        exitCode: null,
        signal: "SIGKILL",
        exitedAt: new Date("2026-07-17T03:00:02.000Z"),
        emptyCgroup: {
          ...EMPTY_CGROUP_PROOF,
          cgroup_inode: EMPTY_CGROUP_PROOF.cgroup_inode + 1,
        },
      }),
    ).toThrow(/Runtime exit receipt is malformed/u);
  });
});

describe("trusted environment provisioning", () => {
  it("binds the receipt to exact environment, generation, and allocation", async () => {
    const tx = new FakeTransaction();
    const service = new AccessService(new FakeRepository(tx), idGenerator());
    const provisioning =
      await service.beginEnvironmentProvisioningFromTrustedHost(
        provisioningContext,
        { user_id: USER_ID },
      );
    const receipt = verifiedEnvironmentProvisionReceiptFromHost(
      provisioningContext,
      {
        environmentId: provisioning.environment.environmentId,
        provisionGeneration: provisioning.environment.provisionGeneration,
        allocationSlot: 1,
        receipt: hostProvisioningReceipt(),
      },
    );
    const expected = allocationReservationForSlot(1);
    await expect(
      service.completeEnvironmentProvisioningFromTrustedHost(
        provisioningContext,
        receipt,
      ),
    ).resolves.toMatchObject({
      status: "ready",
      provisionGeneration: 1,
      allocationSlot: 1,
      environmentName: "brai-u-1",
      unixUid: expected.unixUid,
      subuidStart: expected.subuidStart,
      quotaProjectId: 10_001,
      storagePath: "/srv/brai-user-data/brai-u-1",
    });
  });

  it("rejects forged receipt objects and stale generations", async () => {
    const tx = new FakeTransaction();
    const service = new AccessService(new FakeRepository(tx), idGenerator());
    const provisioning =
      await service.beginEnvironmentProvisioningFromTrustedHost(
        provisioningContext,
        { user_id: USER_ID },
      );
    const receipt = verifiedEnvironmentProvisionReceiptFromHost(
      provisioningContext,
      {
        environmentId: provisioning.environment.environmentId,
        provisionGeneration: provisioning.environment.provisionGeneration,
        allocationSlot: 1,
        receipt: hostProvisioningReceipt(),
      },
    );
    await expect(
      service.completeEnvironmentProvisioningFromTrustedHost(
        provisioningContext,
        { ...receipt, provisionGeneration: 99 } as never,
      ),
    ).rejects.toMatchObject({ code: "access_trusted_context_required" });
  });

  it("supersedes a stuck provisioning generation instead of wedging forever", async () => {
    const tx = new FakeTransaction();
    const service = new AccessService(new FakeRepository(tx), idGenerator());
    const first = await service.beginEnvironmentProvisioningFromTrustedHost(
      provisioningContext,
      { user_id: USER_ID },
    );
    const retry = await service.beginEnvironmentProvisioningFromTrustedHost(
      provisioningContext,
      { user_id: USER_ID },
    );
    expect(first).toMatchObject({
      access_generation: 1,
      environment: {
        provisionGeneration: 1,
        allocationSlot: 1,
        environmentName: "brai-u-1",
        quotaProjectId: 10_001,
        storagePath: "/srv/brai-user-data/brai-u-1",
      },
    });
    expect(retry).toMatchObject({
      access_generation: 1,
      environment: {
        provisionGeneration: 2,
        allocationSlot: 1,
        environmentName: "brai-u-1",
        quotaProjectId: 10_001,
        storagePath: "/srv/brai-user-data/brai-u-1",
      },
    });
    expect(retry.environment.allocationSlot).toBe(
      first.environment.allocationSlot,
    );
    expect(retry.environment.outerIdRangeStart).toBe(
      first.environment.outerIdRangeStart,
    );
    expect(retry.environment.subuidStart).toBe(first.environment.subuidStart);

    const stale = verifiedEnvironmentProvisionReceiptFromHost(
      provisioningContext,
      {
        environmentId: first.environment.environmentId,
        provisionGeneration: first.environment.provisionGeneration,
        allocationSlot: 1,
        receipt: hostProvisioningReceipt(first.access_generation),
      },
    );
    await expect(
      service.completeEnvironmentProvisioningFromTrustedHost(
        provisioningContext,
        stale,
      ),
    ).rejects.toBeInstanceOf(AccessPersistenceError);
  });

  it("rejects a host receipt whose XFS facts do not match the canonical slot", () => {
    const receipt = hostProvisioningReceipt();
    expect(() =>
      verifiedEnvironmentProvisionReceiptFromHost(provisioningContext, {
        environmentId: ENVIRONMENT_ID,
        provisionGeneration: 1,
        allocationSlot: 1,
        receipt: {
          ...receipt,
          storage: {
            ...receipt.storage,
            quotaEnforcementActive: false,
          } as never,
        },
      }),
    ).toThrow(/Host provisioning receipt is malformed/u);
  });

  it("verifies the complete provisioning receipt across a signed boundary", () => {
    const envelope = signedEnvelope("environment-provision-v1", {
      environmentId: ENVIRONMENT_ID,
      provisionGeneration: 1,
      allocationSlot: 1,
      receipt: hostProvisioningReceipt(),
    });
    const receipt = verifiedEnvironmentProvisionReceiptFromSignedEnvelope(
      signedProvisioningContext,
      envelope,
    );
    expect(receipt).toMatchObject({
      environmentId: ENVIRONMENT_ID,
      quotaBytes: 5_368_709_120,
      quotaInodes: 500_000,
      imageSha256: "a".repeat(64),
      storageDevice: "/dev/mapper/brai-user-data",
      projectInheritance: true,
      quotaEnforcementActive: true,
    });
    expect(() =>
      verifiedEnvironmentProvisionReceiptFromHost(
        signedProvisioningContext,
        JSON.parse(envelope.payload),
      ),
    ).toThrow(/accepts only signed envelopes/u);
  });
});

describe("opaque context issuance", () => {
  it("rejects serialized or symbol-copied contexts", async () => {
    const service = new AccessService(
      new FakeRepository(new FakeTransaction()),
      idGenerator(),
    );
    const symbols = Object.getOwnPropertySymbols(platformContext);
    const copied = {
      actorUserId: PLATFORM_ADMIN,
      [symbols[0]!]: true,
    } as never;
    await expect(
      service.beginDeveloperModeTransition(copied, {
        target_user_id: USER_ID,
        requested_developer_mode: true,
      }),
    ).rejects.toMatchObject({ code: "access_admin_required" });
  });

  it("rejects caller identity/profile fields in launch command", async () => {
    const service = new AccessService(
      new FakeRepository(new FakeTransaction()),
      idGenerator(),
    );
    await expect(
      service.createPendingLaunch(userContext, {
        project_id: PROJECT_ONE,
        job_reference: JOB_REFERENCE,
        command_sha256: COMMAND_SHA256,
        user_id: USER_ID,
        profile: "developer",
      }),
    ).rejects.toBeInstanceOf(AccessServiceError);
  });
});
