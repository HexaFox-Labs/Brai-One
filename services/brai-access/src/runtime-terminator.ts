import { randomUUID } from "node:crypto";

import {
  RUNTIME_AGENT_RUN_TERMINATE_REQUEST_SCHEMA_VERSION,
  RUNTIME_AGENT_RUN_TERMINATE_SUBJECT,
  runtimeAgentRunTerminateResponseSchema,
  type AccessProfile,
  type RuntimeIdentity,
  type SignedTrustedReceiptEnvelope,
} from "@brai/contracts";
import { requestJson, type NatsConnection } from "@brai/nats";

import { RuntimeDispatchError } from "./runtime-dispatcher.js";

export type RuntimeTerminationTarget = Readonly<{
  projectId: string;
  userId: string;
  runId: string;
  profile: AccessProfile;
  environmentId: string | null;
  accessGeneration: number;
  runtimeIdentity: RuntimeIdentity | null;
}>;

export interface RuntimeTerminator {
  /**
   * Returns only the signed controller evidence. The access service verifies
   * the signature and exact persisted binding before changing access state.
   */
  terminate(
    target: RuntimeTerminationTarget,
  ): Promise<SignedTrustedReceiptEnvelope>;
}

export class NatsRuntimeTerminator implements RuntimeTerminator {
  public constructor(
    private readonly connection: NatsConnection,
    private readonly timeoutMs = 15_000,
  ) {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 30_000
    ) {
      throw new Error("Invalid runtime termination timeout");
    }
  }

  public async terminate(
    target: RuntimeTerminationTarget,
  ): Promise<SignedTrustedReceiptEnvelope> {
    const requestId = randomUUID();
    try {
      const rawResponse = await requestJson<unknown, unknown>(
        this.connection,
        RUNTIME_AGENT_RUN_TERMINATE_SUBJECT,
        {
          schema_version: RUNTIME_AGENT_RUN_TERMINATE_REQUEST_SCHEMA_VERSION,
          request_id: requestId,
          sent_at: new Date().toISOString(),
          payload: {
            project_id: target.projectId,
            user_id: target.userId,
            run_id: target.runId,
            profile: target.profile,
            environment_id: target.environmentId,
            access_generation: target.accessGeneration,
            runtime_identity: target.runtimeIdentity,
          },
        },
        { timeoutMs: this.timeoutMs },
      );
      const response =
        runtimeAgentRunTerminateResponseSchema.safeParse(rawResponse);
      if (!response.success || response.data.request_id !== requestId) {
        throw new RuntimeDispatchError(
          "Trusted runtime returned an invalid termination acknowledgement",
        );
      }
      if (!response.data.payload.accepted) {
        throw new RuntimeDispatchError(
          `Trusted runtime rejected termination: ${response.data.payload.code}`,
        );
      }
      if (response.data.payload.run_id !== target.runId) {
        throw new RuntimeDispatchError(
          "Trusted runtime acknowledged a different terminated run",
        );
      }
      return response.data.payload.termination_receipt;
    } catch (error) {
      if (error instanceof RuntimeDispatchError) throw error;
      throw new RuntimeDispatchError(
        "Trusted runtime termination request failed",
        { cause: error },
      );
    }
  }
}
