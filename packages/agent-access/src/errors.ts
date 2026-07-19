import type { AgentAccessErrorCode } from "@brai/contracts";

export class AgentAccessError extends Error {
  readonly code: AgentAccessErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: AgentAccessErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "AgentAccessError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
