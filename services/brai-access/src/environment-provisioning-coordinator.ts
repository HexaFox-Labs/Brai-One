import { randomUUID, type KeyLike } from "node:crypto";

import { issueEnvironmentProvisionContract } from "@brai/agent-access";
import {
  BRAI_SINGLE_RUNTIME_HOST_ID,
  ENVIRONMENT_PROVISION_CONTRACT_SCHEMA_VERSION,
  RUNTIME_USER_ENVIRONMENT_PROVISION_REQUEST_SCHEMA_VERSION,
  RUNTIME_USER_ENVIRONMENT_PROVISION_SUBJECT,
  environmentProvisionReservationSchema,
  runtimeUserEnvironmentProvisionResponseSchema,
  type EnvironmentProvisionContract,
  type SignedTrustedReceiptEnvelope,
} from "@brai/contracts";
import { requestJson, type NatsConnection } from "@brai/nats";

import type { AccessService } from "./access-service.js";
import type { TrustedReceiptPublicKeyResolver } from "./signed-receipts.js";
import {
  trustedProvisioningContextFromEd25519KeyResolver,
  verifiedEnvironmentProvisionReceiptFromSignedEnvelope,
} from "./trusted-context.js";
import type { EnvironmentProvisioning } from "./types.js";

export class EnvironmentProvisioningError extends Error {
  public constructor(
    public readonly code: "storage_pool_full" | "runtime_unavailable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EnvironmentProvisioningError";
  }
}

export interface EnvironmentProvisionContractIssuer {
  issue(provisioning: EnvironmentProvisioning): EnvironmentProvisionContract;
}

export class Ed25519EnvironmentProvisionContractIssuer implements EnvironmentProvisionContractIssuer {
  private readonly now: () => Date;
  private readonly generateId: () => string;

  public constructor(
    private readonly options: Readonly<{
      keyId: string;
      privateKey: KeyLike;
      lifetimeMs: number;
      now?: () => Date;
      generateId?: () => string;
    }>,
  ) {
    if (
      !Number.isSafeInteger(options.lifetimeMs) ||
      options.lifetimeMs < 1_000 ||
      options.lifetimeMs > 5 * 60 * 1_000
    ) {
      throw new Error("Invalid environment provision contract lifetime");
    }
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? randomUUID;
  }

  public issue(
    provisioning: EnvironmentProvisioning,
  ): EnvironmentProvisionContract {
    const environment = provisioning.environment;
    const issuedAt = this.now();
    const reservation = environmentProvisionReservationSchema.parse({
      schema_version: ENVIRONMENT_PROVISION_CONTRACT_SCHEMA_VERSION,
      reservation_id: this.generateId(),
      user_id: environment.userId,
      environment_id: environment.environmentId,
      runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
      provision_generation: environment.provisionGeneration,
      access_generation: provisioning.access_generation,
      allocation_slot: environment.allocationSlot,
      environment_name: environment.environmentName,
      outer_id_range_start: environment.outerIdRangeStart,
      outer_id_range_count: environment.outerIdRangeCount,
      image_brai_uid: environment.unixUid,
      image_brai_gid: environment.unixGid,
      inner_subuid_start: environment.subuidStart,
      inner_subgid_start: environment.subgidStart,
      inner_subid_count: environment.subidCount,
      xfs_project_id: environment.quotaProjectId,
      storage_path: environment.storagePath,
      storage_mount_point: environment.storageMountPoint,
      quota_bytes: environment.quota.bytes,
      quota_inodes: environment.quota.inodes,
    });
    return issueEnvironmentProvisionContract({
      reservation,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + this.options.lifetimeMs),
      keyId: this.options.keyId,
      privateKey: this.options.privateKey,
    });
  }
}

export interface EnvironmentProvisionDispatcher {
  dispatch(
    contract: EnvironmentProvisionContract,
  ): Promise<SignedTrustedReceiptEnvelope>;
}

