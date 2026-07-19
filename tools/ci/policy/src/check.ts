import { resolve } from "node:path";

import { auditWorkspace, resolveAccountIdentity } from "./access-policy.js";
import type { FileIdentity } from "./access-policy.js";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const arguments_ = process.argv.slice(2);

let expectedIdentity: FileIdentity | undefined;
if (arguments_.length === 0) {
  expectedIdentity = undefined;
} else if (
  arguments_.length === 2 &&
  arguments_[0] === "--expected-owner" &&
  arguments_[1] !== undefined
) {
  expectedIdentity = resolveAccountIdentity(arguments_[1]);
} else {
  throw new Error("Usage: check.ts [--expected-owner <Linux account>]");
}

const violations = await auditWorkspace(workspaceRoot, expectedIdentity);

if (violations.length > 0) {
  process.stderr.write(
    `Access policy violations (${violations.length}):\n${violations.map((violation) => `- ${violation}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Access policy: OK\n");
}
