import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  chown,
  lstat,
  mkdir,
  open,
  readFile,
  stat,
  unlink,
} from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  BRAI_SINGLE_RUNTIME_HOST_ID,
  RUNTIME_IDENTITY_SCHEMA_VERSION,
  userSandboxRuntimeIdentitySchema,
  type InternalAgentLaunchContract,
  type RuntimeIdentity,
} from "@brai/contracts";

import {
  type CommandResult,
  type CommandRunner,
  NodeCommandRunner,
} from "./developer-runtime.js";
import {
  FilesystemUserSandboxEnvironmentResolver,
  type UserSandboxEnvironmentBinding,
  type UserSandboxEnvironmentResolver,
} from "./user-sandbox-environment.js";
import { verifyUserSandboxLaunchBinding } from "./trusted-provisioning-host.js";

const execute = promisify(execFile);
const RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BOOT_ID_PATTERN = RUN_ID_PATTERN;
const INVOCATION_ID_PATTERN = /^[0-9a-f]{32}$/u;
const DECIMAL_PATTERN = /^[1-9][0-9]*$/u;
const SANDBOX_GATE_EXECUTABLE = "/usr/libexec/brai/brai-exec-gate";
const SANDBOX_CODEX_EXECUTABLE = "/usr/local/bin/brai-codex-exec";
const SANDBOX_GATE_HOST_ROOT = "/var/lib/brai-agent-runtime/user-gates";
const SANDBOX_GATE_GUEST_ROOT = "/run/brai-agent-gates";

export const USER_SANDBOX_RUNTIME_RECEIPT_SCHEMA_VERSION = 1 as const;

export interface UserSandboxRuntimeIdentity {
  readonly schemaVersion: typeof USER_SANDBOX_RUNTIME_RECEIPT_SCHEMA_VERSION;
  readonly profile: "user-sandbox";
  readonly runId: string;
  readonly jobDigestSha256: string;
  readonly environmentId: string;
  readonly userId: string;
  readonly accessGeneration: number;
  readonly environmentName: string;
  readonly machineName: string;
  readonly unitName: string;
  readonly innerMainPid: number;
  readonly bootId: string;
  readonly invocationId: string;
  readonly controlGroup: string;
  readonly controlGroupInode: string;
  readonly mainPid: number;
  readonly mainPidStartTimeTicks: string;
  readonly outerRootUid: number;
  readonly imageBraiUid: number;
  readonly systemd: {
    readonly user: "root";
    readonly group: "root";
    readonly workingDirectory: "/data/workspace";
    readonly umask: "0077";
    readonly killMode: "control-group";
    readonly noNewPrivileges: true;
    readonly remainAfterExit: true;
  };
}

export interface UserSandboxRuntimeLaunchReceipt {
  readonly kind: "user-sandbox-runtime-launched";
  readonly schemaVersion: typeof USER_SANDBOX_RUNTIME_RECEIPT_SCHEMA_VERSION;
  readonly observedAt: string;
  readonly identity: UserSandboxRuntimeIdentity;
}

export interface UserSandboxRuntimeTerminationReceipt {
  readonly kind: "user-sandbox-runtime-terminated";
  readonly schemaVersion: typeof USER_SANDBOX_RUNTIME_RECEIPT_SCHEMA_VERSION;
  readonly observedAt: string;
  readonly identity: UserSandboxRuntimeIdentity;
  readonly alreadyInactive: boolean;
  readonly escalatedToSigkill: boolean;
  readonly finalActiveState: "inactive" | "failed" | "not-found";
  readonly remainingPids: readonly number[];
}

