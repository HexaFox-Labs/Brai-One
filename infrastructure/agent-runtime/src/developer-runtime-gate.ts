import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  chown,
  lstat,
  mkdir,
  open,
  readFile,
  unlink,
} from "node:fs/promises";
import { promisify } from "node:util";

import type { InternalAgentLaunchContract } from "@brai/contracts";

import {
  calculateDeveloperJobDigest,
  createHostDeveloperRuntimeController,
  developerRuntimeLaunchFromVerifiedContract,
  type BoundDeveloperCommand,
  type DeveloperRuntimeExitObservation,
  type DeveloperRuntimeLaunchReceipt,
  type DeveloperRuntimeTerminationReceipt,
  type VerifiedDeveloperRuntimeLaunch,
} from "./developer-runtime.js";

const execFileAsync = promisify(execFile);
const RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GATE_ROOT = "/run/brai-agent-runtime/gates";

export const DEVELOPER_EXEC_GATE_PATH =
  "/srv/opt/brai-agent-runtime/bin/brai-exec-gate";

export interface DeveloperGateDescriptor {
  readonly fifoPath: string;
  readonly readyPath: string;
  readonly stdinPath: string;
  readonly token: string;
}

export interface DeveloperGateStore {
  create(
    runId: string,
    standardInput: string,
  ): Promise<DeveloperGateDescriptor>;
  waitUntilReady(gate: DeveloperGateDescriptor): Promise<void>;
  release(gate: DeveloperGateDescriptor): Promise<void>;
  cleanup(gate: DeveloperGateDescriptor): Promise<void>;
}

export interface DeveloperRuntimeProcessController {
  launch(
    launch: VerifiedDeveloperRuntimeLaunch,
  ): Promise<DeveloperRuntimeLaunchReceipt>;
  terminate(
    receipt: DeveloperRuntimeLaunchReceipt,
  ): Promise<DeveloperRuntimeTerminationReceipt>;
  waitForExit(
    receipt: DeveloperRuntimeLaunchReceipt,
  ): Promise<DeveloperRuntimeExitObservation>;
  collectExited(receipt: DeveloperRuntimeLaunchReceipt): Promise<void>;
}

export interface DeveloperRuntimePreflight {
  verify(runId: string): Promise<void>;
}

export interface PreparedDeveloperRuntime {
  readonly launchReceipt: DeveloperRuntimeLaunchReceipt;
  readonly recovery: PreparedDeveloperRuntimeRecovery;
}

export interface PreparedDeveloperRuntimeRecovery {
  readonly rawLaunchReceipt: DeveloperRuntimeLaunchReceipt;
  readonly mappedLaunchReceipt: DeveloperRuntimeLaunchReceipt;
  readonly gate: DeveloperGateDescriptor;
}

interface PreparedState {
  readonly rawLaunchReceipt: DeveloperRuntimeLaunchReceipt;
  readonly mappedLaunchReceipt: DeveloperRuntimeLaunchReceipt;
  readonly gate: DeveloperGateDescriptor;
  status: "held" | "released" | "terminated";
}

const issuedPreparedRuntimes = new WeakSet<object>();
const preparedStates = new WeakMap<object, PreparedState>();

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  throw new Error(`Developer runtime gate path already exists: ${path}`);
}

async function markIdentity(): Promise<{ uid: number; gid: number }> {
  const [uidResult, gidResult] = await Promise.all([
    execFileAsync("/usr/bin/id", ["-u", "mark"], {
      encoding: "utf8",
    }),
    execFileAsync("/usr/bin/id", ["-g", "mark"], {
      encoding: "utf8",
    }),
  ]);
  const uid = Number(uidResult.stdout.trim());
  const gid = Number(gidResult.stdout.trim());
  if (
    !Number.isSafeInteger(uid) ||
    uid <= 0 ||
    !Number.isSafeInteger(gid) ||
    gid <= 0
  ) {
    throw new Error("Unable to resolve the canonical mark identity.");
  }
  return { uid, gid };
}

