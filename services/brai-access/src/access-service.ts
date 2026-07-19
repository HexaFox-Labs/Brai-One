import { randomUUID } from "node:crypto";

import {
  AgentAccessError,
  beginDeveloperModeTransition as beginDomainTransition,
  completeDeveloperModeTransition as completeDomainTransition,
  createInitialUserAccessState,
  selectLaunchAccess,
} from "@brai/agent-access";
import {
  BRAI_SINGLE_RUNTIME_HOST_ID,
  USER_ACCESS_STATE_SCHEMA_VERSION,
  activeUserAccessStateSchema,
  transitioningUserAccessStateSchema,
  type ActiveUserAccessState,
  type RuntimeAccessReference,
  type TransitioningUserAccessState,
} from "@brai/contracts";
import { z } from "zod";

import { AccessServiceError } from "./errors.js";
import type {
  AccessStoreRepository,
  AccessStoreTransaction,
} from "./repository.js";
import {
  actorFromTrustedContext,
  assertTrustedPlatformAdminContext,
  assertTrustedProvisioningContext,
  assertTrustedRuntimeContext,
  assertVerifiedEnvironmentProvisionReceipt,
  assertVerifiedRuntimeClaim,
  assertVerifiedRuntimeExitReceipt,
  assertVerifiedRuntimeStartedReceipt,
  assertVerifiedRuntimeTerminationReceipt,
  type TrustedAccessContext,
  type TrustedPlatformAdminContext,
  type TrustedProvisioningContext,
  type TrustedRuntimeContext,
  type VerifiedEnvironmentProvisionReceipt,
  type VerifiedRuntimeClaim,
  type VerifiedRuntimeExitReceipt,
  type VerifiedRuntimeStartedReceipt,
  type VerifiedRuntimeTerminationReceipt,
} from "./trusted-context.js";
import type {
  ActiveProjectMembership,
  CapturedRuntime,
  DeveloperModeTransition,
  EnvironmentProvisioning,
  PendingAgentRun,
  PendingLaunch,
  StoredAccessState,
  UserEnvironment,
} from "./types.js";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4Schema = z.string().regex(UUID_V4_PATTERN);

const beginTransitionCommandSchema = z
  .object({
    target_user_id: uuidV4Schema,
    requested_developer_mode: z.boolean(),
  })
  .strict();

const completeTransitionCommandSchema = z
  .object({ user_id: uuidV4Schema })
  .strict();

