import { KeyObject, type KeyLike } from "node:crypto";

import {
  WEB_AGENT_COMMAND,
  assertWebAgentJobBinding,
  signTrustedReceiptEnvelope,
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
import { verifyInternalAgentLaunchContract } from "@brai/agent-access";

import {
  type PreparedDeveloperRuntime,
  type PreparedDeveloperRuntimeRecovery,
} from "./developer-runtime-gate.js";
import {
  developerRuntimeIdentityForAccessReceipt,
  type BoundDeveloperCommand,
  type DeveloperRuntimeExitObservation,
  type DeveloperRuntimeLaunchReceipt,
  type DeveloperRuntimeTerminationReceipt,
} from "./developer-runtime.js";
import {
  developerRunRegistryRecordSchema,
  type DeveloperRunCancellationRecord,
  type DeveloperRunRegistry,
  type DeveloperRunRegistryEntry,
  type DeveloperRunRegistryRecord,
} from "./runtime-host-registry.js";
import {
  RuntimeReceiptRejectedError,
  type RuntimeReceiptSubmitter,
} from "./runtime-host-receipts.js";

export interface RuntimeHostLogger {
  info(bindings: Readonly<Record<string, unknown>>, message: string): void;
  warn(bindings: Readonly<Record<string, unknown>>, message: string): void;
  error(bindings: Readonly<Record<string, unknown>>, message: string): void;
}

export interface DeveloperRuntimeHostServiceOptions {
  readonly controller: DeveloperGatedController;
  readonly registry: DeveloperRunRegistry;
  readonly receiptSubmitter: RuntimeReceiptSubmitter;
  readonly launchKeyId: string;
  readonly launchPublicKey: KeyLike;
  readonly receiptKeyId: string;
  readonly receiptPrivateKey: KeyLike;
  readonly logger: RuntimeHostLogger;
  readonly now?: () => Date;
}

export interface DeveloperGatedController {
  prepareFromVerifiedContract(
    contract: InternalAgentLaunchContract,
    command: BoundDeveloperCommand,
    standardInput: string,
  ): Promise<PreparedDeveloperRuntime>;
  restoreHeld(
    recovery: PreparedDeveloperRuntimeRecovery,
  ): PreparedDeveloperRuntime;
  release(prepared: PreparedDeveloperRuntime): Promise<void>;
  terminate(
    prepared: PreparedDeveloperRuntime,
  ): Promise<DeveloperRuntimeTerminationReceipt>;
  terminateRecovered(
    recovery: PreparedDeveloperRuntimeRecovery,
  ): Promise<DeveloperRuntimeTerminationReceipt>;
  waitForExit(
    launchReceipt: DeveloperRuntimeLaunchReceipt,
  ): Promise<DeveloperRuntimeExitObservation>;
  collectExited(launchReceipt: DeveloperRuntimeLaunchReceipt): Promise<void>;
}

type LaunchResponse = ReturnType<
  typeof accessRuntimeAgentRunLaunchResponseSchema.parse
>;

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

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class DeveloperRuntimeHostService {
  readonly #controller: DeveloperGatedController;
  readonly #registry: DeveloperRunRegistry;
  readonly #receiptSubmitter: RuntimeReceiptSubmitter;
  readonly #launchKeyId: string;
  readonly #launchPublicKey: KeyLike;
  readonly #receiptKeyId: string;
  readonly #receiptPrivateKey: KeyLike;
  readonly #logger: RuntimeHostLogger;
  readonly #now: () => Date;
  readonly #locks = new Map<string, Promise<void>>();
  readonly #monitors = new Map<string, Promise<void>>();

  public constructor(options: DeveloperRuntimeHostServiceOptions) {
    this.#controller = options.controller;
    this.#registry = options.registry;
    this.#receiptSubmitter = options.receiptSubmitter;
    this.#launchKeyId = options.launchKeyId;
    this.#launchPublicKey = options.launchPublicKey;
    this.#receiptKeyId = options.receiptKeyId;
    this.#receiptPrivateKey = options.receiptPrivateKey;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());

    const publicKey =
      this.#launchPublicKey instanceof KeyObject
        ? this.#launchPublicKey
        : undefined;
    const privateKey =
      this.#receiptPrivateKey instanceof KeyObject
        ? this.#receiptPrivateKey
        : undefined;
    if (
      publicKey?.asymmetricKeyType !== "ed25519" ||
      publicKey.type !== "public" ||
      privateKey?.asymmetricKeyType !== "ed25519" ||
      privateKey.type !== "private"
    ) {
      // Non-KeyObject KeyLike values are validated by crypto at first use.
      if (publicKey !== undefined || privateKey !== undefined) {
        throw new Error("Runtime host requires Ed25519 launch/receipt keys.");
      }
    }
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
      if (this.#locks.get(runId) === tail) {
        this.#locks.delete(runId);
      }
    }
  }

  #claimReceipt(
    contract: InternalAgentLaunchContract,
    runtimeIdentity: RuntimeIdentity,
  ): SignedTrustedReceiptEnvelope {
    return this.#sign("runtime-claim-v2", {
      projectId: contract.project_id,
      userId: contract.access.user_id,
      environmentId: contract.environment_id,
      runId: contract.run_id,
      profile: contract.access.profile,
      accessGeneration: contract.access.access_generation,
      runtimeHostId: BRAI_SINGLE_RUNTIME_HOST_ID,
      jobReference: contract.job.reference,
      commandSha256: contract.job.command_sha256,
      runtimeIdentity,
    });
  }

  #startedReceipt(
    contract: InternalAgentLaunchContract,
    runtimeIdentity: RuntimeIdentity,
  ): SignedTrustedReceiptEnvelope {
    return this.#sign("runtime-started-v2", {
      projectId: contract.project_id,
      userId: contract.access.user_id,
      runId: contract.run_id,
      accessGeneration: contract.access.access_generation,
      runtimeIdentity,
      startedAt: this.#now().toISOString(),
    });
  }

  #terminationReceipt(
    binding: Readonly<{
      projectId: string;
      userId: string;
      runId: string;
      accessGeneration: number;
    }>,
    runtimeIdentity: RuntimeIdentity | null,
    terminated: DeveloperRuntimeTerminationReceipt | null,
  ): SignedTrustedReceiptEnvelope {
    const terminatedAt = terminated?.observedAt ?? this.#now().toISOString();
    return this.#sign("runtime-termination-v2", {
      ...binding,
      kind:
        runtimeIdentity === null
          ? "cancelled_before_start"
          : "process_tree_killed",
      runtimeIdentity,
      terminatedAt,
      emptyCgroup:
        runtimeIdentity === null
          ? null
          : emptyCgroupProof(runtimeIdentity, terminatedAt),
    });
  }

  async #putRuntime(
    record: DeveloperRunRegistryRecord,
    patch: Partial<DeveloperRunRegistryRecord>,
  ): Promise<DeveloperRunRegistryRecord> {
    const next = developerRunRegistryRecordSchema.parse({
      ...record,
      ...patch,
      updated_at: this.#now().toISOString(),
    });
    await this.#registry.put(next);
    return next;
  }

  async #terminateBeforeClaim(
    record: DeveloperRunRegistryRecord,
    prepared?: PreparedDeveloperRuntime,
  ): Promise<DeveloperRunRegistryRecord> {
    const terminated =
      prepared === undefined
        ? await this.#controller.terminateRecovered(record.recovery)
        : await this.#controller.terminate(prepared);
    const receipt = this.#terminationReceipt(
      {
        projectId: record.launch_contract.project_id,
        userId: record.launch_contract.access.user_id,
        runId: record.run_id,
        accessGeneration: record.launch_contract.access.access_generation,
      },
      null,
      terminated,
    );
    return await this.#putRuntime(record, {
      phase: "terminated",
      termination_receipt: receipt,
    });
  }

  async #terminateClaimed(
    record: DeveloperRunRegistryRecord,
  ): Promise<DeveloperRunRegistryRecord> {
    const terminated = await this.#controller.terminateRecovered(
      record.recovery,
    );
    const runtimeIdentity = developerRuntimeIdentityForAccessReceipt(
      record.recovery.mappedLaunchReceipt.identity,
    );
    const receipt = this.#terminationReceipt(
      {
        projectId: record.launch_contract.project_id,
        userId: record.launch_contract.access.user_id,
        runId: record.run_id,
        accessGeneration: record.launch_contract.access.access_generation,
      },
      runtimeIdentity,
      terminated,
    );
    return await this.#putRuntime(record, {
      phase: "terminated",
      termination_receipt: receipt,
    });
  }

  async #advance(
    initial: DeveloperRunRegistryRecord,
    preparedInput?: PreparedDeveloperRuntime,
  ): Promise<DeveloperRunRegistryRecord> {
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
      record = await this.#putRuntime(record, { phase: "claimed" });
    }
    if (record.phase === "claimed") {
      prepared ??= this.#controller.restoreHeld(record.recovery);
      try {
        await this.#controller.release(prepared);
      } catch (error) {
        await this.#terminateClaimed(record);
        throw error;
      }
      const runtimeIdentity = developerRuntimeIdentityForAccessReceipt(
        record.recovery.mappedLaunchReceipt.identity,
      );
      record = await this.#putRuntime(record, {
        phase: "released",
        started_receipt: this.#startedReceipt(
          record.launch_contract,
          runtimeIdentity,
        ),
      });
    }
    if (record.phase === "released") {
      if (record.started_receipt === null) {
        throw new Error("Released runtime has no signed started receipt.");
      }
      try {
        await this.#receiptSubmitter.submit(record.started_receipt);
      } catch (error) {
        await this.#terminateClaimed(record);
        throw error;
      }
      record = await this.#putRuntime(record, { phase: "started" });
    }
    if (record.phase === "started") {
      this.#startMonitor(record);
    } else if (record.phase === "exit-observed") {
      await this.#submitObservedExit(record);
      const refreshed = await this.#registry.get(record.run_id);
      if (refreshed?.kind === "runtime") record = refreshed;
    }
    return record;
  }

  async #submitObservedExit(record: DeveloperRunRegistryRecord): Promise<void> {
    if (record.exit_receipt === null) {
      throw new Error("Observed exit record has no signed exit receipt.");
    }
    await this.#receiptSubmitter.submit(record.exit_receipt);
    await this.#controller.collectExited(record.recovery.mappedLaunchReceipt);
    await this.#putRuntime(record, { phase: "exited" });
  }

  #startMonitor(record: DeveloperRunRegistryRecord): void {
    if (this.#monitors.has(record.run_id)) return;
    const monitor = (async () => {
      try {
        const observation = await this.#controller.waitForExit(
          record.recovery.mappedLaunchReceipt,
        );
        await this.#withRunLock(record.run_id, async () => {
          const current = await this.#registry.get(record.run_id);
          if (
            current === null ||
            current.kind !== "runtime" ||
            current.phase !== "started"
          ) {
            return;
          }
          const runtimeIdentity = developerRuntimeIdentityForAccessReceipt(
            observation.identity,
          );
          const exitReceipt = this.#sign("runtime-exit-v2", {
            projectId: current.launch_contract.project_id,
            userId: current.launch_contract.access.user_id,
            runId: current.run_id,
            accessGeneration: current.launch_contract.access.access_generation,
            runtimeIdentity,
            outcome: observation.outcome,
            exitCode: observation.exitCode,
            signal: observation.signal,
            exitedAt: observation.observedAt,
            emptyCgroup: emptyCgroupProof(
              runtimeIdentity,
              observation.observedAt,
            ),
          });
          const observed = await this.#putRuntime(current, {
            phase: "exit-observed",
            exit_receipt: exitReceipt,
          });
          await this.#submitObservedExit(observed);
        });
      } catch (error) {
        this.#logger.error(
          { err: error, run_id: record.run_id },
          "Не удалось зафиксировать точный выход developer runtime",
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
      if (existing.kind === "cancellation") {
        throw new RuntimeReceiptRejectedError(
          "stale_binding",
          "Run was cancelled before runtime dispatch.",
        );
      }
      if (
        existing.launch_contract.signature !== contract.signature ||
        !sameJson(existing.launch_contract, contract)
      ) {
        throw new RuntimeReceiptRejectedError(
          "stale_binding",
          "Run ID is already bound to another launch contract.",
        );
      }
      if (existing.phase === "terminated") {
        throw new RuntimeReceiptRejectedError(
          "stale_binding",
          "Runtime was already terminated.",
        );
      }
      await this.#advance(existing);
      return;
    }

    const prepared = await this.#controller.prepareFromVerifiedContract(
      contract,
      WEB_AGENT_COMMAND,
      prompt,
    );
    const runtimeIdentity = developerRuntimeIdentityForAccessReceipt(
      prepared.launchReceipt.identity,
    );
    const record = developerRunRegistryRecordSchema.parse({
      schema_version: 1,
      kind: "runtime",
      run_id: contract.run_id,
      phase: "held",
      launch_contract: contract,
      recovery: prepared.recovery,
      claim_receipt: this.#claimReceipt(contract, runtimeIdentity),
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
      if (contract.access.profile !== "developer") {
        return reject(
          "invalid_contract",
          "Этот runtime host handler принимает только developer profile.",
        );
      }
      assertWebAgentJobBinding(
        parsed.data.payload.prompt,
        contract.job.reference,
        contract.job.command_sha256,
      );
    } catch (error) {
      this.#logger.warn(
        { err: error, request_id: parsed.data.request_id },
        "Отклонён недействительный developer launch contract",
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
        payload: {
          accepted: true,
          run_id: contract.run_id,
        },
      });
    } catch (error) {
      this.#logger.error(
        {
          err: error,
          request_id: parsed.data.request_id,
          run_id: contract.run_id,
        },
        "Developer runtime не был принят",
      );
      return reject(
        error instanceof RuntimeReceiptRejectedError
          ? "invalid_contract"
          : "runtime_unavailable",
        "Developer runtime не удалось безопасно запустить.",
      );
    }
  }

  async #terminateExact(
    request: ReturnType<typeof runtimeAgentRunTerminateRequestSchema.parse>,
  ): Promise<SignedTrustedReceiptEnvelope> {
    const binding = request.payload;
    if (binding.profile !== "developer" || binding.environment_id !== null) {
      throw new Error("identity_mismatch");
    }
    const existing = await this.#registry.get(binding.run_id);
    if (existing?.kind === "cancellation") {
      if (
        existing.project_id !== binding.project_id ||
        existing.user_id !== binding.user_id ||
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
      const receipt = this.#terminationReceipt(
        {
          projectId: binding.project_id,
          userId: binding.user_id,
          runId: binding.run_id,
          accessGeneration: binding.access_generation,
        },
        null,
        null,
      );
      const cancellation: DeveloperRunCancellationRecord = {
        schema_version: 1,
        kind: "cancellation",
        run_id: binding.run_id,
        project_id: binding.project_id,
        user_id: binding.user_id,
        access_generation: binding.access_generation,
        termination_receipt: receipt,
        updated_at: this.#now().toISOString(),
      };
      await this.#registry.put(cancellation);
      return receipt;
    }

    const contract = existing.launch_contract;
    if (
      contract.project_id !== binding.project_id ||
      contract.access.user_id !== binding.user_id ||
      contract.access.access_generation !== binding.access_generation
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
    const runtimeIdentity = developerRuntimeIdentityForAccessReceipt(
      existing.recovery.mappedLaunchReceipt.identity,
    );
    if (
      binding.runtime_identity === null ||
      !sameJson(binding.runtime_identity, runtimeIdentity)
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
    const rejected = (
      code:
        | "invalid_request"
        | "runtime_not_found"
        | "identity_mismatch"
        | "runtime_unavailable"
        | "internal_error",
      message: string,
    ): RuntimeAgentRunTerminateResponse =>
      runtimeAgentRunTerminateResponseSchema.parse({
        schema_version: RUNTIME_AGENT_RUN_TERMINATE_RESPONSE_SCHEMA_VERSION,
        request_id: requestId,
        sent_at: this.#now().toISOString(),
        payload: { accepted: false, code, message },
      });
    if (!parsed.success) {
      return rejected(
        "invalid_request",
        "Некорректный exact termination request.",
      );
    }
    try {
      const receipt = await this.#withRunLock(
        parsed.data.payload.run_id,
        async () => await this.#terminateExact(parsed.data),
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
      this.#logger.error(
        {
          err: error,
          request_id: parsed.data.request_id,
          run_id: parsed.data.payload.run_id,
        },
        "Exact developer runtime termination не выполнено",
      );
      return rejected(
        code,
        "Developer runtime не удалось безопасно завершить.",
      );
    }
  }

  public async recover(): Promise<void> {
    for (const record of await this.#registry.listRecoverable()) {
      await this.#withRunLock(record.run_id, async () => {
        try {
          await this.#advance(record);
          this.#logger.info(
            { run_id: record.run_id, phase: record.phase },
            "Developer runtime восстановлен из root-owned registry",
          );
        } catch (error) {
          this.#logger.error(
            { err: error, run_id: record.run_id, phase: record.phase },
            "Не удалось восстановить developer runtime",
          );
        }
      });
    }
  }
}

export type { DeveloperRunRegistryEntry };