export class FilesystemDeveloperGateStore implements DeveloperGateStore {
  public async create(
    runId: string,
    standardInput: string,
  ): Promise<DeveloperGateDescriptor> {
    if ((process.getuid?.() ?? -1) !== 0 || !RUN_ID_PATTERN.test(runId)) {
      throw new Error(
        "Developer runtime gates require root and a canonical run UUID.",
      );
    }
    let gateRootMetadata;
    try {
      gateRootMetadata = await lstat(GATE_ROOT);
    } catch (error) {
      if (!isMissing(error)) throw error;
      await mkdir(GATE_ROOT, { recursive: true, mode: 0o711 });
      gateRootMetadata = await lstat(GATE_ROOT);
    }
    if (
      !gateRootMetadata.isDirectory() ||
      gateRootMetadata.isSymbolicLink() ||
      gateRootMetadata.uid !== 0 ||
      gateRootMetadata.gid !== 0
    ) {
      throw new Error("Developer runtime gate root is not root-owned 0711.");
    }
    await chmod(GATE_ROOT, 0o711);

    const gate = Object.freeze({
      fifoPath: `${GATE_ROOT}/${runId}.release`,
      readyPath: `${GATE_ROOT}/${runId}.ready`,
      stdinPath: `${GATE_ROOT}/${runId}.stdin`,
      token: randomBytes(32).toString("hex"),
    });
    await Promise.all([
      assertAbsent(gate.fifoPath),
      assertAbsent(gate.readyPath),
      assertAbsent(gate.stdinPath),
    ]);
    const mark = await markIdentity();
    try {
      await execFileAsync("/usr/bin/mkfifo", ["-m", "0440", gate.fifoPath]);
      const ready = await open(
        gate.readyPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o620,
      );
      await ready.close();
      const stdin = await open(
        gate.stdinPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o440,
      );
      try {
        await stdin.writeFile(standardInput, "utf8");
        await stdin.sync();
      } finally {
        await stdin.close();
      }
      await Promise.all([
        chown(gate.fifoPath, 0, mark.gid),
        chown(gate.readyPath, 0, mark.gid),
        chown(gate.stdinPath, 0, mark.gid),
      ]);
      await Promise.all([
        chmod(gate.fifoPath, 0o440),
        chmod(gate.readyPath, 0o620),
        chmod(gate.stdinPath, 0o440),
      ]);
      return gate;
    } catch (error) {
      await this.cleanup(gate);
      throw error;
    }
  }

  public async waitUntilReady(gate: DeveloperGateDescriptor): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() <= deadline) {
      const [metadata, content] = await Promise.all([
        lstat(gate.readyPath),
        readFile(gate.readyPath, "utf8"),
      ]);
      if (
        metadata.isFile() &&
        !metadata.isSymbolicLink() &&
        (metadata.mode & 0o7777) === 0o620 &&
        content === "ready\n"
      ) {
        return;
      }
      await new Promise((resolveSleep) => {
        setTimeout(resolveSleep, 25);
      });
    }
    throw new Error("Developer runtime gate did not become ready.");
  }

  public async release(gate: DeveloperGateDescriptor): Promise<void> {
    const fifo = await open(
      gate.fifoPath,
      constants.O_WRONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
    try {
      const release = Buffer.from(`${gate.token}\n`, "utf8");
      const result = await fifo.write(release);
      if (result.bytesWritten !== release.byteLength) {
        throw new Error("Developer runtime gate release was incomplete.");
      }
    } finally {
      await fifo.close();
    }
  }

  public async cleanup(gate: DeveloperGateDescriptor): Promise<void> {
    await Promise.all(
      [gate.fifoPath, gate.readyPath, gate.stdinPath].map(async (path) => {
        await unlink(path).catch((error: unknown) => {
          if (!isMissing(error)) throw error;
        });
      }),
    );
  }
}

function mapLaunchReceipt(
  receipt: DeveloperRuntimeLaunchReceipt,
  jobDigestSha256: string,
): DeveloperRuntimeLaunchReceipt {
  return Object.freeze({
    ...receipt,
    identity: Object.freeze({
      ...receipt.identity,
      jobDigestSha256,
    }),
  });
}

function mapTerminationReceipt(
  receipt: DeveloperRuntimeTerminationReceipt,
  jobDigestSha256: string,
): DeveloperRuntimeTerminationReceipt {
  return Object.freeze({
    ...receipt,
    identity: Object.freeze({
      ...receipt.identity,
      jobDigestSha256,
    }),
  });
}