export interface UserSandboxRuntimeExitObservation {
  readonly observedAt: string;
  readonly identity: UserSandboxRuntimeIdentity;
  readonly outcome: "succeeded" | "failed";
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export interface UserSandboxGateDescriptor {
  readonly fifoHostPath: string;
  readonly readyHostPath: string;
  readonly stdinHostPath: string;
  readonly fifoGuestPath: string;
  readonly readyGuestPath: string;
  readonly stdinGuestPath: string;
  readonly token: string;
}

export interface PreparedUserSandboxRuntimeRecovery {
  readonly launchReceipt: UserSandboxRuntimeLaunchReceipt;
  readonly gate: UserSandboxGateDescriptor;
}

export interface PreparedUserSandboxRuntime {
  readonly launchReceipt: UserSandboxRuntimeLaunchReceipt;
  readonly recovery: PreparedUserSandboxRuntimeRecovery;
}

export interface UserSandboxRuntimeController {
  prepareFromVerifiedContract(
    contract: InternalAgentLaunchContract,
    standardInput: string,
  ): Promise<PreparedUserSandboxRuntime>;
  restoreHeld(
    recovery: PreparedUserSandboxRuntimeRecovery,
  ): PreparedUserSandboxRuntime;
  release(prepared: PreparedUserSandboxRuntime): Promise<void>;
  terminate(
    prepared: PreparedUserSandboxRuntime,
  ): Promise<UserSandboxRuntimeTerminationReceipt>;
  terminateRecovered(
    recovery: PreparedUserSandboxRuntimeRecovery,
  ): Promise<UserSandboxRuntimeTerminationReceipt>;
  waitForExit(
    receipt: UserSandboxRuntimeLaunchReceipt,
  ): Promise<UserSandboxRuntimeExitObservation>;
  collectExited(receipt: UserSandboxRuntimeLaunchReceipt): Promise<void>;
}

export function userSandboxRuntimeIdentityForAccessReceipt(
  identity: UserSandboxRuntimeIdentity,
): RuntimeIdentity {
  const cgroupInode = Number(identity.controlGroupInode);
  const startTime = Number(identity.mainPidStartTimeTicks);
  if (
    !Number.isSafeInteger(cgroupInode) ||
    cgroupInode <= 0 ||
    !Number.isSafeInteger(startTime) ||
    startTime <= 0
  ) {
    throw new UserSandboxRuntimeError(
      "USER_SANDBOX_RUNTIME_MEASUREMENT_INVALID",
      "Sandbox cgroup or process identity exceeds the durable receipt range.",
    );
  }
  return userSandboxRuntimeIdentitySchema.parse({
    schema_version: RUNTIME_IDENTITY_SCHEMA_VERSION,
    runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
    profile: "user-sandbox",
    boot_id: identity.bootId,
    systemd_invocation_id: identity.invocationId,
    unit: identity.unitName,
    cgroup_path: identity.controlGroup,
    cgroup_inode: cgroupInode,
    leader_pid: identity.mainPid,
    leader_start_time_ticks: startTime,
    machine: identity.machineName,
  });
}

export type UserSandboxRuntimeErrorCode =
  | "USER_SANDBOX_RUNTIME_INPUT_INVALID"
  | "USER_SANDBOX_RUNTIME_MACHINE_UNAVAILABLE"
  | "USER_SANDBOX_RUNTIME_UNIT_ALREADY_EXISTS"
  | "USER_SANDBOX_RUNTIME_SYSTEMD_COMMAND_FAILED"
  | "USER_SANDBOX_RUNTIME_START_TIMEOUT"
  | "USER_SANDBOX_RUNTIME_MEASUREMENT_INVALID"
  | "USER_SANDBOX_RUNTIME_IDENTITY_MISMATCH"
  | "USER_SANDBOX_RUNTIME_TERMINATION_TIMEOUT";

export class UserSandboxRuntimeError extends Error {
  public constructor(
    public readonly code: UserSandboxRuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UserSandboxRuntimeError";
  }
}

interface UnitFacts {
  readonly loadState: string;
  readonly activeState: string;
  readonly subState: string;
  readonly user: string;
  readonly group: string;
  readonly workingDirectory: string;
  readonly umask: string;
  readonly killMode: string;
  readonly noNewPrivileges: string;
  readonly remainAfterExit: string;
  readonly invocationId: string;
  readonly controlGroup: string;
  readonly mainPid: number;
  readonly execMainCode: number;
  readonly execMainStatus: number;
  readonly result: string;
}

interface MachineServiceFacts {
  readonly loadState: string;
  readonly activeState: string;
  readonly subState: string;
  readonly controlGroup: string;
  readonly mainPid: number;
}

interface ProcessFacts {
  readonly uid: number;
  readonly gid: number;
  readonly startTimeTicks: string;
  readonly namespacePids: readonly number[];
  readonly controlGroup: string;
}

export interface UserSandboxRuntimeInspector {
  readBootId(): Promise<string>;
  readProcess(pid: number): Promise<ProcessFacts>;
  readCgroupInode(controlGroup: string): Promise<string>;
  listCgroupPids(controlGroup: string): Promise<readonly number[]>;
  cgroupExists(controlGroup: string): Promise<boolean>;
}

export interface UserSandboxRuntimeClock {
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
}

export interface UserSandboxGateStore {
  create(
    binding: UserSandboxEnvironmentBinding,
    runId: string,
    standardInput: string,
  ): Promise<UserSandboxGateDescriptor>;
  waitUntilReady(
    binding: UserSandboxEnvironmentBinding,
    gate: UserSandboxGateDescriptor,
  ): Promise<void>;
  release(gate: UserSandboxGateDescriptor): Promise<void>;
  cleanup(gate: UserSandboxGateDescriptor): Promise<void>;
}

export interface NspawnUserSandboxRuntimeControllerOptions {
  readonly runner: CommandRunner;
  readonly inspector: UserSandboxRuntimeInspector;
  readonly environmentResolver: UserSandboxEnvironmentResolver;
  readonly gateStore: UserSandboxGateStore;
  readonly preflight: (binding: UserSandboxEnvironmentBinding) => Promise<void>;
  readonly clock?: UserSandboxRuntimeClock;
  readonly launchTimeoutMilliseconds?: number;
  readonly gracefulStopMilliseconds?: number;
  readonly forceStopMilliseconds?: number;
}

const defaultClock: UserSandboxRuntimeClock = {
  now: () => new Date(),
  sleep: (milliseconds) =>
    new Promise((resolveSleep) => {
      setTimeout(resolveSleep, milliseconds);
    }),
};

function keyValues(output: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const line of output.split("\n")) {
    if (line === "") continue;
    const separator = line.indexOf("=");
    if (separator > 0) {
      values.set(line.slice(0, separator), line.slice(separator + 1));
    }
  }
  return values;
}

function numberOrZero(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseUnitFacts(result: CommandResult): UnitFacts | null {
  if (result.exitCode !== 0) return null;
  const values = keyValues(result.stdout);
  return {
    loadState: values.get("LoadState") ?? "",
    activeState: values.get("ActiveState") ?? "",
    subState: values.get("SubState") ?? "",
    user: values.get("User") ?? "",
    group: values.get("Group") ?? "",
    workingDirectory: values.get("WorkingDirectory") ?? "",
    umask: values.get("UMask") ?? "",
    killMode: values.get("KillMode") ?? "",
    noNewPrivileges: values.get("NoNewPrivileges") ?? "",
    remainAfterExit: values.get("RemainAfterExit") ?? "",
    invocationId: values.get("InvocationID") ?? "",
    controlGroup: values.get("ControlGroup") ?? "",
    mainPid: numberOrZero(values.get("MainPID")),
    execMainCode: numberOrZero(values.get("ExecMainCode")),
    execMainStatus: numberOrZero(values.get("ExecMainStatus")),
    result: values.get("Result") ?? "",
  };
}

function parseMachineServiceFacts(
  result: CommandResult,
): MachineServiceFacts | null {
  if (result.exitCode !== 0) return null;
  const values = keyValues(result.stdout);
  return {
    loadState: values.get("LoadState") ?? "",
    activeState: values.get("ActiveState") ?? "",
    subState: values.get("SubState") ?? "",
    controlGroup: values.get("ControlGroup") ?? "",
    mainPid: numberOrZero(values.get("MainPID")),
  };
}

function cgroupPath(path: string): string {
  if (
    !path.startsWith("/") ||
    path.includes("\0") ||
    path.split("/").some((part) => part === "..")
  ) {
    throw new UserSandboxRuntimeError(
      "USER_SANDBOX_RUNTIME_MEASUREMENT_INVALID",
      "Kernel returned an invalid cgroup path.",
    );
  }
  const root = "/sys/fs/cgroup";
  const resolved = resolve(root, `.${path}`);
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new UserSandboxRuntimeError(
      "USER_SANDBOX_RUNTIME_MEASUREMENT_INVALID",
      "Cgroup path escapes the unified hierarchy.",
    );
  }
  return resolved;
}

