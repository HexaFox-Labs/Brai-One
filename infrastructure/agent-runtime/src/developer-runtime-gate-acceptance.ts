import { randomUUID } from "node:crypto";
import { access, readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  BRAI_SINGLE_RUNTIME_HOST_ID,
  INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
  LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
  type InternalAgentLaunchContract,
} from "@brai/contracts";

import {
  calculateDeveloperJobDigest,
  developerRuntimeIdentityForAccessReceipt,
  type BoundDeveloperCommand,
} from "./developer-runtime.js";
import { createHostGatedDeveloperRuntimeController } from "./developer-runtime-gate.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function waitForProbe(path: string): Promise<unknown> {
  const deadline = Date.now() + 5_000;
  while (Date.now() <= deadline) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch (error) {
      if (!(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )) {
        throw error;
      }
    }
    await new Promise((resolveSleep) => {
      setTimeout(resolveSleep, 25);
    });
  }
  throw new Error("Gated developer probe did not start after release.");
}

async function main(): Promise<void> {
  if ((process.getuid?.() ?? -1) !== 0) {
    throw new Error("Run the gated developer acceptance as root.");
  }
  const runId = randomUUID();
  const probeResultPath = `/tmp/brai-developer-gate-${runId}.json`;
  const probePath = fileURLToPath(
    new URL("./developer-runtime-acceptance-probe.mjs", import.meta.url),
  );
  const command: BoundDeveloperCommand = {
    schemaVersion: 1,
    executable: "/srv/opt/node-v22.22.3/bin/node",
    arguments: [probePath, probeResultPath],
  };
  const now = new Date();
  const contract: InternalAgentLaunchContract = {
    schema_version: INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
    run_id: runId,
    project_id: randomUUID(),
    environment_id: null,
    runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
    job: {
      reference: `acceptance/developer-gate:${runId}`,
      command_sha256: calculateDeveloperJobDigest(command),
    },
    access: {
      schema_version: LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
      user_id: randomUUID(),
      profile: "developer",
      access_generation: 1,
      quota: { bytes: 5_368_709_120, inodes: 500_000 },
    },
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
    key_id: "acceptance-only",
    signature: "A".repeat(86),
  };
  const controller = createHostGatedDeveloperRuntimeController();
  const prepared = await controller.prepareFromVerifiedContract(
    contract,
    command,
    "",
  );
  let terminated = false;
  try {
    await new Promise((resolveSleep) => {
      setTimeout(resolveSleep, 250);
    });
    if (await exists(probeResultPath)) {
      throw new Error("Target process crossed the gate before durable claim.");
    }
    const identity = developerRuntimeIdentityForAccessReceipt(
      prepared.launchReceipt.identity,
    );
    await controller.release(prepared);
    const probe = await waitForProbe(probeResultPath);
    const termination = await controller.terminate(prepared);
    terminated = true;
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        held_before_release: true,
        identity,
        probe,
        empty_after_termination: termination.remainingPids.length === 0,
      })}\n`,
    );
  } finally {
    if (!terminated) {
      await controller.terminate(prepared).catch(() => undefined);
    }
    await unlink(probeResultPath).catch(() => undefined);
  }
}

await main();
