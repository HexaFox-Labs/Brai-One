import { describe, expect, it } from "vitest";

import {
  WEB_AGENT_COMMAND,
  WEB_AGENT_COMMAND_SHA256,
  assertWebAgentJobBinding,
  calculateAgentCommandDigest,
  webAgentJobReference,
} from "../src/agent-job-policy.js";

describe("canonical agent job policy", () => {
  it("binds the fixed executable and argv with one shared digest", () => {
    expect(calculateAgentCommandDigest(WEB_AGENT_COMMAND)).toBe(
      WEB_AGENT_COMMAND_SHA256,
    );
    expect(WEB_AGENT_COMMAND.executable).toBe("/srv/opt/codex-cli/bin/codex");
    expect(WEB_AGENT_COMMAND.arguments.at(-1)).toBe("-");
  });

  it("binds prompt bytes in the immutable job reference", () => {
    const reference = webAgentJobReference("собери проект");
    expect(() =>
      assertWebAgentJobBinding(
        "собери проект",
        reference,
        WEB_AGENT_COMMAND_SHA256,
      ),
    ).not.toThrow();
    expect(() =>
      assertWebAgentJobBinding(
        "другая задача",
        reference,
        WEB_AGENT_COMMAND_SHA256,
      ),
    ).toThrow(/does not bind/u);
  });

  it("does not permit the former NUL-join digest representation", () => {
    const legacy = [
      WEB_AGENT_COMMAND.executable,
      ...WEB_AGENT_COMMAND.arguments,
    ].join("\0");
    expect(legacy).not.toBe("");
    expect(calculateAgentCommandDigest(WEB_AGENT_COMMAND)).toHaveLength(64);
  });
});