const createLaunchCommandSchema = z
  .object({
    project_id: uuidV4Schema,
    job_reference: z
      .string()
      .min(1)
      .max(1_024)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/u),
    command_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

const beginProvisioningCommandSchema = z
  .object({ user_id: uuidV4Schema })
  .strict();

type GenerateId = () => string;
export type RuntimeReceiptDisposition = "applied" | "replayed";

function parseInput<Output>(schema: z.ZodType<Output>, input: unknown): Output {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AccessServiceError(
      "access_input_invalid",
      "Некорректный внутренний запрос к brai-access",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function requireMembership(
  membership: ActiveProjectMembership | null,
): ActiveProjectMembership {
  if (membership === null) {
    throw new AgentAccessError(
      "access_membership_not_found",
      "Пользователь не состоит в проекте",
    );
  }
  return membership;
}

function activeStateFrom(record: StoredAccessState): ActiveUserAccessState {
  if (record.status !== "active") {
    throw new AgentAccessError(
      "access_transition_in_progress",
      "Новый запуск или переход запрещён до завершения текущего перехода",
    );
  }
  return activeUserAccessStateSchema.parse({
    schema_version: USER_ACCESS_STATE_SCHEMA_VERSION,
    status: "active",
    user_id: record.userId,
    developer_mode: record.developerMode,
    access_generation: record.accessGeneration,
    quota: record.quota,
  });
}

function transitioningStateFrom(
  record: StoredAccessState,
  runsToTerminate: readonly RuntimeAccessReference[],
): TransitioningUserAccessState {
  if (
    record.status !== "transitioning" ||
    record.previousDeveloperMode === null ||
    record.requestedDeveloperMode === null ||
    record.previousAccessGeneration === null
  ) {
    throw new AccessServiceError(
      "access_transition_not_found",
      "Активный переход режима разработчика не найден",
    );
  }
  return transitioningUserAccessStateSchema.parse({
    schema_version: USER_ACCESS_STATE_SCHEMA_VERSION,
    status: "transitioning",
    user_id: record.userId,
    previous_developer_mode: record.previousDeveloperMode,
    requested_developer_mode: record.requestedDeveloperMode,
    previous_access_generation: record.previousAccessGeneration,
    access_generation: record.accessGeneration,
    quota: record.quota,
    runs_to_terminate: runsToTerminate,
  });
}

function runtimeReference(runtime: CapturedRuntime): RuntimeAccessReference {
  return Object.freeze({
    run_id: runtime.runId,
    access_generation: runtime.accessGeneration,
  });
}

async function ensureActiveState(
  transaction: AccessStoreTransaction,
  userId: string,
  environment: UserEnvironment,
): Promise<ActiveUserAccessState> {
  const stored = await transaction.getAccessStateForUpdate(userId);
  if (stored) return activeStateFrom(stored);

  const initial = createInitialUserAccessState({
    userId,
    quota: environment.quota,
  });
  return activeStateFrom(await transaction.createInitialAccessState(initial));
}

function validateTerminationEvidence(
  userId: string,
  captured: readonly CapturedRuntime[],
  receipts: readonly VerifiedRuntimeTerminationReceipt[],
): void {
  const identitiesEqual = (
    left: CapturedRuntime["runtimeIdentity"],
    right: CapturedRuntime["runtimeIdentity"],
  ): boolean =>
    left === right ||
    (left !== null &&
      right !== null &&
      left.schema_version === right.schema_version &&
      left.profile === right.profile &&
      left.runtime_host_id === right.runtime_host_id &&
      left.boot_id === right.boot_id &&
      left.systemd_invocation_id === right.systemd_invocation_id &&
      left.unit === right.unit &&
      left.cgroup_path === right.cgroup_path &&
      left.cgroup_inode === right.cgroup_inode &&
      left.leader_pid === right.leader_pid &&
      left.leader_start_time_ticks === right.leader_start_time_ticks &&
      left.machine === right.machine);
  const capturedByRun = new Map(captured.map((run) => [run.runId, run]));
  for (const receipt of receipts) {
    assertVerifiedRuntimeTerminationReceipt(receipt);
    const run = capturedByRun.get(receipt.runId);
    const expectedKind =
      run?.runtimeIdentity === null
        ? "cancelled_before_start"
        : "process_tree_killed";
    if (
      receipt.userId !== userId ||
      !run ||
      receipt.projectId !== run.projectId ||
      receipt.accessGeneration !== run.accessGeneration ||
      !identitiesEqual(receipt.runtimeIdentity, run.runtimeIdentity) ||
      receipt.kind !== expectedKind
    ) {
      throw new AgentAccessError(
        "runtime_termination_mismatch",
        "OS termination receipt не совпадает с сохранённым process tree",
      );
    }
  }
}

/** Internal-only service; it exposes no HTTP or NATS entry point. */
export class AccessService {
  public constructor(
    private readonly repository: AccessStoreRepository,
    private readonly generateId: GenerateId = randomUUID,
  ) {}

  public async beginDeveloperModeTransition(
    context: TrustedPlatformAdminContext,
    command: unknown,
  ): Promise<DeveloperModeTransition> {
    assertTrustedPlatformAdminContext(context);
    const parsed = parseInput(beginTransitionCommandSchema, command);

    return this.repository.transaction(async (transaction) => {
      await transaction.lockUserAccess(parsed.target_user_id);
      const environment = await transaction.ensureUserEnvironment(
        parsed.target_user_id,
        this.generateId(),
      );
      const stored = await transaction.getAccessStateForUpdate(
        parsed.target_user_id,
      );
      if (stored?.status === "transitioning") {
        if (stored.requestedDeveloperMode !== parsed.requested_developer_mode) {
          throw new AgentAccessError(
            "access_transition_in_progress",
            "Нельзя заменить незавершённый переход другим режимом",
          );
        }
        const captured = await transaction.getTransitionRunsForUpdate(
          parsed.target_user_id,
          stored.accessGeneration,
        );
        return Object.freeze({
          changed: true,
          user_id: parsed.target_user_id,
          access_generation: stored.accessGeneration,
          runs_to_terminate: Object.freeze(captured.map(runtimeReference)),
          runtime_bindings_to_terminate: captured,
        });
      }
      const current = stored
        ? activeStateFrom(stored)
        : activeStateFrom(
            await transaction.createInitialAccessState(
              createInitialUserAccessState({
                userId: parsed.target_user_id,
                quota: environment.quota,
              }),
            ),
          );
      if (current.developer_mode === parsed.requested_developer_mode) {
        return Object.freeze({
          changed: false,
          user_id: parsed.target_user_id,
          access_generation: current.access_generation,
          runs_to_terminate: Object.freeze([]),
          runtime_bindings_to_terminate: Object.freeze([]),
        });
      }

      const captured = await transaction.listLiveRunsForUpdate(
        parsed.target_user_id,
      );
      const references = captured.map(runtimeReference);
      const transition = beginDomainTransition(
        current,
        parsed.requested_developer_mode,
        references,
      );
      if (!transition.changed) {
        throw new AccessServiceError(
          "access_store_inconsistent",
          "Домен неожиданно отклонил требуемый переход",
        );
      }
      await transaction.persistTransition(
        context.actorUserId,
        transition.state,
        captured,
      );
      return Object.freeze({
        changed: true,
        user_id: parsed.target_user_id,
        access_generation: transition.state.access_generation,
        runs_to_terminate: transition.state.runs_to_terminate,
        runtime_bindings_to_terminate: captured,
      });
    });
  }

  public async completeDeveloperModeTransitionFromTrustedRuntime(
    context: TrustedRuntimeContext,
    command: unknown,
    receipts: readonly VerifiedRuntimeTerminationReceipt[],
  ): Promise<ActiveUserAccessState> {
    assertTrustedRuntimeContext(context);
    const parsed = parseInput(completeTransitionCommandSchema, command);
    if (!Array.isArray(receipts)) {
      throw new AccessServiceError(
        "access_input_invalid",
        "Termination receipts must be a trusted runtime array",
      );
    }

    return this.repository.transaction(async (transaction) => {
      await transaction.lockUserAccess(parsed.user_id);
      const stored = await transaction.getAccessStateForUpdate(parsed.user_id);
      if (!stored) {
        throw new AccessServiceError(
          "access_state_not_found",
          "Состояние доступа пользователя не найдено",
        );
      }
      const captured = await transaction.getTransitionRunsForUpdate(
        parsed.user_id,
        stored.accessGeneration,
      );
      validateTerminationEvidence(parsed.user_id, captured, receipts);
      const transition = transitioningStateFrom(
        stored,
        captured.map(runtimeReference),
      );
      const next = completeDomainTransition(
        transition,
        receipts.map((receipt) => ({
          run_id: receipt.runId,
          access_generation: receipt.accessGeneration,
        })),
      );
      await transaction.persistTransitionCompletion(next, receipts);
      return next;
    });
  }

  public async createPendingLaunch(
    context: TrustedAccessContext,
    command: unknown,
  ): Promise<PendingLaunch> {
    const userId = actorFromTrustedContext(context);
    const parsed = parseInput(createLaunchCommandSchema, command);

    return this.repository.transaction(async (transaction) => {
      await transaction.lockUserAccess(userId);
      const membership = requireMembership(
        await transaction.getActiveMembership(parsed.project_id, userId),
      );
      const environment = await transaction.ensureUserEnvironment(
        userId,
        this.generateId(),
      );
      const current = await ensureActiveState(transaction, userId, environment);
      const access = selectLaunchAccess(current);
      if (access.profile === "user-sandbox" && environment.status !== "ready") {
        throw new AccessServiceError(
          "access_environment_unavailable",
          "Изолированное окружение и его дисковая квота ещё не готовы",
        );
      }

      const runId = this.generateId();
      const run: PendingAgentRun = Object.freeze({
        runId,
        projectId: parsed.project_id,
        userId,
        environmentId:
          access.profile === "user-sandbox" ? environment.environmentId : null,
        profile: access.profile,
        runtimeHostId: BRAI_SINGLE_RUNTIME_HOST_ID,
        jobReference: parsed.job_reference,
        commandSha256: parsed.command_sha256,
        accessGeneration: access.access_generation,
        membershipGeneration: membership.membershipGeneration,
        quota: access.quota,
        status: "pending",
      });
      await transaction.insertPendingRun(run);
      return Object.freeze({
        run_id: runId,
        project_id: parsed.project_id,
        environment_id: run.environmentId,
        runtime_host_id: run.runtimeHostId,
        job: Object.freeze({
          reference: run.jobReference,
          command_sha256: run.commandSha256,
        }),
        status: "pending",
        access,
      });
    });
  }

  public async claimPendingRunFromTrustedRuntime(
    context: TrustedRuntimeContext,
    claim: VerifiedRuntimeClaim,
  ): Promise<RuntimeReceiptDisposition> {
    assertTrustedRuntimeContext(context);
    assertVerifiedRuntimeClaim(claim);
    return this.repository.transaction(async (transaction) => {
      await transaction.lockUserAccess(claim.userId);
      if (await transaction.isRuntimeReceiptApplied("claim", claim)) {
        return "replayed";
      }
      await transaction.claimPendingRun(claim);
      return "applied";
    });
  }

  public async markClaimedRunRunningFromTrustedRuntime(
    context: TrustedRuntimeContext,
    receipt: VerifiedRuntimeStartedReceipt,
  ): Promise<RuntimeReceiptDisposition> {
    assertTrustedRuntimeContext(context);
    assertVerifiedRuntimeStartedReceipt(receipt);
    return this.repository.transaction(async (transaction) => {
      await transaction.lockUserAccess(receipt.userId);
      if (await transaction.isRuntimeReceiptApplied("started", receipt)) {
        return "replayed";
      }
      await transaction.markClaimedRunRunning(receipt);
      return "applied";
    });
  }

  /**
   * Also serves stale-start recovery: the controller may fail a `starting` run
   * only with an exact OS exit/cgroup-empty receipt for its claimed identity.
   */
  public async completeClaimedRunFromTrustedRuntime(
    context: TrustedRuntimeContext,
    receipt: VerifiedRuntimeExitReceipt,
  ): Promise<RuntimeReceiptDisposition> {
    assertTrustedRuntimeContext(context);
    assertVerifiedRuntimeExitReceipt(receipt);
    return this.repository.transaction(async (transaction) => {
      await transaction.lockUserAccess(receipt.userId);
      if (await transaction.isRuntimeReceiptApplied("exit", receipt)) {
        return "replayed";
      }
      await transaction.markClaimedRunExited(receipt);
      return "applied";
    });
  }

  public async requestRunTerminationAfterDispatchFailure(
    userId: string,
    runId: string,
  ): Promise<CapturedRuntime> {
    return this.repository.transaction(async (transaction) => {
      await transaction.lockUserAccess(userId);
      return await transaction.requestRunTermination(userId, runId);
    });
  }

  /** Completes a non-mode-change termination, such as membership revocation. */
  public async completeRequestedRunTerminationFromTrustedRuntime(
    context: TrustedRuntimeContext,
    receipt: VerifiedRuntimeTerminationReceipt,
  ): Promise<void> {
    assertTrustedRuntimeContext(context);
    assertVerifiedRuntimeTerminationReceipt(receipt);
    await this.repository.transaction(async (transaction) => {
      await transaction.lockUserAccess(receipt.userId);
      await transaction.persistRequestedRunTermination(receipt);
    });
  }

  public async beginEnvironmentProvisioningFromTrustedHost(
    context: TrustedProvisioningContext,
    command: unknown,
  ): Promise<EnvironmentProvisioning> {
    assertTrustedProvisioningContext(context);
    const parsed = parseInput(beginProvisioningCommandSchema, command);
    return this.repository.transaction(async (transaction) => {
      await transaction.lockUserAccess(parsed.user_id);
      const environment = await transaction.ensureUserEnvironment(
        parsed.user_id,
        this.generateId(),
      );
      const state = await ensureActiveState(
        transaction,
        parsed.user_id,
        environment,
      );
      const provisioning = await transaction.markUserEnvironmentProvisioning(
        parsed.user_id,
        state.access_generation,
      );
      return Object.freeze({
        environment: provisioning,
        access_generation: state.access_generation,
      });
    });
  }

  public async completeEnvironmentProvisioningFromTrustedHost(
    context: TrustedProvisioningContext,
    receipt: VerifiedEnvironmentProvisionReceipt,
  ): Promise<UserEnvironment> {
    assertTrustedProvisioningContext(context);
    assertVerifiedEnvironmentProvisionReceipt(receipt);
    return this.repository.transaction(async (transaction) => {
      await transaction.lockUserAccess(receipt.userId);
      return transaction.markUserEnvironmentReady(receipt);
    });
  }
}