export class NatsEnvironmentProvisionDispatcher implements EnvironmentProvisionDispatcher {
  public constructor(
    private readonly connection: NatsConnection,
    private readonly timeoutMs = 30_000,
  ) {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 30_000
    ) {
      throw new Error("Invalid environment provision timeout");
    }
  }

  public async dispatch(
    contract: EnvironmentProvisionContract,
  ): Promise<SignedTrustedReceiptEnvelope> {
    const requestId = randomUUID();
    try {
      const rawResponse = await requestJson<unknown, unknown>(
        this.connection,
        RUNTIME_USER_ENVIRONMENT_PROVISION_SUBJECT,
        {
          schema_version:
            RUNTIME_USER_ENVIRONMENT_PROVISION_REQUEST_SCHEMA_VERSION,
          request_id: requestId,
          sent_at: new Date().toISOString(),
          payload: { contract },
        },
        { timeoutMs: this.timeoutMs },
      );
      const response =
        runtimeUserEnvironmentProvisionResponseSchema.safeParse(rawResponse);
      if (!response.success || response.data.request_id !== requestId) {
        throw new EnvironmentProvisioningError(
          "runtime_unavailable",
          "Trusted runtime returned an invalid provisioning acknowledgement",
        );
      }
      if (!response.data.payload.accepted) {
        throw new EnvironmentProvisioningError(
          response.data.payload.code === "storage_pool_full"
            ? "storage_pool_full"
            : "runtime_unavailable",
          `Trusted runtime rejected provisioning: ${response.data.payload.code}`,
        );
      }
      if (response.data.payload.environment_id !== contract.environment_id) {
        throw new EnvironmentProvisioningError(
          "runtime_unavailable",
          "Trusted runtime acknowledged a different environment",
        );
      }
      return response.data.payload.provision_receipt;
    } catch (error) {
      if (error instanceof EnvironmentProvisioningError) throw error;
      throw new EnvironmentProvisioningError(
        "runtime_unavailable",
        "Trusted runtime provisioning request failed",
        { cause: error },
      );
    }
  }
}

export type EnvironmentProvisioningCommands = Pick<
  AccessService,
  | "beginEnvironmentProvisioningFromTrustedHost"
  | "completeEnvironmentProvisioningFromTrustedHost"
>;

export interface EnvironmentProvisioner {
  ensureReady(userId: string): Promise<void>;
}

/**
 * One server process coalesces parallel first launches for the same user. The
 * database remains the authority: a process crash causes a new generation and
 * an idempotent host retry against the same durable allocation.
 */
export class EnvironmentProvisioningCoordinator implements EnvironmentProvisioner {
  private readonly context;
  private readonly inFlight = new Map<string, Promise<void>>();

  public constructor(
    private readonly access: EnvironmentProvisioningCommands,
    private readonly issuer: EnvironmentProvisionContractIssuer,
    private readonly dispatcher: EnvironmentProvisionDispatcher,
    resolveRuntimePublicKey: TrustedReceiptPublicKeyResolver,
  ) {
    this.context = trustedProvisioningContextFromEd25519KeyResolver(
      resolveRuntimePublicKey,
    );
  }

  public ensureReady(userId: string): Promise<void> {
    const current = this.inFlight.get(userId);
    if (current) return current;
    const operation = this.provision(userId).finally(() => {
      if (this.inFlight.get(userId) === operation) {
        this.inFlight.delete(userId);
      }
    });
    this.inFlight.set(userId, operation);
    return operation;
  }

  private async provision(userId: string): Promise<void> {
    const provisioning =
      await this.access.beginEnvironmentProvisioningFromTrustedHost(
        this.context,
        { user_id: userId },
      );
    const contract = this.issuer.issue(provisioning);
    const envelope = await this.dispatcher.dispatch(contract);
    const receipt = verifiedEnvironmentProvisionReceiptFromSignedEnvelope(
      this.context,
      envelope,
    );
    const environment =
      await this.access.completeEnvironmentProvisioningFromTrustedHost(
        this.context,
        receipt,
      );
    if (
      environment.status !== "ready" ||
      environment.userId !== userId ||
      environment.environmentId !== contract.environment_id
    ) {
      throw new EnvironmentProvisioningError(
        "runtime_unavailable",
        "Access store did not activate the provisioned environment",
      );
    }
  }
}
