import { createHash } from "node:crypto";

export const AGENT_COMMAND_SCHEMA_VERSION = 1 as const;
export const WEB_AGENT_JOB_REFERENCE_PREFIX = "brai.web-agent.codex-exec.v1";

export interface BoundAgentCommand {
  readonly schemaVersion: typeof AGENT_COMMAND_SCHEMA_VERSION;
  readonly executable: string;
  readonly arguments: readonly string[];
}

export const WEB_AGENT_COMMAND: BoundAgentCommand = Object.freeze({
  schemaVersion: AGENT_COMMAND_SCHEMA_VERSION,
  executable: "/srv/opt/codex-cli/bin/codex",
  arguments: Object.freeze([
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--ephemeral",
    "--json",
    "-",
  ]),
});

function validateCommand(command: BoundAgentCommand): void {
  const argumentBytes = command.arguments.reduce(
    (total, argument) => total + Buffer.byteLength(argument),
    0,
  );
  if (
    command.schemaVersion !== AGENT_COMMAND_SCHEMA_VERSION ||
    !command.executable.startsWith("/") ||
    command.executable.includes("\0") ||
    command.executable.length > 4_096 ||
    command.arguments.length > 1_024 ||
    argumentBytes > 1_048_576 ||
    command.arguments.some(
      (argument) =>
        argument.includes("\0") || Buffer.byteLength(argument) > 131_072,
    )
  ) {
    throw new Error(
      "Agent command must contain one absolute executable and bounded NUL-free argv.",
    );
  }
}

/**
 * Stable length-prefixed representation shared by the contract issuer and the
 * trusted runtime host. Neither side may substitute join("\0") or JSON.
 */
export function agentCommandSigningBytes(
  command: BoundAgentCommand,
): Uint8Array {
  validateCommand(command);
  const parts = [command.executable, ...command.arguments];
  const buffers: Buffer[] = [
    Buffer.from(`brai-agent-job-v${command.schemaVersion}\0`, "utf8"),
  ];
  for (const part of parts) {
    const value = Buffer.from(part, "utf8");
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(value.byteLength));
    buffers.push(length, value);
  }
  return Buffer.concat(buffers);
}

export function calculateAgentCommandDigest(
  command: BoundAgentCommand,
): string {
  return createHash("sha256")
    .update(agentCommandSigningBytes(command))
    .digest("hex");
}

export const WEB_AGENT_COMMAND_SHA256 =
  calculateAgentCommandDigest(WEB_AGENT_COMMAND);

export function promptSha256(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

export function webAgentJobReference(prompt: string): string {
  return `${WEB_AGENT_JOB_REFERENCE_PREFIX}:${promptSha256(prompt)}`;
}

export function assertWebAgentJobBinding(
  prompt: string,
  reference: string,
  commandSha256: string,
): void {
  if (
    reference !== webAgentJobReference(prompt) ||
    commandSha256 !== WEB_AGENT_COMMAND_SHA256
  ) {
    throw new Error(
      "Launch contract does not bind the approved web-agent command and prompt.",
    );
  }
}
