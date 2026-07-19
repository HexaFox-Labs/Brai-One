import { randomUUID } from "node:crypto";

import {
  ACCESS_RUNTIME_RECEIPT_CLAIM_SUBJECT,
  ACCESS_RUNTIME_RECEIPT_EXIT_SUBJECT,
  ACCESS_RUNTIME_RECEIPT_REQUEST_SCHEMA_VERSION,
  ACCESS_RUNTIME_RECEIPT_STARTED_SUBJECT,
  accessRuntimeReceiptResponseSchema,
  type SignedTrustedReceiptEnvelope,
} from "@brai/contracts";
import { requestJson, type NatsConnection } from "@brai/nats";

export type RuntimeReceiptSubmissionPurpose =
  "runtime-claim-v2" | "runtime-started-v2" | "runtime-exit-v2";

export interface RuntimeReceiptSubmitter {
  submit(
    receipt: SignedTrustedReceiptEnvelope,
  ): Promise<"applied" | "replayed">;
}

export class RuntimeReceiptRejectedError extends Error {
  public constructor(
    public readonly code:
      "invalid_receipt" | "stale_binding" | "internal_error",
    message: string,
  ) {
    super(message);
    this.name = "RuntimeReceiptRejectedError";
  }
}

function subjectFor(purpose: RuntimeReceiptSubmissionPurpose): string {
  switch (purpose) {
    case "runtime-claim-v2":
      return ACCESS_RUNTIME_RECEIPT_CLAIM_SUBJECT;
    case "runtime-started-v2":
      return ACCESS_RUNTIME_RECEIPT_STARTED_SUBJECT;
    case "runtime-exit-v2":
      return ACCESS_RUNTIME_RECEIPT_EXIT_SUBJECT;
  }
}

export class NatsRuntimeReceiptSubmitter implements RuntimeReceiptSubmitter {
  public constructor(
    private readonly connection: NatsConnection,
    private readonly timeoutMs = 5_000,
  ) {}

  public async submit(
    receipt: SignedTrustedReceiptEnvelope,
  ): Promise<"applied" | "replayed"> {
    if (
      !["runtime-claim-v2", "runtime-started-v2", "runtime-exit-v2"].includes(
        receipt.purpose,
      )
    ) {
      throw new Error(
        `Unsupported runtime receipt purpose: ${receipt.purpose}`,
      );
    }
    const purpose = receipt.purpose as RuntimeReceiptSubmissionPurpose;
    const requestId = randomUUID();
    const raw = await requestJson<unknown, unknown>(
      this.connection,
      subjectFor(purpose),
      {
        schema_version: ACCESS_RUNTIME_RECEIPT_REQUEST_SCHEMA_VERSION,
        request_id: requestId,
        sent_at: new Date().toISOString(),
        payload: { receipt },
      },
      { timeoutMs: this.timeoutMs },
    );
    const response = accessRuntimeReceiptResponseSchema.safeParse(raw);
    if (!response.success || response.data.request_id !== requestId) {
      throw new Error("brai-access returned an invalid receipt CAS response.");
    }
    if (!response.data.payload.accepted) {
      throw new RuntimeReceiptRejectedError(
        response.data.payload.code,
        response.data.payload.message,
      );
    }
    return response.data.payload.disposition;
  }
}
