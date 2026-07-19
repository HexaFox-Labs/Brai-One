import { describe, expect, it } from "vitest";

import {
  ACCESS_RUNTIME_RECEIPT_REQUEST_SCHEMA_VERSION,
  accessRuntimeReceiptRequestSchema,
  runtimeAgentRunTerminateRequestSchema,
} from "../src/runtime-host.js";

const REQUEST_ID = "0f88bde1-2b49-46cb-914d-7500afdf82d6";

describe("runtime host internal contracts", () => {
  it("accepts only a strict signed receipt transport", () => {
    const request = {
      schema_version: ACCESS_RUNTIME_RECEIPT_REQUEST_SCHEMA_VERSION,
      request_id: REQUEST_ID,
      sent_at: "2026-07-17T12:00:00.000Z",
      payload: {
        receipt: {
          version: 1,
          purpose: "runtime-claim-v2",
          key_id: "runtime-key:2026-07",
          payload: "{}",
          signature: "A".repeat(86),
        },
      },
    };
    expect(accessRuntimeReceiptRequestSchema.safeParse(request).success).toBe(
      true,
    );
    expect(
      accessRuntimeReceiptRequestSchema.safeParse({
        ...request,
        payload: { ...request.payload, profile: "developer" },
      }).success,
    ).toBe(false);
  });

  it("requires the access service to bind exact runtime identity", () => {
    expect(
      runtimeAgentRunTerminateRequestSchema.safeParse({
        schema_version: "brai.runtime.agent-run.terminate.request.v1",
        request_id: REQUEST_ID,
        sent_at: "2026-07-17T12:00:00.000Z",
        payload: {
          project_id: "1f88bde1-2b49-46cb-914d-7500afdf82d6",
          user_id: "2f88bde1-2b49-46cb-914d-7500afdf82d6",
          run_id: "3f88bde1-2b49-46cb-914d-7500afdf82d6",
          access_generation: 3,
          profile: "developer",
          environment_id: null,
          runtime_identity: null,
        },
      }).success,
    ).toBe(true);
  });
});