async function collectCgroupPids(
  directory: string,
): Promise<readonly number[]> {
  const values = new Set<number>();
  let entries;
  try {
    entries = await import("node:fs/promises").then(({ readdir }) =>
      readdir(directory, { withFileTypes: true }),
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
  try {
    const direct = await readFile(`${directory}/cgroup.procs`, "utf8");
    for (const token of direct.split(/\s+/)) {
      const pid = Number(token);
      if (Number.isSafeInteger(pid) && pid > 0) values.add(pid);
    }
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
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => collectCgroupPids(`${directory}/${entry.name}`)),
  );
  for (const pids of nested) {
    for (const pid of pids) values.add(pid);
  }
  return [...values].sort((left, right) => left - right);
}

function parseProcessStat(content: string): string {
  const commandEnd = content.lastIndexOf(") ");
  const fields =
    commandEnd < 0
      ? []
      : content
          .slice(commandEnd + 2)
          .trim()
          .split(/\s+/);
  const value = fields[19];
  if (value === undefined || !DECIMAL_PATTERN.test(value)) {
    throw new UserSandboxRuntimeError(
      "USER_SANDBOX_RUNTIME_MEASUREMENT_INVALID",
      "Process start time cannot be measured.",
    );
  }
  return value;
}

function parseStatus(content: string): {
  readonly uid: number;
  readonly gid: number;
  readonly namespacePids: readonly number[];
} {
  const line = (name: string): string =>
    content
      .split("\n")
      .find((candidate) => candidate.startsWith(`${name}:`))
      ?.slice(name.length + 1)
      .trim() ?? "";
  const uid = Number(line("Uid").split(/\s+/)[0]);
  const gid = Number(line("Gid").split(/\s+/)[0]);
  const namespacePids = line("NSpid").split(/\s+/).filter(Boolean).map(Number);
  if (
    !Number.isSafeInteger(uid) ||
    uid < 0 ||
    !Number.isSafeInteger(gid) ||
    gid < 0 ||
    namespacePids.length < 1 ||
    namespacePids.some((pid) => !Number.isSafeInteger(pid) || pid < 1)
  ) {
    throw new UserSandboxRuntimeError(
      "USER_SANDBOX_RUNTIME_MEASUREMENT_INVALID",
      "Process namespace identity cannot be measured.",
    );
  }
  return { uid, gid, namespacePids };
}

function parseProcessCgroup(content: string): string {
  const entries = content
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(":"));
  const unified = entries.find((entry) => entry[0] === "0" && entry[1] === "");
  const value = unified?.[2];
  if (value === undefined || !value.startsWith("/")) {
    throw new UserSandboxRuntimeError(
      "USER_SANDBOX_RUNTIME_MEASUREMENT_INVALID",
      "Process is not attached to the unified cgroup hierarchy.",
    );
  }
  cgroupPath(value);
  return value;
}

export class ProcfsUserSandboxRuntimeInspector implements UserSandboxRuntimeInspector {
  public async readBootId(): Promise<string> {
    return (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  }

  public async readProcess(pid: number): Promise<ProcessFacts> {
    const [statusContent, statContent, cgroupContent] = await Promise.all([
      readFile(`/proc/${pid}/status`, "utf8"),
      readFile(`/proc/${pid}/stat`, "utf8"),
      readFile(`/proc/${pid}/cgroup`, "utf8"),
    ]);
    return {
      ...parseStatus(statusContent),
      startTimeTicks: parseProcessStat(statContent),
      controlGroup: parseProcessCgroup(cgroupContent),
    };
  }

  public async readCgroupInode(controlGroup: string): Promise<string> {
    const metadata = await stat(cgroupPath(controlGroup), { bigint: true });
    return metadata.ino.toString();
  }

  public async listCgroupPids(
    controlGroup: string,
  ): Promise<readonly number[]> {
    return await collectCgroupPids(cgroupPath(controlGroup));
  }

  public async cgroupExists(controlGroup: string): Promise<boolean> {
    try {
      await stat(cgroupPath(controlGroup));
      return true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function gatePaths(
  binding: UserSandboxEnvironmentBinding,
  runId: string,
): UserSandboxGateDescriptor {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new UserSandboxRuntimeError(
      "USER_SANDBOX_RUNTIME_INPUT_INVALID",
      "Sandbox run ID must be a canonical UUID.",
    );
  }
  const hostRoot = `${SANDBOX_GATE_HOST_ROOT}/${binding.environmentName}`;
  const guestRoot = SANDBOX_GATE_GUEST_ROOT;
  return {
    fifoHostPath: `${hostRoot}/${runId}.release`,
    readyHostPath: `${hostRoot}/${runId}.ready`,
    stdinHostPath: `${hostRoot}/${runId}.stdin`,
    fifoGuestPath: `${guestRoot}/${runId}.release`,
    readyGuestPath: `${guestRoot}/${runId}.ready`,
    stdinGuestPath: `${guestRoot}/${runId}.stdin`,
    token: randomBytes(32).toString("hex"),
  };
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  throw new UserSandboxRuntimeError(
    "USER_SANDBOX_RUNTIME_UNIT_ALREADY_EXISTS",
    `Sandbox gate path already exists: ${path}`,
  );
}

export class FilesystemUserSandboxGateStore implements UserSandboxGateStore {
  public async create(
    binding: UserSandboxEnvironmentBinding,
    runId: string,
    standardInput: string,
  ): Promise<UserSandboxGateDescriptor> {
    if ((process.geteuid?.() ?? -1) !== 0) {
      throw new UserSandboxRuntimeError(
        "USER_SANDBOX_RUNTIME_INPUT_INVALID",
        "Sandbox gate creation requires the trusted root host service.",
      );
    }
    const gate = gatePaths(binding, runId);
    await mkdir(SANDBOX_GATE_HOST_ROOT, {
      recursive: true,
      mode: 0o700,
    });
    const parentMetadata = await lstat(SANDBOX_GATE_HOST_ROOT);
    if (
      parentMetadata.isSymbolicLink() ||
      !parentMetadata.isDirectory() ||
      parentMetadata.uid !== 0 ||
      parentMetadata.gid !== 0 ||
      (parentMetadata.mode & 0o7777) !== 0o700
    ) {
      throw new UserSandboxRuntimeError(
        "USER_SANDBOX_RUNTIME_MEASUREMENT_INVALID",
        "Sandbox gate parent must be root:root 0700.",
      );
    }
    const root = `${SANDBOX_GATE_HOST_ROOT}/${binding.environmentName}`;
    try {
      await mkdir(root, { mode: 0o700 });
      await chown(root, binding.outerRootUid, binding.outerRootGid);
    } catch (error) {
      if (!(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      )) {
        throw error;
      }
    }
    const rootMetadata = await lstat(root);
    if (
      rootMetadata.isSymbolicLink() ||
      !rootMetadata.isDirectory() ||
      rootMetadata.uid !== binding.outerRootUid ||
      rootMetadata.gid !== binding.outerRootGid ||
      (rootMetadata.mode & 0o7777) !== 0o700
    ) {
      throw new UserSandboxRuntimeError(
        "USER_SANDBOX_RUNTIME_MEASUREMENT_INVALID",
        "Sandbox gate directory is not protected by the outer-root mapping.",
      );
    }
    await Promise.all([
      assertAbsent(gate.fifoHostPath),
      assertAbsent(gate.readyHostPath),
      assertAbsent(gate.stdinHostPath),
    ]);
    try {
      await execute("/usr/bin/mkfifo", ["-m", "0440", gate.fifoHostPath], {
        env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LC_ALL: "C" },
      });
      const ready = await open(
        gate.readyHostPath,
        fsConstants.O_WRONLY |
          fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          fsConstants.O_NOFOLLOW,
        0o620,
      );
      await ready.close();
      const stdin = await open(
        gate.stdinHostPath,
        fsConstants.O_WRONLY |
          fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          fsConstants.O_NOFOLLOW,
        0o440,
      );
      try {
        await stdin.writeFile(standardInput, "utf8");
        await stdin.sync();
      } finally {
        await stdin.close();
      }
      await Promise.all([
        chown(gate.fifoHostPath, binding.outerRootUid, binding.outerRootGid),
        chown(gate.readyHostPath, binding.outerRootUid, binding.outerRootGid),
        chown(gate.stdinHostPath, binding.outerRootUid, binding.outerRootGid),
      ]);
      await Promise.all([
        chmod(gate.fifoHostPath, 0o440),
        chmod(gate.readyHostPath, 0o620),
        chmod(gate.stdinHostPath, 0o440),
      ]);
      return Object.freeze(gate);
    } catch (error) {
      await this.cleanup(gate);
      throw error;
    }
  }

  public async waitUntilReady(
    binding: UserSandboxEnvironmentBinding,
    gate: UserSandboxGateDescriptor,
  ): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() <= deadline) {
      const [metadata, content] = await Promise.all([
        lstat(gate.readyHostPath),
        readFile(gate.readyHostPath, "utf8"),
      ]);
      if (
        metadata.isFile() &&
        !metadata.isSymbolicLink() &&
        metadata.uid === binding.outerRootUid &&
        metadata.gid === binding.outerRootGid &&
        (metadata.mode & 0o7777) === 0o620 &&
        content === "ready\n"
      ) {
        return;
      }
      await new Promise((resolveSleep) => {
        setTimeout(resolveSleep, 25);
      });
    }
    throw new UserSandboxRuntimeError(
      "USER_SANDBOX_RUNTIME_START_TIMEOUT",
      "Sandbox runtime gate did not become ready.",
    );
  }

