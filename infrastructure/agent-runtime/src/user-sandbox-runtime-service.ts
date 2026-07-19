import type { KeyLike } from "node:crypto";

import {
  assertWebAgentJobBinding,
  signTrustedReceiptEnvelope,
  verifyInternalAgentLaunchContract,
} from "@brai/agent-access";
import {
  ACCESS_RUNTIME_AGENT_RUN_LAUNCH_RESPONSE_SCHEMA_VERSION,
  BRAI_SINGLE_RUNTIME_HOST_ID,
  RUNTIME_AGENT_RUN_TERMINATE_RESPONSE_SCHEMA_VERSION,
  accessRuntimeAgentRunLaunchRequestSchema,
  accessRuntimeAgentRunLaunchResponseSchema,
  runtimeAgentRunTerminateRequestSchema,
  runtimeAgentRunTerminateResponseSchema,
  type EmptyCgroupProof,
  type InternalAgentLaunchContract,
  type RuntimeAgentRunTerminateResponse,
  type RuntimeIdentity,
  type SignedTrustedReceiptEnvelope,
} from "@brai/contracts";

import type { RuntimeHostLogger } from "./runtime-host-service.js";
import {
  RuntimeReceiptRejectedError,
  type RuntimeReceiptSubmitter,
} from "./runtime-host-receipts.js";
import {
  userSandboxRunRegistryRecordSchema,
  type UserSandboxRunCancellationRecord,
  type UserSandboxRunRegistry,
  type UserSandboxRunRegistryRecord,
} from "./user-sandbox-runtime-registry.js";
import {
  userSandboxRuntimeIdentityForAccessReceipt,
  type PreparedUserSandboxRuntime,
  type UserSandboxRuntimeController,
  type UserSandboxRuntimeTerminationReceipt,
} from "./user-sandbox-runtime.js";

export interface UserSandboxRuntimeHostServiceOptions {
  readonly controller: UserSandboxRuntimeController;
  readonly registry: UserSandboxRunRegistry;
  readonly receiptSubmitter: RuntimeReceiptSubmitter;
  readonly launchKeyId: string;
  readonly launchPublicKey: KeyLike;
  readonly receiptKeyId: string;
  readonly receiptPrivateKey: KeyLike;
  readonly logger: RuntimeHostLogger;
  readonly now?: () => Date;
}

type LaunchResponse = ReturnType<
  typeof accessRuntimeAgentRunLaunchResponseSchema.parse
>;

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function emptyCgroupProof(
  identity: RuntimeIdentity,
  observedAt: string,
): EmptyCgroupProof {
  return {
    observed_at: observedAt,
    boot_id: identity.boot_id,
    systemd_invocation_id: identity.systemd_invocation_id,
    unit: identity.unit,
    cgroup_path: identity.cgroup_path,
    cgroup_inode: identity.cgroup_inode,
    populated: false,
    leader_present: false,
  };
}

export class UserSandboxRuntimeHostService {
  readonly #controller: UserSandboxRuntimeController;
  readonly #registry: UserSandboxRunRegistry;
  readonly #receiptSubmitter: RuntimeReceiptSubmitter;
  readonly #launchKeyId: string;
  readonly #launchPublicKey: KeyLike;
  readonly #receiptKeyId: string;
  readonly #receiptPrivateKey: KeyLike;
  readonly #logger: RuntimeHostLogger;
  readonly #now: () => Date;
  readonly #locks = new Map<string, Promise<void>>();
  readonly #monitors = new Map<string, Promise<void>>();

  public constructor(options: UserSandboxRuntimeHostServiceOptions) {
    this.#controller = options.controller;
    this.#registry = options.registry;
    this.#receiptSubmitter = options.receiptSubmitter;
    this.#launchKeyId = options.launchKeyId;
    this.#launchPublicKey = options.launchPublicKey;
    this.#receiptKeyId = options.receiptKeyId;
    this.#receiptPrivateKey = options.receiptPrivateKey;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());
  }

