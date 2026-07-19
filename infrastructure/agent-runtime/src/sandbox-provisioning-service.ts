import { type KeyLike } from "node:crypto";

import {
  signTrustedReceiptEnvelope,
  verifyEnvironmentProvisionContract,
} from "@brai/agent-access";
import {
  RUNTIME_USER_ENVIRONMENT_PROVISION_RESPONSE_SCHEMA_VERSION,
  environmentProvisionReceiptPayloadSchema,
  runtimeUserEnvironmentProvisionRequestSchema,
  runtimeUserEnvironmentProvisionResponseSchema,
  type RuntimeUserEnvironmentProvisionResponse,
} from "@brai/contracts";

import {
  provisionTrustedReservation,
  TrustedProvisioningError,
  validateTrustedReservation,
  type TrustedProvisioningDependencies,
  type TrustedProvisioningReceipt,
} from "./trusted-provisioning.js";

export interface SandboxProvisioningLogger {
  info(bindings: Readonly<Record<string, unknown>>, message: string): void;
  warn(bindings: Readonly<Record<string, unknown>>, message: string): void;
  error(bindings: Readonly<Record<string, unknown>>, message: string): void;
}

export interface SandboxProvisioningExecutor {
  provision(input: unknown): Promise<TrustedProvisioningReceipt>;
}

export function createSandboxProvisioningExecutor(
  dependencies: TrustedProvisioningDependencies,
): SandboxProvisioningExecutor {
  return {
    provision: async (input) => {
      const { reservation, allocation } = validateTrustedReservation(input);
      return await provisionTrustedReservation(
        reservation,
        allocation,
        dependencies,
      );
    },
  };
}

export interface SandboxProvisioningHostServiceOptions {
  readonly executor: SandboxProvisioningExecutor;
  readonly launchKeyId: string;
  readonly launchPublicKey: KeyLike;
  readonly receiptKeyId: string;
  readonly receiptPrivateKey: KeyLike;
  readonly logger: SandboxProvisioningLogger;
  readonly now?: () => Date;
}

export class SandboxProvisioningHostService {
  readonly #executor: SandboxProvisioningExecutor;
  readonly #launchKeyId: string;
  readonly #launchPublicKey: KeyLike;
  readonly #receiptKeyId: string;
  readonly #receiptPrivateKey: KeyLike;
  readonly #logger: SandboxProvisioningLogger;
  readonly #now: () => Date;
  readonly #locks = new Map<string, Promise<void>>();

  public constructor(options: SandboxProvisioningHostServiceOptions) {
    this.#executor = options.executor;
    this.#launchKeyId = options.launchKeyId;
    this.#launchPublicKey = options.launchPublicKey;
    this.#receiptKeyId = options.receiptKeyId;
    this.#receiptPrivateKey = options.receiptPrivateKey;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());
  }

