import { randomUUID } from "node:crypto";

import {
  ACCESS_RUNTIME_RECEIPT_RESPONSE_SCHEMA_VERSION,
  accessRuntimeReceiptRequestSchema,
  accessRuntimeReceiptResponseSchema,
  uuidV4Schema,
  type AccessRuntimeReceiptResponse,
} from "@brai/contracts";
import type { Logger } from "@brai/runtime";

import type {
  AccessService,
  RuntimeReceiptDisposition,
} from "./access-service.js";
import { AccessPersistenceError, AccessServiceError } from "./errors.js";
import type { TrustedReceiptPublicKeyResolver } from "./signed-receipts.js";
import {
  trustedRuntimeContextFromEd25519KeyResolver,
  verifiedRuntimeClaimFromSignedEnvelope,
  verifiedRuntimeExitReceiptFromSignedEnvelope,
  verifiedRuntimeStartedReceiptFromSignedEnvelope,
  type TrustedRuntimeContext,
} from "./trusted-context.js";

export type RuntimeReceiptCommands = Pick<
  AccessService,
  | "claimPendingRunFromTrustedRuntime"
  | "markClaimedRunRunningFromTrustedRuntime"
  | "completeClaimedRunFromTrustedRuntime"
>;

function requestIdFrom(input: unknown): string {
  if (typeof input === "object" && input !== null && "request_id" in input) {
    const parsed = uuidV4Schema.safeParse(input.request_id);
    if (parsed.success) return parsed.data;
  }
  return randomUUID();
}

function errorResponse(
  requestId: string,
  error: unknown,
): AccessRuntimeReceiptResponse {
  let code: "invalid_receipt" | "stale_binding" | "internal_error" =
    "internal_error";
  let message = "Не удалось применить runtime receipt.";
  if (error instanceof AccessServiceError) {
    code = "invalid_receipt";
    message = "Runtime receipt не прошёл проверку подписи или структуры.";
  } else if (error instanceof AccessPersistenceError) {
    code = "stale_binding";
    message = "Runtime receipt не совпадает с текущим состоянием запуска.";
  }
  return accessRuntimeReceiptResponseSchema.parse({
    schema_version: ACCESS_RUNTIME_RECEIPT_RESPONSE_SCHEMA_VERSION,
    request_id: requestId,
    sent_at: new Date().toISOString(),
    payload: {
      accepted: false,
      code,
      message,
    },
  });
}

function successResponse(
  requestId: string,
  disposition: RuntimeReceiptDisposition,
): AccessRuntimeReceiptResponse {
  return accessRuntimeReceiptResponseSchema.parse({
    schema_version: ACCESS_RUNTIME_RECEIPT_RESPONSE_SCHEMA_VERSION,
    request_id: requestId,
    sent_at: new Date().toISOString(),
    payload: {
      accepted: true,
      disposition,
    },
  });
}

export class RuntimeReceiptApiService {
  private readonly context: TrustedRuntimeContext;

  public constructor(
    private readonly access: RuntimeReceiptCommands,
    resolvePublicKey: TrustedReceiptPublicKeyResolver,
    private readonly logger: Logger,
  ) {
    this.context =
      trustedRuntimeContextFromEd25519KeyResolver(resolvePublicKey);
  }

  public async handleClaim(
    input: unknown,
  ): Promise<AccessRuntimeReceiptResponse> {
    const requestId = requestIdFrom(input);
    const request = accessRuntimeReceiptRequestSchema.safeParse(input);
    if (
      !request.success ||
      request.data.payload.receipt.purpose !== "runtime-claim-v2"
    ) {
      return errorResponse(
        requestId,
        new AccessServiceError(
          "access_input_invalid",
          "Expected a signed runtime claim",
        ),
      );
    }
    try {
      const claim = verifiedRuntimeClaimFromSignedEnvelope(
        this.context,
        request.data.payload.receipt,
      );
      const disposition = await this.access.claimPendingRunFromTrustedRuntime(
        this.context,
        claim,
      );
      return successResponse(request.data.request_id, disposition);
    } catch (error) {
      this.logger.error(
        { err: error, request_id: request.data.request_id },
        "Runtime claim receipt отклонён",
      );
      return errorResponse(request.data.request_id, error);
    }
  }

  public async handleStarted(
    input: unknown,
  ): Promise<AccessRuntimeReceiptResponse> {
    const requestId = requestIdFrom(input);
    const request = accessRuntimeReceiptRequestSchema.safeParse(input);
    if (
      !request.success ||
      request.data.payload.receipt.purpose !== "runtime-started-v2"
    ) {
      return errorResponse(
        requestId,
        new AccessServiceError(
          "access_input_invalid",
          "Expected a signed runtime started receipt",
        ),
      );
    }
    try {
      const receipt = verifiedRuntimeStartedReceiptFromSignedEnvelope(
        this.context,
        request.data.payload.receipt,
      );
      const disposition =
        await this.access.markClaimedRunRunningFromTrustedRuntime(
          this.context,
          receipt,
        );
      return successResponse(request.data.request_id, disposition);
    } catch (error) {
      this.logger.error(
        { err: error, request_id: request.data.request_id },
        "Runtime started receipt отклонён",
      );
      return errorResponse(request.data.request_id, error);
    }
  }

  public async handleExit(
    input: unknown,
  ): Promise<AccessRuntimeReceiptResponse> {
    const requestId = requestIdFrom(input);
    const request = accessRuntimeReceiptRequestSchema.safeParse(input);
    if (
      !request.success ||
      request.data.payload.receipt.purpose !== "runtime-exit-v2"
    ) {
      return errorResponse(
        requestId,
        new AccessServiceError(
          "access_input_invalid",
          "Expected a signed runtime exit receipt",
        ),
      );
    }
    try {
      const receipt = verifiedRuntimeExitReceiptFromSignedEnvelope(
        this.context,
        request.data.payload.receipt,
      );
      const disposition =
        await this.access.completeClaimedRunFromTrustedRuntime(
          this.context,
          receipt,
        );
      return successResponse(request.data.request_id, disposition);
    } catch (error) {
      this.logger.error(
        { err: error, request_id: request.data.request_id },
        "Runtime exit receipt отклонён",
      );
      return errorResponse(request.data.request_id, error);
    }
  }
}
