import { randomUUID } from "node:crypto";

import {
  ACCESS_RUNTIME_AGENT_RUN_LAUNCH_REQUEST_SCHEMA_VERSION,
  ACCESS_RUNTIME_AGENT_RUN_LAUNCH_SUBJECT,
  accessRuntimeAgentRunLaunchResponseSchema,
  type InternalAgentLaunchContract,
} from "@brai/contracts";
import { requestJson, type NatsConnection } from "@brai/nats";

export type RuntimeDispatchInput = Readonly<{
  launchContract: InternalAgentLaunchContract;
  prompt: string;
}>;

export interface RuntimeDispatcher {
  /**
   * Resolves only after the trusted runtime controller durably accepts the
   * exact signed contract and its prompt. The browser never sees either value.
   */
  dispatch(input: RuntimeDispatchInput): Promise<void>;
}

export class RuntimeDispatchError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeDispatchError";
  }
}

export class NatsRuntimeDispatcher implements RuntimeDispatcher {
  public constructor(
    private readonly connection: NatsConnection,
    private readonly timeoutMs = 5_000,
  ) {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 180_000
    ) {
      throw new Error("Invalid runtime dispatch timeout");
    }
  }

  public async dispatch(input: RuntimeDispatchInput): Promise<void> {
    const requestId = randomUUID();
    const rawResponse = await requestJson<unknown, unknown>(
      this.connection,
      ACCESS_RUNTIME_AGENT_RUN_LAUNCH_SUBJECT,
      {
        schema_version: ACCESS_RUNTIME_AGENT_RUN_LAUNCH_REQUEST_SCHEMA_VERSION,
        request_id: requestId,
        sent_at: new Date().toISOString(),
        payload: {
          launch_contract: input.launchContract,
          prompt: input.prompt,
        },
      },
      { timeoutMs: this.timeoutMs },
    );
    const response =
      accessRuntimeAgentRunLaunchResponseSchema.safeParse(rawResponse);
    if (!response.success || response.data.request_id !== requestId) {
      throw new RuntimeDispatchError(
        "Trusted runtime returned an invalid launch acknowledgement",
      );
    }
    if (!response.data.payload.accepted) {
      throw new RuntimeDispatchError(
        `Trusted runtime rejected launch: ${response.data.payload.code}`,
      );
    }
    if (response.data.payload.run_id !== input.launchContract.run_id) {
      throw new RuntimeDispatchError(
        "Trusted runtime acknowledged a different run",
      );
    }
  }
}