function requirePrepared(prepared: PreparedDeveloperRuntime): PreparedState {
  if (
    typeof prepared !== "object" ||
    prepared === null ||
    !issuedPreparedRuntimes.has(prepared)
  ) {
    throw new Error(
      "A controller-issued prepared developer runtime is required.",
    );
  }
  const state = preparedStates.get(prepared);
  if (state === undefined) {
    throw new Error("Prepared developer runtime state is unavailable.");
  }
  return state;
}

/**
 * The target process is created as a fixed systemd unit but remains blocked in
 * a tiny root-owned native exec gate. The gate process is measured and can be
 * durably claimed; releasing it uses execve, so PID, cgroup and InvocationID
 * remain the exact identity persisted by brai-access.
 */
export class GatedDeveloperRuntimeController {
  public constructor(
    private readonly processController: DeveloperRuntimeProcessController,
    private readonly gateStore: DeveloperGateStore,
    private readonly preflight: DeveloperRuntimePreflight,
  ) {}

  public async prepareFromVerifiedContract(
    contract: InternalAgentLaunchContract,
    command: BoundDeveloperCommand,
    standardInput: string,
  ): Promise<PreparedDeveloperRuntime> {
    const target = developerRuntimeLaunchFromVerifiedContract(
      contract,
      command,
    );
    await this.preflight.verify(target.runId);
    const gate = await this.gateStore.create(target.runId, standardInput);
    let rawLaunchReceipt: DeveloperRuntimeLaunchReceipt | null = null;
    try {
      const gatedCommand: BoundDeveloperCommand = Object.freeze({
        schemaVersion: 1,
        executable: DEVELOPER_EXEC_GATE_PATH,
        arguments: Object.freeze([
          gate.fifoPath,
          gate.readyPath,
          gate.token,
          "--",
          target.command.executable,
          ...target.command.arguments,
        ]),
      });
      rawLaunchReceipt = await this.processController.launch({
        ...target,
        jobDigestSha256: calculateDeveloperJobDigest(gatedCommand),
        command: gatedCommand,
        standardInputPath: gate.stdinPath,
      });
      await this.gateStore.waitUntilReady(gate);
      const mappedLaunchReceipt = mapLaunchReceipt(
        rawLaunchReceipt,
        target.jobDigestSha256,
      );
      const recovery = Object.freeze({
        rawLaunchReceipt,
        mappedLaunchReceipt,
        gate,
      });
      const prepared = Object.freeze({
        launchReceipt: mappedLaunchReceipt,
        recovery,
      });
      issuedPreparedRuntimes.add(prepared);
      preparedStates.set(prepared, {
        rawLaunchReceipt,
        mappedLaunchReceipt,
        gate,
        status: "held",
      });
      return prepared;
    } catch (error) {
      if (rawLaunchReceipt !== null) {
        await this.processController
          .terminate(rawLaunchReceipt)
          .catch(() => undefined);
      }
      await this.gateStore.cleanup(gate);
      throw error;
    }
  }

  /**
   * Reconstitutes a held gate after only the root host service restarted. Every
   * path and identity remains bound to the immutable run ID; no client data is
   * involved.
   */
  public restoreHeld(
    recovery: PreparedDeveloperRuntimeRecovery,
  ): PreparedDeveloperRuntime {
    const runId = recovery.mappedLaunchReceipt.identity.runId;
    if (
      !RUN_ID_PATTERN.test(runId) ||
      recovery.rawLaunchReceipt.identity.runId !== runId ||
      recovery.rawLaunchReceipt.identity.unitName !==
        recovery.mappedLaunchReceipt.identity.unitName ||
      recovery.rawLaunchReceipt.identity.invocationId !==
        recovery.mappedLaunchReceipt.identity.invocationId ||
      recovery.gate.fifoPath !== `${GATE_ROOT}/${runId}.release` ||
      recovery.gate.readyPath !== `${GATE_ROOT}/${runId}.ready` ||
      recovery.gate.stdinPath !== `${GATE_ROOT}/${runId}.stdin` ||
      !/^[a-f0-9]{64}$/u.test(recovery.gate.token)
    ) {
      throw new Error("Developer runtime recovery record is invalid.");
    }
    const prepared = Object.freeze({
      launchReceipt: recovery.mappedLaunchReceipt,
      recovery,
    });
    issuedPreparedRuntimes.add(prepared);
    preparedStates.set(prepared, {
      rawLaunchReceipt: recovery.rawLaunchReceipt,
      mappedLaunchReceipt: recovery.mappedLaunchReceipt,
      gate: recovery.gate,
      status: "held",
    });
    return prepared;
  }