  #sign(
    purpose:
      | "runtime-claim-v2"
      | "runtime-started-v2"
      | "runtime-exit-v2"
      | "runtime-termination-v2",
    payload: unknown,
  ): SignedTrustedReceiptEnvelope {
    return signTrustedReceiptEnvelope(purpose, payload, {
      keyId: this.#receiptKeyId,
      privateKey: this.#receiptPrivateKey,
    });
  }

  async #withRunLock<Output>(
    runId: string,
    action: () => Promise<Output>,
  ): Promise<Output> {
    const previous = this.#locks.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#locks.set(runId, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.#locks.get(runId) === tail) this.#locks.delete(runId);
    }
  }

  #claim(
    contract: InternalAgentLaunchContract,
    identity: RuntimeIdentity,
  ): SignedTrustedReceiptEnvelope {
    return this.#sign("runtime-claim-v2", {
      projectId: contract.project_id,
      userId: contract.access.user_id,
      environmentId: contract.environment_id,
      runId: contract.run_id,
      profile: "user-sandbox",
      accessGeneration: contract.access.access_generation,
      runtimeHostId: BRAI_SINGLE_RUNTIME_HOST_ID,
      jobReference: contract.job.reference,
      commandSha256: contract.job.command_sha256,
      runtimeIdentity: identity,
    });
  }

  #started(
    contract: InternalAgentLaunchContract,
    identity: RuntimeIdentity,
  ): SignedTrustedReceiptEnvelope {
    return this.#sign("runtime-started-v2", {
      projectId: contract.project_id,
      userId: contract.access.user_id,
      runId: contract.run_id,
      accessGeneration: contract.access.access_generation,
      runtimeIdentity: identity,
      startedAt: this.#now().toISOString(),
    });
  }

  #termination(
    binding: Readonly<{
      projectId: string;
      userId: string;
      runId: string;
      accessGeneration: number;
    }>,
    identity: RuntimeIdentity | null,
    terminated: UserSandboxRuntimeTerminationReceipt | null,
  ): SignedTrustedReceiptEnvelope {
    const terminatedAt = terminated?.observedAt ?? this.#now().toISOString();
    return this.#sign("runtime-termination-v2", {
      ...binding,
      kind:
        identity === null ? "cancelled_before_start" : "process_tree_killed",
      runtimeIdentity: identity,
      terminatedAt,
      emptyCgroup:
        identity === null ? null : emptyCgroupProof(identity, terminatedAt),
    });
  }

  async #put(
    record: UserSandboxRunRegistryRecord,
    patch: Partial<UserSandboxRunRegistryRecord>,
  ): Promise<UserSandboxRunRegistryRecord> {
    const next = userSandboxRunRegistryRecordSchema.parse({
      ...record,
      ...patch,
      updated_at: this.#now().toISOString(),
    });
    await this.#registry.put(next);
    return next;
  }

  async #terminateBeforeClaim(
    record: UserSandboxRunRegistryRecord,
    prepared?: PreparedUserSandboxRuntime,
  ): Promise<UserSandboxRunRegistryRecord> {
    const terminated =
      prepared === undefined
        ? await this.#controller.terminateRecovered(record.recovery)
        : await this.#controller.terminate(prepared);
    return await this.#put(record, {
      phase: "terminated",
      termination_receipt: this.#termination(
        {
          projectId: record.launch_contract.project_id,
          userId: record.launch_contract.access.user_id,
          runId: record.run_id,
          accessGeneration: record.launch_contract.access.access_generation,
        },
        null,
        terminated,
      ),
    });
  }

  async #terminateClaimed(
    record: UserSandboxRunRegistryRecord,
  ): Promise<UserSandboxRunRegistryRecord> {
    const terminated = await this.#controller.terminateRecovered(
      record.recovery,
    );
    const identity = userSandboxRuntimeIdentityForAccessReceipt(
      record.recovery.launchReceipt.identity,
    );
    return await this.#put(record, {
      phase: "terminated",
      termination_receipt: this.#termination(
        {
          projectId: record.launch_contract.project_id,
          userId: record.launch_contract.access.user_id,
          runId: record.run_id,
          accessGeneration: record.launch_contract.access.access_generation,
        },
        identity,
        terminated,
      ),
    });
  }

  async #advance(
    initial: UserSandboxRunRegistryRecord,
    preparedInput?: PreparedUserSandboxRuntime,
  ): Promise<UserSandboxRunRegistryRecord> {
    let record = initial;
    let prepared = preparedInput;
    if (record.phase === "held") {
      prepared ??= this.#controller.restoreHeld(record.recovery);
      try {
        await this.#receiptSubmitter.submit(record.claim_receipt);
      } catch (error) {
        await this.#terminateBeforeClaim(record, prepared);
        throw error;
      }
      record = await this.#put(record, { phase: "claimed" });
    }
    if (record.phase === "claimed") {
      prepared ??= this.#controller.restoreHeld(record.recovery);
      try {
        await this.#controller.release(prepared);
      } catch (error) {
        await this.#terminateClaimed(record);
        throw error;
      }
      const identity = userSandboxRuntimeIdentityForAccessReceipt(
        record.recovery.launchReceipt.identity,
      );
      record = await this.#put(record, {
        phase: "released",
        started_receipt: this.#started(record.launch_contract, identity),
      });
    }
    if (record.phase === "released") {
      if (record.started_receipt === null) {
        throw new Error("Released sandbox runtime has no started receipt.");
      }
      try {
        await this.#receiptSubmitter.submit(record.started_receipt);
      } catch (error) {
        await this.#terminateClaimed(record);
        throw error;
      }
      record = await this.#put(record, { phase: "started" });
    }
    if (record.phase === "started") {
      this.#startMonitor(record);
    } else if (record.phase === "exit-observed") {
      await this.#submitExit(record);
      const refreshed = await this.#registry.get(record.run_id);
      if (refreshed?.kind === "user-sandbox-runtime") record = refreshed;
    }
    return record;
  }

  async #submitExit(record: UserSandboxRunRegistryRecord): Promise<void> {
    if (record.exit_receipt === null) {
      throw new Error("Observed sandbox exit has no signed receipt.");
    }
    await this.#receiptSubmitter.submit(record.exit_receipt);
    await this.#controller.collectExited(record.recovery.launchReceipt);
    await this.#put(record, { phase: "exited" });
  }

  #startMonitor(record: UserSandboxRunRegistryRecord): void {
    if (this.#monitors.has(record.run_id)) return;
    const monitor = (async () => {
      try {
        const observation = await this.#controller.waitForExit(
          record.recovery.launchReceipt,
        );
        await this.#withRunLock(record.run_id, async () => {
          const current = await this.#registry.get(record.run_id);
          if (
            current?.kind !== "user-sandbox-runtime" ||
            current.phase !== "started"
          ) {
            return;
          }
          const identity = userSandboxRuntimeIdentityForAccessReceipt(
            observation.identity,
          );
          const observed = await this.#put(current, {
            phase: "exit-observed",
            exit_receipt: this.#sign("runtime-exit-v2", {
              projectId: current.launch_contract.project_id,
              userId: current.launch_contract.access.user_id,
              runId: current.run_id,
              accessGeneration:
                current.launch_contract.access.access_generation,
              runtimeIdentity: identity,
              outcome: observation.outcome,
              exitCode: observation.exitCode,
              signal: observation.signal,
              exitedAt: observation.observedAt,
              emptyCgroup: emptyCgroupProof(identity, observation.observedAt),
            }),
          });
          await this.#submitExit(observed);
        });
      } catch (error) {
        this.#logger.error(
          { err: error, run_id: record.run_id },
          "Не удалось зафиксировать точный выход user-sandbox runtime",
        );
      } finally {
        this.#monitors.delete(record.run_id);
      }
    })();
    this.#monitors.set(record.run_id, monitor);
  }

  async #launchVerified(
    contract: InternalAgentLaunchContract,
    prompt: string,
  ): Promise<void> {
    const existing = await this.#registry.get(contract.run_id);
    if (existing !== null) {
      if (existing.kind === "user-sandbox-cancellation") {
        throw new RuntimeReceiptRejectedError(
          "stale_binding",
          "Sandbox run was cancelled before dispatch.",
        );
      }
      if (
        !sameJson(existing.launch_contract, contract) ||
        existing.phase === "terminated"
      ) {
        throw new RuntimeReceiptRejectedError(
          "stale_binding",
          "Sandbox run ID is already bound or terminated.",
        );
      }
      await this.#advance(existing);
      return;
    }
    const prepared = await this.#controller.prepareFromVerifiedContract(
      contract,
      prompt,
    );
    const identity = userSandboxRuntimeIdentityForAccessReceipt(
      prepared.launchReceipt.identity,
    );
    const record = userSandboxRunRegistryRecordSchema.parse({
      schema_version: 1,
      kind: "user-sandbox-runtime",
      run_id: contract.run_id,
      phase: "held",
      launch_contract: contract,
      recovery: prepared.recovery,
      claim_receipt: this.#claim(contract, identity),
      started_receipt: null,
      exit_receipt: null,
      termination_receipt: null,
      updated_at: this.#now().toISOString(),
    });
    try {
      await this.#registry.put(record);
    } catch (error) {
      await this.#controller.terminate(prepared);
      throw error;
    }
    await this.#advance(record, prepared);
  }

  public async handleLaunch(input: unknown): Promise<LaunchResponse> {
    const parsed = accessRuntimeAgentRunLaunchRequestSchema.safeParse(input);
    const requestId = parsed.success
      ? parsed.data.request_id
      : "00000000-0000-4000-8000-000000000000";
    const reject = (
      code: "invalid_contract" | "runtime_unavailable" | "internal_error",
      message: string,
    ): LaunchResponse =>
      accessRuntimeAgentRunLaunchResponseSchema.parse({
        schema_version: ACCESS_RUNTIME_AGENT_RUN_LAUNCH_RESPONSE_SCHEMA_VERSION,
        request_id: requestId,
        sent_at: this.#now().toISOString(),
        payload: { accepted: false, code, message },
      });
    if (!parsed.success) {
      return reject("invalid_contract", "Некорректный launch request.");
    }
    let contract: InternalAgentLaunchContract;
    try {
      contract = verifyInternalAgentLaunchContract(
        parsed.data.payload.launch_contract,
        {
          now: this.#now(),
          resolvePublicKey: (keyId) =>
            keyId === this.#launchKeyId ? this.#launchPublicKey : undefined,
        },
      );
      if (
        contract.access.profile !== "user-sandbox" ||
        contract.environment_id === null
      ) {
        throw new Error("wrong profile");
      }
      assertWebAgentJobBinding(
        parsed.data.payload.prompt,
        contract.job.reference,
        contract.job.command_sha256,
      );
    } catch (error) {
      this.#logger.warn(
        { err: error, request_id: parsed.data.request_id },
        "Отклонён недействительный user-sandbox launch contract",
      );
      return reject(
        "invalid_contract",
        "Launch contract, prompt или immutable command недействительны.",
      );
    }
    try {
      await this.#withRunLock(contract.run_id, async () => {
        await this.#launchVerified(contract, parsed.data.payload.prompt);
      });
      return accessRuntimeAgentRunLaunchResponseSchema.parse({
        schema_version: ACCESS_RUNTIME_AGENT_RUN_LAUNCH_RESPONSE_SCHEMA_VERSION,
        request_id: parsed.data.request_id,
        sent_at: this.#now().toISOString(),
        payload: { accepted: true, run_id: contract.run_id },
      });
    } catch (error) {
      this.#logger.error(
        { err: error, run_id: contract.run_id },
        "User-sandbox runtime не был принят",
      );
      return reject(
        error instanceof RuntimeReceiptRejectedError
          ? "invalid_contract"
          : "runtime_unavailable",
        "User-sandbox runtime не удалось безопасно запустить.",
      );
    }
  }

  async #terminateExact(
    request: ReturnType<typeof runtimeAgentRunTerminateRequestSchema.parse>,
  ): Promise<SignedTrustedReceiptEnvelope> {
    const binding = request.payload;
    if (binding.profile !== "user-sandbox" || binding.environment_id === null) {
      throw new Error("identity_mismatch");
    }
    const existing = await this.#registry.get(binding.run_id);
    if (existing?.kind === "user-sandbox-cancellation") {
      if (
        existing.project_id !== binding.project_id ||
        existing.user_id !== binding.user_id ||
        existing.environment_id !== binding.environment_id ||
        existing.access_generation !== binding.access_generation ||
        binding.runtime_identity !== null
      ) {
        throw new Error("identity_mismatch");
      }
      return existing.termination_receipt;
    }
    if (existing === null) {
      if (binding.runtime_identity !== null) {
        throw new Error("runtime_not_found");
      }
      const receipt = this.#termination(
        {
          projectId: binding.project_id,
          userId: binding.user_id,
          runId: binding.run_id,
          accessGeneration: binding.access_generation,
        },
        null,
        null,
      );
      const cancellation: UserSandboxRunCancellationRecord = {
        schema_version: 1,
        kind: "user-sandbox-cancellation",
        run_id: binding.run_id,
        project_id: binding.project_id,
        user_id: binding.user_id,
        environment_id: binding.environment_id,
        access_generation: binding.access_generation,
        termination_receipt: receipt,
        updated_at: this.#now().toISOString(),
      };
      await this.#registry.put(cancellation);
      return receipt;
    }
    if (
      existing.launch_contract.project_id !== binding.project_id ||
      existing.launch_contract.access.user_id !== binding.user_id ||
      existing.launch_contract.environment_id !== binding.environment_id ||
      existing.launch_contract.access.access_generation !==
        binding.access_generation
    ) {
      throw new Error("identity_mismatch");
    }
    if (
      existing.phase === "terminated" &&
      existing.termination_receipt !== null
    ) {
      return existing.termination_receipt;
    }
    if (existing.phase === "held" && binding.runtime_identity === null) {
      return (await this.#terminateBeforeClaim(existing)).termination_receipt!;
    }
    const identity = userSandboxRuntimeIdentityForAccessReceipt(
      existing.recovery.launchReceipt.identity,
    );
    if (
      binding.runtime_identity === null ||
      !sameJson(binding.runtime_identity, identity)
    ) {
      throw new Error("identity_mismatch");
    }
    return (await this.#terminateClaimed(existing)).termination_receipt!;
  }

  public async handleTerminate(
    input: unknown,
  ): Promise<RuntimeAgentRunTerminateResponse> {
    const parsed = runtimeAgentRunTerminateRequestSchema.safeParse(input);
    const requestId = parsed.success
      ? parsed.data.request_id
      : "00000000-0000-4000-8000-000000000000";
    const reject = (
      code:
        | "invalid_request"
        | "runtime_not_found"
        | "identity_mismatch"
        | "runtime_unavailable",
      message: string,
    ): RuntimeAgentRunTerminateResponse =>
      runtimeAgentRunTerminateResponseSchema.parse({
        schema_version: RUNTIME_AGENT_RUN_TERMINATE_RESPONSE_SCHEMA_VERSION,
        request_id: requestId,
        sent_at: this.#now().toISOString(),
        payload: { accepted: false, code, message },
      });
    if (!parsed.success) {
      return reject("invalid_request", "Некорректный termination request.");
    }
    try {
      const receipt = await this.#withRunLock(parsed.data.payload.run_id, () =>
        this.#terminateExact(parsed.data),
      );
      return runtimeAgentRunTerminateResponseSchema.parse({
        schema_version: RUNTIME_AGENT_RUN_TERMINATE_RESPONSE_SCHEMA_VERSION,
        request_id: parsed.data.request_id,
        sent_at: this.#now().toISOString(),
        payload: {
          accepted: true,
          run_id: parsed.data.payload.run_id,
          termination_receipt: receipt,
        },
      });
    } catch (error) {
      const code =
        error instanceof Error &&
        ["runtime_not_found", "identity_mismatch"].includes(error.message)
          ? (error.message as "runtime_not_found" | "identity_mismatch")
          : "runtime_unavailable";
      return reject(
        code,
        "User-sandbox runtime не удалось безопасно завершить.",
      );
    }
  }

  public async recover(): Promise<void> {
    for (const record of await this.#registry.listRecoverable()) {
      await this.#withRunLock(record.run_id, async () => {
        try {
          await this.#advance(record);
        } catch (error) {
          this.#logger.error(
            { err: error, run_id: record.run_id, phase: record.phase },
            "Не удалось восстановить user-sandbox runtime",
          );
        }
      });
    }
  }
}