  public async release(gate: UserSandboxGateDescriptor): Promise<void> {
    const fifo = await open(
      gate.fifoHostPath,
      fsConstants.O_WRONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW,
    );
    try {
      const content = Buffer.from(`${gate.token}\n`, "utf8");
      const result = await fifo.write(content);
      if (result.bytesWritten !== content.length) {
        throw new Error("Sandbox gate release was incomplete.");
      }
    } finally {
      await fifo.close();
    }
  }

  public async cleanup(gate: UserSandboxGateDescriptor): Promise<void> {
    await Promise.all(
      [gate.fifoHostPath, gate.readyHostPath, gate.stdinHostPath].map(
        async (path) => {
          await unlink(path).catch((error: unknown) => {
            if (!isMissing(error)) throw error;
          });
        },
      ),
    );
  }
}

interface PreparedState {
  readonly recovery: PreparedUserSandboxRuntimeRecovery;
  status: "held" | "released" | "terminated";
}

const issuedPrepared = new WeakSet<object>();
const preparedStates = new WeakMap<object, PreparedState>();

function requirePrepared(prepared: PreparedUserSandboxRuntime): PreparedState {
  if (!issuedPrepared.has(prepared)) {
    throw new UserSandboxRuntimeError(
      "USER_SANDBOX_RUNTIME_INPUT_INVALID",
      "A controller-issued prepared sandbox runtime is required.",
    );
  }
  const state = preparedStates.get(prepared);
  if (state === undefined) {
    throw new UserSandboxRuntimeError(
      "USER_SANDBOX_RUNTIME_INPUT_INVALID",
      "Prepared sandbox runtime state is unavailable.",
    );
  }
  return state;
}

function commandFailure(
  executable: string,
  result: CommandResult,
): UserSandboxRuntimeError {
  return new UserSandboxRuntimeError(
    "USER_SANDBOX_RUNTIME_SYSTEMD_COMMAND_FAILED",
    `${executable} exited ${result.exitCode}${
      result.stderr.trim() === ""
        ? ""
        : `: ${result.stderr.trim().slice(0, 1_024)}`
    }`,
  );
}