  public async release(prepared: PreparedDeveloperRuntime): Promise<void> {
    const state = requirePrepared(prepared);
    if (state.status !== "held") {
      throw new Error("Developer runtime gate is no longer held.");
    }
    await this.gateStore.release(state.gate);
    state.status = "released";
    await this.gateStore.cleanup(state.gate);
  }

  public async terminate(
    prepared: PreparedDeveloperRuntime,
  ): Promise<DeveloperRuntimeTerminationReceipt> {
    const state = requirePrepared(prepared);
    if (state.status === "terminated") {
      throw new Error("Developer runtime was already terminated.");
    }
    const receipt = await this.processController.terminate(
      state.rawLaunchReceipt,
    );
    state.status = "terminated";
    await this.gateStore.cleanup(state.gate);
    return mapTerminationReceipt(
      receipt,
      state.mappedLaunchReceipt.identity.jobDigestSha256,
    );
  }

  public async terminateRecovered(
    recovery: PreparedDeveloperRuntimeRecovery,
  ): Promise<DeveloperRuntimeTerminationReceipt> {
    const receipt = await this.processController.terminate(
      recovery.mappedLaunchReceipt,
    );
    await this.gateStore.cleanup(recovery.gate);
    return mapTerminationReceipt(
      receipt,
      recovery.mappedLaunchReceipt.identity.jobDigestSha256,
    );
  }

  public async waitForExit(
    launchReceipt: DeveloperRuntimeLaunchReceipt,
  ): Promise<DeveloperRuntimeExitObservation> {
    return await this.processController.waitForExit(launchReceipt);
  }

  public async collectExited(
    launchReceipt: DeveloperRuntimeLaunchReceipt,
  ): Promise<void> {
    await this.processController.collectExited(launchReceipt);
  }
}

export class SystemdDeveloperRuntimePreflight implements DeveloperRuntimePreflight {
  public async verify(runId: string): Promise<void> {
    if (!RUN_ID_PATTERN.test(runId)) {
      throw new Error("Developer preflight requires a canonical run UUID.");
    }
    const unit = `brai-developer-preflight-${runId}`;
    const result = await execFileAsync(
      "/usr/bin/systemd-run",
      [
        "--quiet",
        "--pipe",
        "--wait",
        "--collect",
        `--unit=${unit}`,
        "--service-type=exec",
        "--property=User=mark",
        "--property=Group=mark",
        "--property=UMask=0077",
        "--property=WorkingDirectory=/srv/projects/brai-new",
        "--property=NoNewPrivileges=no",
        "--property=PrivateTmp=yes",
        "--property=ProtectSystem=no",
        "--property=ProtectHome=no",
        "/srv/opt/node-v22.22.3/bin/node",
        "/srv/opt/brai-agent-runtime/dist/developer-preflight-cli.bundle.js",
      ],
      {
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 1_048_576,
        env: {
          PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
          LC_ALL: "C",
        },
      },
    );
    let preflight: unknown;
    try {
      preflight = JSON.parse(result.stdout);
    } catch {
      throw new Error("Developer preflight returned invalid evidence.");
    }
    if (
      typeof preflight !== "object" ||
      preflight === null ||
      !("ok" in preflight) ||
      preflight.ok !== true ||
      !("profile" in preflight) ||
      preflight.profile !== "developer"
    ) {
      throw new Error("Developer checkout or sudo preflight failed closed.");
    }
  }
}

export function createHostGatedDeveloperRuntimeController(): GatedDeveloperRuntimeController {
  return new GatedDeveloperRuntimeController(
    createHostDeveloperRuntimeController(),
    new FilesystemDeveloperGateStore(),
    new SystemdDeveloperRuntimePreflight(),
  );
}