  async #withEnvironmentLock<Output>(
    environmentId: string,
    action: () => Promise<Output>,
  ): Promise<Output> {
    const previous = this.#locks.get(environmentId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#locks.set(environmentId, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.#locks.get(environmentId) === tail) {
        this.#locks.delete(environmentId);
      }
    }
  }

  public async handleProvision(
    input: unknown,
  ): Promise<RuntimeUserEnvironmentProvisionResponse> {
    const parsed =
      runtimeUserEnvironmentProvisionRequestSchema.safeParse(input);
    const requestId = parsed.success
      ? parsed.data.request_id
      : "00000000-0000-4000-8000-000000000000";
    const reject = (
      code:
        | "invalid_request"
        | "invalid_contract"
        | "provisioning_failed"
        | "storage_pool_full"
        | "internal_error",
      message: string,
    ): RuntimeUserEnvironmentProvisionResponse =>
      runtimeUserEnvironmentProvisionResponseSchema.parse({
        schema_version:
          RUNTIME_USER_ENVIRONMENT_PROVISION_RESPONSE_SCHEMA_VERSION,
        request_id: requestId,
        sent_at: this.#now().toISOString(),
        payload: { accepted: false, code, message },
      });
    if (!parsed.success) {
      return reject(
        "invalid_request",
        "Некорректный server-only environment provision request.",
      );
    }

    let contract;
    try {
      contract = verifyEnvironmentProvisionContract(
        parsed.data.payload.contract,
        {
          now: this.#now(),
          resolvePublicKey: (keyId) =>
            keyId === this.#launchKeyId ? this.#launchPublicKey : undefined,
        },
      );
    } catch (error) {
      this.#logger.warn(
        { error, request_id: parsed.data.request_id },
        "Отклонён недействительный environment provision contract",
      );
      return reject(
        "invalid_contract",
        "Environment reservation contract недействителен.",
      );
    }

    const {
      issued_at: _issuedAt,
      expires_at: _expiresAt,
      key_id: _keyId,
      signature: _signature,
      ...reservation
    } = contract;
    try {
      const measured = await this.#withEnvironmentLock(
        contract.environment_id,
        async () => await this.#executor.provision(reservation),
      );
      const payload = environmentProvisionReceiptPayloadSchema.parse({
        environmentId: contract.environment_id,
        provisionGeneration: contract.provision_generation,
        allocationSlot: contract.allocation_slot,
        receipt: {
          version: 1,
          profile: "user-sandbox",
          userId: contract.user_id,
          accessGeneration: contract.access_generation,
          provisionedAt: measured.provisioned_at,
          runtime: {
            environmentName: measured.allocation.environment_name,
            outerIdRangeStart: measured.allocation.outer_id_range_start,
            outerIdRangeCount: measured.allocation.outer_id_range_count,
            imageBraiUid: measured.allocation.image_brai_uid,
            imageBraiGid: measured.allocation.image_brai_gid,
            guestInnerSubuidStart: 65_536,
            guestInnerSubgidStart: 65_536,
            effectiveHostInnerSubuidStart:
              measured.allocation.inner_subuid_start,
            effectiveHostInnerSubgidStart:
              measured.allocation.inner_subgid_start,
            innerSubidCount: measured.allocation.inner_subid_count,
          },
          image: {
            path: measured.image.path,
            sha256: measured.image.sha256,
          },
          storage: {
            mountPoint: measured.storage.mount_point,
            device: measured.storage.device,
            dataPath: measured.storage.path,
            xfsProjectId: measured.storage.xfs_project_id,
            hardLimitBytes: measured.storage.hard_limit_bytes,
            hardLimitInodes: measured.storage.hard_limit_inodes,
            projectInheritance: measured.storage.project_inheritance,
            quotaEnforcementActive: measured.storage.quota_enforcement_active,
          },
        },
      });
      const provisionReceipt = signTrustedReceiptEnvelope(
        "environment-provision-v1",
        payload,
        {
          keyId: this.#receiptKeyId,
          privateKey: this.#receiptPrivateKey,
        },
      );
      this.#logger.info(
        {
          request_id: parsed.data.request_id,
          environment_id: contract.environment_id,
          allocation_slot: contract.allocation_slot,
        },
        "Environment provisioned from the exact access reservation",
      );
      return runtimeUserEnvironmentProvisionResponseSchema.parse({
        schema_version:
          RUNTIME_USER_ENVIRONMENT_PROVISION_RESPONSE_SCHEMA_VERSION,
        request_id: parsed.data.request_id,
        sent_at: this.#now().toISOString(),
        payload: {
          accepted: true,
          environment_id: contract.environment_id,
          provision_receipt: provisionReceipt,
        },
      });
    } catch (error) {
      const storagePoolFull =
        error instanceof TrustedProvisioningError &&
        error.message.includes("storage_pool_full");
      this.#logger.error(
        {
          error,
          request_id: parsed.data.request_id,
          environment_id: contract.environment_id,
        },
        "Environment provisioning failed closed",
      );
      return reject(
        storagePoolFull ? "storage_pool_full" : "provisioning_failed",
        "Environment не удалось безопасно provision.",
      );
    }
  }
}