export class NspawnUserSandboxRuntimeController implements UserSandboxRuntimeController {
  readonly #runner: CommandRunner;
  readonly #inspector: UserSandboxRuntimeInspector;
  readonly #resolver: UserSandboxEnvironmentResolver;
  readonly #gateStore: UserSandboxGateStore;
  readonly #preflight: (
    binding: UserSandboxEnvironmentBinding,
  ) => Promise<void>;
  readonly #clock: UserSandboxRuntimeClock;
  readonly #launchTimeout: number;
  readonly #gracefulStop: number;
  readonly #forceStop: number;
  readonly #machineLocks = new Map<string, Promise<void>>();

  public constructor(options: NspawnUserSandboxRuntimeControllerOptions) {
    this.#runner = options.runner;
    this.#inspector = options.inspector;
    this.#resolver = options.environmentResolver;
    this.#gateStore = options.gateStore;
    this.#preflight = options.preflight;
    this.#clock = options.clock ?? defaultClock;
    this.#launchTimeout = options.launchTimeoutMilliseconds ?? 30_000;
    this.#gracefulStop = options.gracefulStopMilliseconds ?? 5_000;
    this.#forceStop = options.forceStopMilliseconds ?? 5_000;
  }

  async #withMachineLock<Output>(
    machine: string,
    action: () => Promise<Output>,
  ): Promise<Output> {
    const previous = this.#machineLocks.get(machine) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveRelease) => {
      release = resolveRelease;
    });
    const tail = previous.then(() => current);
    this.#machineLocks.set(machine, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.#machineLocks.get(machine) === tail) {
        this.#machineLocks.delete(machine);
      }
    }
  }

  async #showMachineService(
    binding: UserSandboxEnvironmentBinding,
  ): Promise<MachineServiceFacts | null> {
    return parseMachineServiceFacts(
      await this.#runner.run("/usr/bin/systemctl", [
        "show",
        "--no-pager",
        "--property=LoadState",
        "--property=ActiveState",
        "--property=SubState",
        "--property=ControlGroup",
        "--property=MainPID",
        `brai-user-sandbox@${binding.environmentName}.service`,
      ]),
    );
  }

  async #machineState(
    binding: UserSandboxEnvironmentBinding,
  ): Promise<Readonly<{ state: string; leader: number }> | null> {
    const result = await this.#runner.run("/usr/bin/machinectl", [
      "show",
      "--property=State",
      "--property=Leader",
      binding.machineName,
    ]);
    if (result.exitCode !== 0) return null;
    const values = keyValues(result.stdout);
    return {
      state: values.get("State") ?? "",
      leader: numberOrZero(values.get("Leader")),
    };
  }

  async #machineManagerReady(machine: string): Promise<boolean> {
    const result = await this.#runner.run("/usr/bin/systemctl", [
      `--machine=${machine}`,
      "show",
      "--property=Version",
      "--value",
    ]);
    return result.exitCode === 0 && result.stdout.trim() !== "";
  }

  async #ensureMachine(
    binding: UserSandboxEnvironmentBinding,
  ): Promise<MachineServiceFacts> {
    await this.#preflight(binding);
    return await this.#withMachineLock(binding.machineName, async () => {
      const service = await this.#showMachineService(binding);
      if (
        service === null ||
        service.loadState === "not-found" ||
        service.activeState !== "active"
      ) {
        const started = await this.#runner.run("/usr/bin/systemctl", [
          "start",
          `brai-user-sandbox@${binding.environmentName}.service`,
        ]);
        if (started.exitCode !== 0) {
          throw commandFailure("/usr/bin/systemctl", started);
        }
      }
      const deadline = this.#clock.now().getTime() + this.#launchTimeout;
      while (this.#clock.now().getTime() <= deadline) {
        const [nextService, machine, managerReady] = await Promise.all([
          this.#showMachineService(binding),
          this.#machineState(binding),
          this.#machineManagerReady(binding.machineName),
        ]);
        if (
          nextService !== null &&
          nextService.loadState === "loaded" &&
          nextService.activeState === "active" &&
          nextService.subState === "running" &&
          nextService.mainPid > 0 &&
          nextService.controlGroup !== "" &&
          machine?.state === "running" &&
          machine.leader > 0 &&
          managerReady
        ) {
          const pids = await this.#inspector.listCgroupPids(
            nextService.controlGroup,
          );
          if (!pids.includes(machine.leader)) {
            throw new UserSandboxRuntimeError(
              "USER_SANDBOX_RUNTIME_MEASUREMENT_INVALID",
              "Registered machine leader is outside its fixed host unit.",
            );
          }
          return nextService;
        }
        await this.#clock.sleep(50);
      }
      throw new UserSandboxRuntimeError(
        "USER_SANDBOX_RUNTIME_MACHINE_UNAVAILABLE",
        "Persistent user nspawn machine did not become measurable.",
      );
    });
  }

  async #showUnit(machine: string, unit: string): Promise<UnitFacts | null> {
    return parseUnitFacts(
      await this.#runner.run("/usr/bin/systemctl", [
        `--machine=${machine}`,
        "show",
        "--no-pager",
        "--property=LoadState",
        "--property=ActiveState",
        "--property=SubState",
        "--property=User",
        "--property=Group",
        "--property=WorkingDirectory",
        "--property=UMask",
        "--property=KillMode",
        "--property=NoNewPrivileges",
        "--property=RemainAfterExit",
        "--property=InvocationID",
        "--property=ControlGroup",
        "--property=MainPID",
        "--property=ExecMainCode",
        "--property=ExecMainStatus",
        "--property=Result",
        unit,
      ]),
    );
  }

  async #findHostPid(
    machineControlGroup: string,
    innerPid: number,
    expectedUid: number,
  ): Promise<Readonly<{ pid: number; process: ProcessFacts }>> {
    const matches = [];
    for (const pid of await this.#inspector.listCgroupPids(
      machineControlGroup,
    )) {
      try {
        const process = await this.#inspector.readProcess(pid);
        if (
          process.uid === expectedUid &&
          process.namespacePids.at(-1) === innerPid
        ) {
          matches.push({ pid, process });
        }
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    if (matches.length !== 1) {
      throw new UserSandboxRuntimeError(
        "USER_SANDBOX_RUNTIME_MEASUREMENT_INVALID",
        "Inner systemd MainPID has no unique host PID mapping.",
      );
    }
    return matches[0]!;
  }

  async #waitForStarted(
    contract: InternalAgentLaunchContract,
    binding: UserSandboxEnvironmentBinding,
    machineService: MachineServiceFacts,
    unitName: string,
  ): Promise<UserSandboxRuntimeIdentity> {
    const deadline = this.#clock.now().getTime() + this.#launchTimeout;
    while (this.#clock.now().getTime() <= deadline) {
      const facts = await this.#showUnit(binding.machineName, unitName);
      if (
        facts !== null &&
        facts.loadState === "loaded" &&
        facts.activeState === "active" &&
        facts.subState === "running" &&
        facts.mainPid > 0
      ) {
        if (
          facts.user !== "root" ||
          facts.group !== "root" ||
          facts.workingDirectory !== "/data/workspace" ||
          facts.umask !== "0077" ||
          facts.killMode !== "control-group" ||
          facts.noNewPrivileges !== "yes" ||
          facts.remainAfterExit !== "yes" ||
          !INVOCATION_ID_PATTERN.test(facts.invocationId) ||
          facts.controlGroup === ""
        ) {
          throw new UserSandboxRuntimeError(
            "USER_SANDBOX_RUNTIME_MEASUREMENT_INVALID",
            "Inner transient unit differs from the fixed sandbox policy.",
          );
        }
        const host = await this.#findHostPid(
          machineService.controlGroup,
          facts.mainPid,
          binding.outerRootUid,
        );
        const [bootId, cgroupInode] = await Promise.all([
          this.#inspector.readBootId(),
          this.#inspector.readCgroupInode(host.process.controlGroup),
        ]);
        if (
          !BOOT_ID_PATTERN.test(bootId) ||
          !DECIMAL_PATTERN.test(cgroupInode) ||
          host.process.gid !== binding.outerRootGid
        ) {
          throw new UserSandboxRuntimeError(
            "USER_SANDBOX_RUNTIME_MEASUREMENT_INVALID",
            "Sandbox gate process or cgroup identity is invalid.",
          );
        }
        return Object.freeze({
          schemaVersion: USER_SANDBOX_RUNTIME_RECEIPT_SCHEMA_VERSION,
          profile: "user-sandbox",
          runId: contract.run_id,
          jobDigestSha256: contract.job.command_sha256,
          environmentId: binding.environmentId,
          userId: binding.userId,
          accessGeneration: contract.access.access_generation,
          environmentName: binding.environmentName,
          machineName: binding.machineName,
          unitName,
          innerMainPid: facts.mainPid,
          bootId,
          invocationId: facts.invocationId,
          controlGroup: host.process.controlGroup,
          controlGroupInode: cgroupInode,
          mainPid: host.pid,
          mainPidStartTimeTicks: host.process.startTimeTicks,
          outerRootUid: binding.outerRootUid,
          imageBraiUid: binding.imageBraiUid,
          systemd: Object.freeze({
            user: "root",
            group: "root",
            workingDirectory: "/data/workspace",
            umask: "0077",
            killMode: "control-group",
            noNewPrivileges: true,
            remainAfterExit: true,
          }),
        });
      }
      if (
        facts !== null &&
        ["failed", "inactive"].includes(facts.activeState)
      ) {
        throw new UserSandboxRuntimeError(
          "USER_SANDBOX_RUNTIME_SYSTEMD_COMMAND_FAILED",
          `Sandbox unit became ${facts.activeState}/${facts.subState} before measurement.`,
        );
      }
      await this.#clock.sleep(50);
    }
    throw new UserSandboxRuntimeError(
      "USER_SANDBOX_RUNTIME_START_TIMEOUT",
      "Sandbox gate unit did not reach a measurable running state.",
    );
  }

  public async prepareFromVerifiedContract(
    contract: InternalAgentLaunchContract,
    standardInput: string,
  ): Promise<PreparedUserSandboxRuntime> {
    if (
      contract.access.profile !== "user-sandbox" ||
      contract.environment_id === null ||
      !RUN_ID_PATTERN.test(contract.run_id)
    ) {
      throw new UserSandboxRuntimeError(
        "USER_SANDBOX_RUNTIME_INPUT_INVALID",
        "Verified user-sandbox contract is required.",
      );
    }
    const binding = await this.#resolver.resolve(contract);
    const unitName = `brai-sandbox-agent-${contract.run_id}.service`;
    const gate = await this.#gateStore.create(
      binding,
      contract.run_id,
      standardInput,
    );
    let launchReceipt: UserSandboxRuntimeLaunchReceipt | null = null;
    try {
      const machineService = await this.#ensureMachine(binding);
      const existing = await this.#showUnit(binding.machineName, unitName);
      if (existing !== null && existing.loadState !== "not-found") {
        throw new UserSandboxRuntimeError(
          "USER_SANDBOX_RUNTIME_UNIT_ALREADY_EXISTS",
          `Sandbox unit ${unitName} already exists.`,
        );
      }
      const result = await this.#runner.run("/usr/bin/systemd-run", [
        `--machine=${binding.machineName}`,
        "--no-block",
        "--quiet",
        `--unit=${unitName}`,
        "--property=Type=exec",
        "--property=User=root",
        "--property=Group=root",
        "--property=WorkingDirectory=/data/workspace",
        "--property=UMask=0077",
        "--property=KillMode=control-group",
        "--property=NoNewPrivileges=yes",
        "--property=RemainAfterExit=yes",
        "--property=TimeoutStopSec=10s",
        `--property=StandardInput=file:${gate.stdinGuestPath}`,
        "--property=StandardOutput=journal",
        "--property=StandardError=journal",
        "--",
        SANDBOX_GATE_EXECUTABLE,
        gate.fifoGuestPath,
        gate.readyGuestPath,
        gate.token,
        "--",
        SANDBOX_CODEX_EXECUTABLE,
      ]);
      if (result.exitCode !== 0) {
        throw commandFailure("/usr/bin/systemd-run", result);
      }
      const identity = await this.#waitForStarted(
        contract,
        binding,
        machineService,
        unitName,
      );
      launchReceipt = Object.freeze({
        kind: "user-sandbox-runtime-launched",
        schemaVersion: USER_SANDBOX_RUNTIME_RECEIPT_SCHEMA_VERSION,
        observedAt: this.#clock.now().toISOString(),
        identity,
      });
      await this.#gateStore.waitUntilReady(binding, gate);
      const recovery = Object.freeze({ launchReceipt, gate });
      const prepared = Object.freeze({ launchReceipt, recovery });
      issuedPrepared.add(prepared);
      preparedStates.set(prepared, { recovery, status: "held" });
      return prepared;
    } catch (error) {
      if (launchReceipt !== null) {
        await this.#terminateReceipt(launchReceipt).catch(() => undefined);
      } else {
        await this.#runner.run("/usr/bin/systemctl", [
          `--machine=${binding.machineName}`,
          "stop",
          unitName,
        ]);
      }
      await this.#gateStore.cleanup(gate);
      throw error;
    }
  }

  public restoreHeld(
    recovery: PreparedUserSandboxRuntimeRecovery,
  ): PreparedUserSandboxRuntime {
    const { identity } = recovery.launchReceipt;
    const runId = identity.runId;
    if (
      !RUN_ID_PATTERN.test(runId) ||
      identity.unitName !== `brai-sandbox-agent-${runId}.service` ||
      recovery.gate.fifoGuestPath !==
        `${SANDBOX_GATE_GUEST_ROOT}/${runId}.release` ||
      recovery.gate.readyGuestPath !==
        `${SANDBOX_GATE_GUEST_ROOT}/${runId}.ready` ||
      recovery.gate.stdinGuestPath !==
        `${SANDBOX_GATE_GUEST_ROOT}/${runId}.stdin` ||
      !/^[a-f0-9]{64}$/u.test(recovery.gate.token)
    ) {
      throw new UserSandboxRuntimeError(
        "USER_SANDBOX_RUNTIME_INPUT_INVALID",
        "Sandbox recovery record is invalid.",
      );
    }
    const prepared = Object.freeze({
      launchReceipt: recovery.launchReceipt,
      recovery,
    });
    issuedPrepared.add(prepared);
    preparedStates.set(prepared, { recovery, status: "held" });
    return prepared;
  }

  async #waitUntilAgentUid(
    identity: UserSandboxRuntimeIdentity,
  ): Promise<void> {
    const deadline = this.#clock.now().getTime() + this.#launchTimeout;
    while (this.#clock.now().getTime() <= deadline) {
      const process = await this.#inspector.readProcess(identity.mainPid);
      if (
        process.startTimeTicks !== identity.mainPidStartTimeTicks ||
        process.controlGroup !== identity.controlGroup
      ) {
        throw new UserSandboxRuntimeError(
          "USER_SANDBOX_RUNTIME_IDENTITY_MISMATCH",
          "Sandbox gate PID changed while releasing the fixed target.",
        );
      }
      if (process.uid === identity.imageBraiUid) return;
      if (process.uid !== identity.outerRootUid) {
        throw new UserSandboxRuntimeError(
          "USER_SANDBOX_RUNTIME_MEASUREMENT_INVALID",
          "Sandbox process did not drop from mapped root to brai.",
        );
      }
      await this.#clock.sleep(25);
    }
    throw new UserSandboxRuntimeError(
      "USER_SANDBOX_RUNTIME_START_TIMEOUT",
      "Sandbox target did not become the unprivileged brai process.",
    );
  }

  public async release(prepared: PreparedUserSandboxRuntime): Promise<void> {
    const state = requirePrepared(prepared);
    if (state.status !== "held") {
      throw new UserSandboxRuntimeError(
        "USER_SANDBOX_RUNTIME_INPUT_INVALID",
        "Sandbox gate is no longer held.",
      );
    }
    await this.#gateStore.release(state.recovery.gate);
    await this.#waitUntilAgentUid(state.recovery.launchReceipt.identity);
    state.status = "released";
    await this.#gateStore.cleanup(state.recovery.gate);
  }

  async #assertSameRuntime(
    identity: UserSandboxRuntimeIdentity,
    facts: UnitFacts,
  ): Promise<void> {
    const bootId = await this.#inspector.readBootId();
    if (
      bootId !== identity.bootId ||
      facts.invocationId !== identity.invocationId ||
      (facts.controlGroup !== "" &&
        facts.controlGroup.split("/").at(-1) !== identity.unitName)
    ) {
      throw new UserSandboxRuntimeError(
        "USER_SANDBOX_RUNTIME_IDENTITY_MISMATCH",
        "Inner unit no longer matches the recorded sandbox identity.",
      );
    }
    if (await this.#inspector.cgroupExists(identity.controlGroup)) {
      const inode = await this.#inspector.readCgroupInode(
        identity.controlGroup,
      );
      if (inode !== identity.controlGroupInode) {
        throw new UserSandboxRuntimeError(
          "USER_SANDBOX_RUNTIME_IDENTITY_MISMATCH",
          "Refusing to target a reused sandbox cgroup.",
        );
      }
    }
    if (facts.mainPid > 0) {
      const process = await this.#inspector.readProcess(identity.mainPid);
      if (
        process.startTimeTicks !== identity.mainPidStartTimeTicks ||
        process.controlGroup !== identity.controlGroup ||
        ![identity.outerRootUid, identity.imageBraiUid].includes(process.uid)
      ) {
        throw new UserSandboxRuntimeError(
          "USER_SANDBOX_RUNTIME_IDENTITY_MISMATCH",
          "Refusing to target a reused sandbox process.",
        );
      }
    }
  }

  async #terminationState(identity: UserSandboxRuntimeIdentity): Promise<{
    readonly facts: UnitFacts | null;
    readonly pids: readonly number[];
    readonly done: boolean;
  }> {
    const [facts, pids] = await Promise.all([
      this.#showUnit(identity.machineName, identity.unitName),
      this.#inspector.listCgroupPids(identity.controlGroup),
    ]);
    const inactive =
      facts === null ||
      facts.loadState === "not-found" ||
      ["inactive", "failed"].includes(facts.activeState);
    return { facts, pids, done: inactive && pids.length === 0 };
  }

  async #waitForTermination(
    identity: UserSandboxRuntimeIdentity,
    milliseconds: number,
  ): Promise<{
    readonly facts: UnitFacts | null;
    readonly pids: readonly number[];
    readonly done: boolean;
  }> {
    const deadline = this.#clock.now().getTime() + milliseconds;
    let state = await this.#terminationState(identity);
    while (!state.done && this.#clock.now().getTime() <= deadline) {
      await this.#clock.sleep(50);
      state = await this.#terminationState(identity);
    }
    return state;
  }

  async #terminateReceipt(
    receipt: UserSandboxRuntimeLaunchReceipt,
  ): Promise<UserSandboxRuntimeTerminationReceipt> {
    const identity = receipt.identity;
    if (
      receipt.kind !== "user-sandbox-runtime-launched" ||
      identity.unitName !== `brai-sandbox-agent-${identity.runId}.service`
    ) {
      throw new UserSandboxRuntimeError(
        "USER_SANDBOX_RUNTIME_INPUT_INVALID",
        "Sandbox launch receipt is invalid.",
      );
    }
    const initial = await this.#terminationState(identity);
    if (initial.facts !== null && initial.facts.loadState !== "not-found") {
      await this.#assertSameRuntime(identity, initial.facts);
    }
    if (initial.done) {
      return Object.freeze({
        kind: "user-sandbox-runtime-terminated",
        schemaVersion: USER_SANDBOX_RUNTIME_RECEIPT_SCHEMA_VERSION,
        observedAt: this.#clock.now().toISOString(),
        identity,
        alreadyInactive: true,
        escalatedToSigkill: false,
        finalActiveState:
          initial.facts === null || initial.facts.loadState === "not-found"
            ? "not-found"
            : initial.facts.activeState === "failed"
              ? "failed"
              : "inactive",
        remainingPids: Object.freeze([]),
      });
    }
    const stopped = await this.#runner.run("/usr/bin/systemctl", [
      `--machine=${identity.machineName}`,
      "stop",
      identity.unitName,
    ]);
    if (stopped.exitCode !== 0) {
      throw commandFailure("/usr/bin/systemctl", stopped);
    }
    let final = await this.#waitForTermination(identity, this.#gracefulStop);
    let escalatedToSigkill = false;
    if (!final.done) {
      const killed = await this.#runner.run("/usr/bin/systemctl", [
        `--machine=${identity.machineName}`,
        "kill",
        "--kill-whom=all",
        "--signal=SIGKILL",
        identity.unitName,
      ]);
      if (killed.exitCode !== 0) {
        throw commandFailure("/usr/bin/systemctl", killed);
      }
      escalatedToSigkill = true;
      final = await this.#waitForTermination(identity, this.#forceStop);
    }
    if (!final.done) {
      throw new UserSandboxRuntimeError(
        "USER_SANDBOX_RUNTIME_TERMINATION_TIMEOUT",
        `Sandbox runtime still contains PIDs: ${final.pids.join(",")}`,
      );
    }
    return Object.freeze({
      kind: "user-sandbox-runtime-terminated",
      schemaVersion: USER_SANDBOX_RUNTIME_RECEIPT_SCHEMA_VERSION,
      observedAt: this.#clock.now().toISOString(),
      identity,
      alreadyInactive: false,
      escalatedToSigkill,
      finalActiveState:
        final.facts === null || final.facts.loadState === "not-found"
          ? "not-found"
          : final.facts.activeState === "failed"
            ? "failed"
            : "inactive",
      remainingPids: Object.freeze([]),
    });
  }

  public async terminate(
    prepared: PreparedUserSandboxRuntime,
  ): Promise<UserSandboxRuntimeTerminationReceipt> {
    const state = requirePrepared(prepared);
    const result = await this.#terminateReceipt(state.recovery.launchReceipt);
    state.status = "terminated";
    await this.#gateStore.cleanup(state.recovery.gate);
    return result;
  }

  public async terminateRecovered(
    recovery: PreparedUserSandboxRuntimeRecovery,
  ): Promise<UserSandboxRuntimeTerminationReceipt> {
    const result = await this.#terminateReceipt(recovery.launchReceipt);
    await this.#gateStore.cleanup(recovery.gate);
    return result;
  }

  async #waitForEmpty(
    identity: UserSandboxRuntimeIdentity,
  ): Promise<UnitFacts> {
    for (;;) {
      const state = await this.#terminationState(identity);
      if (state.facts === null || state.facts.loadState === "not-found") {
        throw new UserSandboxRuntimeError(
          "USER_SANDBOX_RUNTIME_IDENTITY_MISMATCH",
          "Sandbox unit disappeared before its exit status was measured.",
        );
      }
      if (
        state.pids.length === 0 &&
        (state.facts.mainPid === 0 ||
          ["exited", "dead", "failed"].includes(state.facts.subState))
      ) {
        await this.#assertSameRuntime(identity, state.facts);
        return state.facts;
      }
      await this.#clock.sleep(100);
    }
  }

  public async waitForExit(
    receipt: UserSandboxRuntimeLaunchReceipt,
  ): Promise<UserSandboxRuntimeExitObservation> {
    const identity = receipt.identity;
    const facts = await this.#waitForEmpty(identity);
    if (
      facts.execMainCode === 1 &&
      facts.execMainStatus === 0 &&
      ["success", ""].includes(facts.result)
    ) {
      return Object.freeze({
        observedAt: this.#clock.now().toISOString(),
        identity,
        outcome: "succeeded",
        exitCode: 0,
        signal: null,
      });
    }
    if (
      facts.execMainCode === 1 &&
      facts.execMainStatus > 0 &&
      facts.execMainStatus <= 255
    ) {
      return Object.freeze({
        observedAt: this.#clock.now().toISOString(),
        identity,
        outcome: "failed",
        exitCode: facts.execMainStatus,
        signal: null,
      });
    }
    if ([2, 3].includes(facts.execMainCode) && facts.execMainStatus > 0) {
      const signal = Object.entries(osConstants.signals).find(
        ([, value]) => value === facts.execMainStatus,
      )?.[0];
      if (signal !== undefined && /^SIG[A-Z0-9]+$/u.test(signal)) {
        return Object.freeze({
          observedAt: this.#clock.now().toISOString(),
          identity,
          outcome: "failed",
          exitCode: null,
          signal,
        });
      }
    }
    throw new UserSandboxRuntimeError(
      "USER_SANDBOX_RUNTIME_MEASUREMENT_INVALID",
      `Sandbox unit has unsupported exit status ${facts.execMainCode}/${facts.execMainStatus}/${facts.result}.`,
    );
  }

  public async collectExited(
    receipt: UserSandboxRuntimeLaunchReceipt,
  ): Promise<void> {
    const identity = receipt.identity;
    const state = await this.#terminationState(identity);
    if (state.pids.length !== 0 || state.facts === null) {
      throw new UserSandboxRuntimeError(
        "USER_SANDBOX_RUNTIME_IDENTITY_MISMATCH",
        "Refusing to collect a live or missing sandbox unit.",
      );
    }
    if (state.facts.loadState === "not-found") return;
    await this.#assertSameRuntime(identity, state.facts);
    const stopped = await this.#runner.run("/usr/bin/systemctl", [
      `--machine=${identity.machineName}`,
      "stop",
      identity.unitName,
    ]);
    if (stopped.exitCode !== 0) {
      throw commandFailure("/usr/bin/systemctl", stopped);
    }
  }
}

export function createHostUserSandboxRuntimeController(): UserSandboxRuntimeController {
  return new NspawnUserSandboxRuntimeController({
    runner: new NodeCommandRunner(),
    inspector: new ProcfsUserSandboxRuntimeInspector(),
    environmentResolver: new FilesystemUserSandboxEnvironmentResolver(),
    gateStore: new FilesystemUserSandboxGateStore(),
    preflight: verifyUserSandboxLaunchBinding,
  });
}
