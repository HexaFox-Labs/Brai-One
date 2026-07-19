import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  calculateDeveloperJobDigest,
  createHostDeveloperRuntimeController,
  DEVELOPER_RUNTIME_WORKING_DIRECTORY,
  type BoundDeveloperCommand,
  type DeveloperRuntimeLaunchReceipt,
} from "./developer-runtime.js";

interface ProbeResult {
  readonly uid: number;
  readonly gid: number;
  readonly cwd: string;
  readonly umask: string;
  readonly sudoNonInteractive: boolean;
}

async function waitForProbe(path: string): Promise<ProbeResult> {
  const deadline = Date.now() + 5_000;
  while (Date.now() <= deadline) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as ProbeResult;
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
      setTimeout(resolveSleep, 50);
    });
  }
  throw new Error("Developer runtime acceptance probe did not become ready.");
}

async function main(): Promise<void> {
  if ((process.getuid?.() ?? -1) !== 0) {
    throw new Error(
      "Run this host acceptance as root; only the transient agent process is demoted to mark.",
    );
  }
  const runId = randomUUID();
  const readyPath = `/tmp/brai-developer-runtime-acceptance-${runId}.json`;
  const probePath = fileURLToPath(
    new URL("./developer-runtime-acceptance-probe.mjs", import.meta.url),
  );
  const command: BoundDeveloperCommand = {
    schemaVersion: 1,
    executable: "/srv/opt/node-v22.22.3/bin/node",
    arguments: [probePath, readyPath],
  };
  const controller = createHostDeveloperRuntimeController();
  let launchReceipt: DeveloperRuntimeLaunchReceipt | null = null;
  try {
    launchReceipt = await controller.launch({
      profile: "developer",
      runId,
      jobDigestSha256: calculateDeveloperJobDigest(command),
      command,
    });
    const probe = await waitForProbe(readyPath);
    if (
      probe.uid !== launchReceipt.identity.uid ||
      probe.gid !== launchReceipt.identity.gid ||
      probe.cwd !== DEVELOPER_RUNTIME_WORKING_DIRECTORY ||
      probe.umask !== "0077" ||
      probe.sudoNonInteractive !== true
    ) {
      throw new Error(
        "Developer runtime acceptance probe did not observe the required identity, cwd, umask and sudo contract.",
      );
    }
    const terminationReceipt = await controller.terminate(launchReceipt);
    const completedLaunchReceipt = launchReceipt;
    launchReceipt = null;
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        launch: completedLaunchReceipt,
        terminated: terminationReceipt,
        probe,
      })}\n`,
    );
  } finally {
    if (launchReceipt !== null) {
      await controller.terminate(launchReceipt);
    }
    await unlink(readyPath).catch((error: unknown) => {
      if (!(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )) {
        throw error;
      }
    });
  }
}

await main();
