/**
 * Compatibility seam for brai-access. The canonical bytes and constants live
 * in the shared trusted package so contract issuance and host verification
 * cannot silently drift.
 */
export {
  WEB_AGENT_COMMAND,
  WEB_AGENT_COMMAND_SHA256,
  WEB_AGENT_JOB_REFERENCE_PREFIX,
  assertWebAgentJobBinding,
  calculateAgentCommandDigest,
  webAgentJobReference,
  type BoundAgentCommand,
} from "@brai/agent-access";
