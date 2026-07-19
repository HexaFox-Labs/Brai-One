import { spawn } from "node:child_process";
import { constants as osConstants } from "node:os";
import type { Dirent } from "node:fs";
import { opendir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BRAI_SINGLE_RUNTIME_HOST_ID,
  RUNTIME_IDENTITY_SCHEMA_VERSION,
  developerRuntimeIdentitySchema,
  type InternalAgentLaunchContract,
  type RuntimeIdentity,
} from "@brai/contracts";
import {
  calculateAgentCommandDigest,
  type BoundAgentCommand,
} from "@brai/agent-access";

const RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BOOT_ID_PATTERN = RUN_ID_PATTERN;
const INVOCATION_ID_PATTERN = /^[0-9a-f]{32}$/;
const SAFE_ENVIRONMENT = Object.freeze({
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
});

export const DEVELOPER_RUNTIME_RECEIPT_SCHEMA_VERSION = 1 as const;
export const DEVELOPER_RUNTIME_USER = "mark" as const;
export const DEVELOPER_RUNTIME_GROUP = "mark" as const;
export const DEVELOPER_RUNTIME_WORKING_DIRECTORY =
  "/srv/projects/brai-new" as const;

export type BoundDeveloperCommand = BoundAgentCommand;

/**
 * Trusted input produced only after the platform has verified the immutable
 * launch envelope. The digest binds the exact executable and argv; it is not
 * an authorization mechanism on its own.
 */
export interface VerifiedDeveloperRuntimeLaunch {
  readonly profile: "developer";
  readonly runId: string;
  readonly jobDigestSha256: string;
  readonly command: BoundDeveloperCommand;
  /**
   * Root-owned, mark-group-readable regular file below the gate root. It is
   * opened by systemd and inherited across the native exec gate, so the prompt
   * never appears in argv or the registry and another mark process cannot
   * rewrite or chmod it.
   */
  readonly standardInputPath?: string;
}

export interface DeveloperRuntimeIdentity {
  readonly schemaVersion: typeof DEVELOPER_RUNTIME_RECEIPT_SCHEMA_VERSION;
  readonly profile: "developer";
  readonly runId: string;
  readonly jobDigestSha256: string;
  readonly unitName: string;
  readonly bootId: string;
  readonly invocationId: string;
  readonly controlGroup: string;
  readonly controlGroupInode: string;
  readonly mainPid: number;
  readonly mainPidStartTimeTicks: string;
  readonly uid: number;
  readonly gid: number;
  readonly supplementaryGids: readonly number[];
  readonly systemd: {
    readonly user: typeof DEVELOPER_RUNTIME_USER;
    readonly group: typeof DEVELOPER_RUNTIME_GROUP;
    readonly workingDirectory: typeof DEVELOPER_RUNTIME_WORKING_DIRECTORY;
    readonly umask: "0077";
    readonly killMode: "control-group";
    readonly noNewPrivileges: false;
  };
}

export interface DeveloperRuntimeLaunchReceipt {
  readonly kind: "developer-runtime-launched";
  readonly schemaVersion: typeof DEVELOPER_RUNTIME_RECEIPT_SCHEMA_VERSION;
  readonly observedAt: string;
  readonly identity: DeveloperRuntimeIdentity;
}

export interface DeveloperRuntimeTerminationReceipt {
  readonly kind: "developer-runtime-terminated";
  readonly schemaVersion: typeof DEVELOPER_RUNTIME_RECEIPT_SCHEMA_VERSION;
  readonly observedAt: string;
  readonly identity: DeveloperRuntimeIdentity;
  readonly alreadyInactive: boolean;
  readonly escalatedToSigkill: boolean;
  readonly finalActiveState: "inactive" | "failed" | "not-found";
  readonly remainingPids: readonly number[];
}

export interface DeveloperRuntimeExitObservation {
  readonly observedAt: string;
  readonly identity: DeveloperRuntimeIdentity;
  readonly outcome: "succeeded" | "failed";
  readonly exitCode: number | null;
  readonly signal: string | null;
}

/**
 * Lossless boundary adapter for the typed identity persisted by brai-access.
 * The access service never accepts the richer host-local receipt directly.
 */
export function developerRuntimeIdentityForAccessReceipt(
  identity: DeveloperRuntimeIdentity,
): RuntimeIdentity {
  const cgroupInode = Number(identity.controlGroupInode);
  const leaderStartTimeTicks = Number(identity.mainPidStartTimeTicks);
  if (
    !Number.isSafeInteger(cgroupInode) ||
    cgroupInode <= 0 ||
    !Number.isSafeInteger(leaderStartTimeTicks) ||
    leaderStartTimeTicks <= 0
  ) {
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_MEASUREMENT_INVALID",
      "Developer cgroup or process identity exceeds the durable receipt range.",
    );
  }
  return developerRuntimeIdentitySchema.parse({
    schema_version: RUNTIME_IDENTITY_SCHEMA_VERSION,
    runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
    profile: "developer",
    boot_id: identity.bootId,
    systemd_invocation_id: identity.invocationId,
    unit: identity.unitName,
    cgroup_path: identity.controlGroup,
    cgroup_inode: cgroupInode,
    leader_pid: identity.mainPid,
    leader_start_time_ticks: leaderStartTimeTicks,
    machine: null,
  });
}

export interface CommandResult {
  readonly exitCode: number;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  run(
    executable: string,
    arguments_: readonly string[],
  ): Promise<CommandResult>;
}

export interface ProcessIdentityFacts {
  readonly uid: number;
  readonly gid: number;
  readonly supplementaryGids: readonly number[];
  readonly startTimeTicks: string;
}

export interface DeveloperRuntimeHostInspector {
  readBootId(): Promise<string>;
  readProcessIdentity(pid: number): Promise<ProcessIdentityFacts>;
  readCgroupInode(controlGroup: string): Promise<string>;
  listCgroupPids(controlGroup: string): Promise<readonly number[]>;
  cgroupExists(controlGroup: string): Promise<boolean>;
}

export interface DeveloperRuntimeClock {
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
}

export interface DeveloperRuntimeControllerOptions {
  readonly runner: CommandRunner;
  readonly inspector: DeveloperRuntimeHostInspector;
  readonly clock?: DeveloperRuntimeClock;
  readonly launchTimeoutMilliseconds?: number;
  readonly gracefulStopMilliseconds?: number;
  readonly forceStopMilliseconds?: number;
}

export type DeveloperRuntimeErrorCode =
  | "DEVELOPER_RUNTIME_INPUT_INVALID"
  | "DEVELOPER_RUNTIME_JOB_DIGEST_MISMATCH"
  | "DEVELOPER_RUNTIME_UNIT_ALREADY_EXISTS"
  | "DEVELOPER_RUNTIME_SYSTEMD_COMMAND_FAILED"
  | "DEVELOPER_RUNTIME_START_TIMEOUT"
  | "DEVELOPER_RUNTIME_MEASUREMENT_INVALID"
  | "DEVELOPER_RUNTIME_IDENTITY_MISMATCH"
  | "DEVELOPER_RUNTIME_TERMINATION_TIMEOUT";

export class DeveloperRuntimeError extends Error {
  public constructor(
    public readonly code: DeveloperRuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DeveloperRuntimeError";
  }
}

interface SystemdUnitFacts {
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

interface ExpectedMarkIdentity {
  readonly uid: number;
  readonly gid: number;
  readonly supplementaryGids: readonly number[];
}

const defaultClock: DeveloperRuntimeClock = {
  now: () => new Date(),
  sleep: (milliseconds) =>
    new Promise((resolveSleep) => {
      setTimeout(resolveSleep, milliseconds);
    }),
};

export function calculateDeveloperJobDigest(
  command: BoundDeveloperCommand,
): string {
  try {
    return calculateAgentCommandDigest(command);
  } catch (error) {
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_INPUT_INVALID",
      error instanceof Error ? error.message : "Developer command is invalid.",
    );
  }
}

/**
 * Host-boundary adapter. Call this only with the value returned by the launch
 * contract verifier, never with a client-shaped object. The signed job digest
 * must bind the exact argv resolved from the immutable job reference.
 */
export function developerRuntimeLaunchFromVerifiedContract(
  contract: InternalAgentLaunchContract,
  command: BoundDeveloperCommand,
): VerifiedDeveloperRuntimeLaunch {
  if (contract.access.profile !== "developer") {
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_INPUT_INVALID",
      "A non-developer launch contract cannot select the developer executor.",
    );
  }
  const digest = calculateDeveloperJobDigest(command);
  if (digest !== contract.job.command_sha256) {
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_JOB_DIGEST_MISMATCH",
      "Resolved immutable job argv does not match the signed launch contract.",
    );
  }
  return validateLaunch({
    profile: "developer",
    runId: contract.run_id,
    jobDigestSha256: contract.job.command_sha256,
    command,
  });
}

function validateCommand(command: BoundDeveloperCommand): void {
  calculateDeveloperJobDigest(command);
}

function validateLaunch(
  launch: VerifiedDeveloperRuntimeLaunch,
): VerifiedDeveloperRuntimeLaunch {
  if (
    launch.profile !== "developer" ||
    !RUN_ID_PATTERN.test(launch.runId) ||
    !SHA256_PATTERN.test(launch.jobDigestSha256)
  ) {
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_INPUT_INVALID",
      "Developer launch profile, run ID or job digest is invalid.",
    );
  }
  validateCommand(launch.command);
  if (
    launch.standardInputPath !== undefined &&
    launch.standardInputPath !==
      `/run/brai-agent-runtime/gates/${launch.runId}.stdin`
  ) {
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_INPUT_INVALID",
      "Developer stdin must be the canonical root-managed run file.",
    );
  }
  const actualDigest = calculateDeveloperJobDigest(launch.command);
  if (actualDigest !== launch.jobDigestSha256) {
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_JOB_DIGEST_MISMATCH",
      "Developer job digest does not bind the supplied executable and argv.",
    );
  }
  return Object.freeze({
    profile: "developer",
    runId: launch.runId,
    jobDigestSha256: launch.jobDigestSha256,
    command: Object.freeze({
      schemaVersion: 1,
      executable: launch.command.executable,
      arguments: Object.freeze([...launch.command.arguments]),
    }),
    ...(launch.standardInputPath === undefined
      ? {}
      : { standardInputPath: launch.standardInputPath }),
  });
}

export function developerRuntimeUnitName(runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_INPUT_INVALID",
      "Developer run ID must be a canonical UUID.",
    );
  }
  return `brai-developer-agent-${runId}.service`;
}

function parseKeyValueOutput(output: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const line of output.split("\n")) {
    if (line === "") continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return values;
}

function parseUnitFacts(result: CommandResult): SystemdUnitFacts | null {
  if (result.exitCode !== 0) return null;
  const values = parseKeyValueOutput(result.stdout);
  const mainPid = Number(values.get("MainPID"));
  const execMainCode = Number(values.get("ExecMainCode"));
  const execMainStatus = Number(values.get("ExecMainStatus"));
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
    mainPid: Number.isSafeInteger(mainPid) ? mainPid : 0,
    execMainCode: Number.isSafeInteger(execMainCode) ? execMainCode : 0,
    execMainStatus: Number.isSafeInteger(execMainStatus) ? execMainStatus : -1,
    result: values.get("Result") ?? "",
  };
}

function normalizedNumbers(values: readonly number[]): readonly number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function sameNumbers(
  left: readonly number[],
  right: readonly number[],
): boolean {
  const normalizedLeft = normalizedNumbers(left);
  const normalizedRight = normalizedNumbers(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function commandFailure(
  executable: string,
  result: CommandResult,
): DeveloperRuntimeError {
  const detail = result.stderr.trim().slice(0, 1_024);
  return new DeveloperRuntimeError(
    "DEVELOPER_RUNTIME_SYSTEMD_COMMAND_FAILED",
    `${executable} exited ${result.exitCode}${detail === "" ? "" : `: ${detail}`}`,
  );
}

export class NodeCommandRunner implements CommandRunner {
  public async run(
    executable: string,
    arguments_: readonly string[],
  ): Promise<CommandResult> {
    return await new Promise((resolveCommand, rejectCommand) => {
      const child = spawn(executable, [...arguments_], {
        env: SAFE_ENVIRONMENT,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const outputLimit = 1_048_576;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (stdout.length < outputLimit) stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < outputLimit) stderr += chunk;
      });
      child.once("error", rejectCommand);
      child.once("close", (exitCode, signal) => {
        resolveCommand({
          exitCode: exitCode ?? 1,
          signal,
          stdout: stdout.slice(0, outputLimit),
          stderr: stderr.slice(0, outputLimit),
        });
      });
    });
  }
}

function cgroupFilesystemPath(controlGroup: string): string {
  if (
    !controlGroup.startsWith("/") ||
    controlGroup.includes("\0") ||
    controlGroup.split("/").includes("..")
  ) {
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_MEASUREMENT_INVALID",
      "systemd returned an invalid control group path.",
    );
  }
  const root = "/sys/fs/cgroup";
  const path = resolve(root, `.${controlGroup}`);
  if (path !== root && !path.startsWith(`${root}/`)) {
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_MEASUREMENT_INVALID",
      "systemd control group escaped the cgroup v2 root.",
    );
  }
  return path;
}

function parseProcessStatus(content: string): {
  readonly uid: number;
  readonly gid: number;
  readonly supplementaryGids: readonly number[];
} {
  const values = parseKeyValueOutput(
    content
      .split("\n")
      .map((line) => {
        const separator = line.indexOf(":");
        return separator < 0
          ? line
          : `${line.slice(0, separator)}=${line.slice(separator + 1).trim()}`;
      })
      .join("\n"),
  );
  const uid = Number(values.get("Uid")?.split(/\s+/)[0]);
  const gid = Number(values.get("Gid")?.split(/\s+/)[0]);
  const supplementaryGids = (values.get("Groups") ?? "")
    .split(/\s+/)
    .filter((value) => value !== "")
    .map(Number);
  if (
    !Number.isSafeInteger(uid) ||
    uid < 0 ||
    !Number.isSafeInteger(gid) ||
    gid < 0 ||
    supplementaryGids.some((value) => !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_MEASUREMENT_INVALID",
      "Developer process identity could not be measured from procfs.",
    );
  }
  return {
    uid,
    gid,
    supplementaryGids: normalizedNumbers(supplementaryGids),
  };
}

function parseProcessStartTime(content: string): string {
  const commandEnd = content.lastIndexOf(") ");
  if (commandEnd < 0) {
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_MEASUREMENT_INVALID",
      "Developer process start time could not be measured from procfs.",
    );
  }
  const fieldsFromState = content
    .slice(commandEnd + 2)
    .trim()
    .split(/\s+/);
  const startTimeTicks = fieldsFromState[19];
  if (startTimeTicks === undefined || !/^[0-9]+$/.test(startTimeTicks)) {
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_MEASUREMENT_INVALID",
      "Developer process start time is invalid.",
    );
  }
  return startTimeTicks;
}

async function collectCgroupPids(
  directory: string,
): Promise<readonly number[]> {
  let entries: Dirent[];
  try {
    const handle = await opendir(directory);
    entries = [];
    for await (const entry of handle) entries.push(entry);
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

  const pids = new Set<number>();
  try {
    const direct = await readFile(`${directory}/cgroup.procs`, "utf8");
    for (const value of direct.split(/\s+/)) {
      if (value === "") continue;
      const pid = Number(value);
      if (Number.isSafeInteger(pid) && pid > 0) pids.add(pid);
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
  for (const values of nested) {
    for (const pid of values) pids.add(pid);
  }
  return [...pids].sort((left, right) => left - right);
}

export class ProcfsDeveloperRuntimeHostInspector implements DeveloperRuntimeHostInspector {
  public async readBootId(): Promise<string> {
    return (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  }

  public async readProcessIdentity(pid: number): Promise<ProcessIdentityFacts> {
    const [status, statContent] = await Promise.all([
      readFile(`/proc/${pid}/status`, "utf8"),
      readFile(`/proc/${pid}/stat`, "utf8"),
    ]);
    return {
      ...parseProcessStatus(status),
      startTimeTicks: parseProcessStartTime(statContent),
    };
  }

  public async readCgroupInode(controlGroup: string): Promise<string> {
    const metadata = await stat(cgroupFilesystemPath(controlGroup), {
      bigint: true,
    });
    return metadata.ino.toString();
  }

  public async listCgroupPids(
    controlGroup: string,
  ): Promise<readonly number[]> {
    return await collectCgroupPids(cgroupFilesystemPath(controlGroup));
  }

  public async cgroupExists(controlGroup: string): Promise<boolean> {
    try {
      await stat(cgroupFilesystemPath(controlGroup));
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

function parsePositiveInteger(result: CommandResult, label: string): number {
  if (result.exitCode !== 0) throw commandFailure("/usr/bin/id", result);
  const value = Number(result.stdout.trim());
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_MEASUREMENT_INVALID",
      `${label} is invalid.`,
    );
  }
  return value;
}

function parseGroups(result: CommandResult): readonly number[] {
  if (result.exitCode !== 0) throw commandFailure("/usr/bin/id", result);
  const values = result.stdout
    .trim()
    .split(/\s+/)
    .filter((value) => value !== "")
    .map(Number);
  if (
    values.length === 0 ||
    values.some((value) => !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_MEASUREMENT_INVALID",
      "mark initgroups could not be measured.",
    );
  }
  return normalizedNumbers(values);
}

export class DeveloperRuntimeController {
  readonly #runner: CommandRunner;
  readonly #inspector: DeveloperRuntimeHostInspector;
  readonly #clock: DeveloperRuntimeClock;
  readonly #launchTimeoutMilliseconds: number;
  readonly #gracefulStopMilliseconds: number;
  readonly #forceStopMilliseconds: number;

  public constructor(options: DeveloperRuntimeControllerOptions) {
    this.#runner = options.runner;
    this.#inspector = options.inspector;
    this.#clock = options.clock ?? defaultClock;
    this.#launchTimeoutMilliseconds =
      options.launchTimeoutMilliseconds ?? 10_000;
    this.#gracefulStopMilliseconds = options.gracefulStopMilliseconds ?? 5_000;
    this.#forceStopMilliseconds = options.forceStopMilliseconds ?? 5_000;
  }

  async #showUnit(unitName: string): Promise<SystemdUnitFacts | null> {
    return parseUnitFacts(
      await this.#runner.run("/usr/bin/systemctl", [
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
        unitName,
      ]),
    );
  }

  async #readExpectedMarkIdentity(): Promise<ExpectedMarkIdentity> {
    const [uidResult, gidResult, groupsResult] = await Promise.all([
      this.#runner.run("/usr/bin/id", ["-u", DEVELOPER_RUNTIME_USER]),
      this.#runner.run("/usr/bin/id", ["-g", DEVELOPER_RUNTIME_USER]),
      this.#runner.run("/usr/bin/id", ["-G", DEVELOPER_RUNTIME_USER]),
    ]);
    return {
      uid: parsePositiveInteger(uidResult, "mark uid"),
      gid: parsePositiveInteger(gidResult, "mark gid"),
      supplementaryGids: parseGroups(groupsResult),
    };
  }

  async #waitForStarted(
    launch: VerifiedDeveloperRuntimeLaunch,
    unitName: string,
    expectedMark: ExpectedMarkIdentity,
  ): Promise<DeveloperRuntimeIdentity> {
    const deadline =
      this.#clock.now().getTime() + this.#launchTimeoutMilliseconds;
    while (this.#clock.now().getTime() <= deadline) {
      const facts = await this.#showUnit(unitName);
      if (
        facts !== null &&
        facts.loadState === "loaded" &&
        facts.activeState === "active" &&
        facts.subState === "running" &&
        facts.mainPid > 0
      ) {
        return await this.#measureIdentity(
          launch,
          unitName,
          facts,
          expectedMark,
        );
      }
      if (
        facts !== null &&
        ["failed", "inactive"].includes(facts.activeState)
      ) {
        throw new DeveloperRuntimeError(
          "DEVELOPER_RUNTIME_SYSTEMD_COMMAND_FAILED",
          `Developer unit became ${facts.activeState}/${facts.subState} before its identity was measured.`,
        );
      }
      await this.#clock.sleep(50);
    }
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_START_TIMEOUT",
      "Developer unit did not reach a measurable running state.",
    );
  }

  async #measureIdentity(
    launch: VerifiedDeveloperRuntimeLaunch,
    unitName: string,
    facts: SystemdUnitFacts,
    expectedMark: ExpectedMarkIdentity,
  ): Promise<DeveloperRuntimeIdentity> {
    if (
      facts.user !== DEVELOPER_RUNTIME_USER ||
      facts.group !== DEVELOPER_RUNTIME_GROUP ||
      facts.workingDirectory !== DEVELOPER_RUNTIME_WORKING_DIRECTORY ||
      facts.umask !== "0077" ||
      facts.killMode !== "control-group" ||
      facts.noNewPrivileges !== "no" ||
      facts.remainAfterExit !== "yes" ||
      !INVOCATION_ID_PATTERN.test(facts.invocationId) ||
      facts.controlGroup === ""
    ) {
      throw new DeveloperRuntimeError(
        "DEVELOPER_RUNTIME_MEASUREMENT_INVALID",
        "Measured transient unit properties do not match the developer runtime policy.",
      );
    }
    const [bootId, process, controlGroupInode] = await Promise.all([
      this.#inspector.readBootId(),
      this.#inspector.readProcessIdentity(facts.mainPid),
      this.#inspector.readCgroupInode(facts.controlGroup),
    ]);
    if (
      !BOOT_ID_PATTERN.test(bootId) ||
      process.uid !== expectedMark.uid ||
      process.gid !== expectedMark.gid ||
      !sameNumbers(process.supplementaryGids, expectedMark.supplementaryGids) ||
      !/^[0-9]+$/.test(controlGroupInode)
    ) {
      throw new DeveloperRuntimeError(
        "DEVELOPER_RUNTIME_MEASUREMENT_INVALID",
        "Measured process identity, fresh initgroups or cgroup identity is invalid.",
      );
    }
    return Object.freeze({
      schemaVersion: DEVELOPER_RUNTIME_RECEIPT_SCHEMA_VERSION,
      profile: "developer",
      runId: launch.runId,
      jobDigestSha256: launch.jobDigestSha256,
      unitName,
      bootId,
      invocationId: facts.invocationId,
      controlGroup: facts.controlGroup,
      controlGroupInode,
      mainPid: facts.mainPid,
      mainPidStartTimeTicks: process.startTimeTicks,
      uid: process.uid,
      gid: process.gid,
      supplementaryGids: Object.freeze([
        ...normalizedNumbers(process.supplementaryGids),
      ]),
      systemd: Object.freeze({
        user: DEVELOPER_RUNTIME_USER,
        group: DEVELOPER_RUNTIME_GROUP,
        workingDirectory: DEVELOPER_RUNTIME_WORKING_DIRECTORY,
        umask: "0077",
        killMode: "control-group",
        noNewPrivileges: false,
      }),
    });
  }

  public async launch(
    untrustedLaunch: VerifiedDeveloperRuntimeLaunch,
  ): Promise<DeveloperRuntimeLaunchReceipt> {
    const launch = validateLaunch(untrustedLaunch);
    const unitName = developerRuntimeUnitName(launch.runId);
    const existing = await this.#showUnit(unitName);
    if (existing !== null && existing.loadState !== "not-found") {
      throw new DeveloperRuntimeError(
        "DEVELOPER_RUNTIME_UNIT_ALREADY_EXISTS",
        `Developer unit ${unitName} already exists.`,
      );
    }
    const expectedMark = await this.#readExpectedMarkIdentity();
    const runResult = await this.#runner.run("/usr/bin/systemd-run", [
      "--system",
      "--no-block",
      "--quiet",
      `--unit=${unitName}`,
      "--property=Type=exec",
      `--property=User=${DEVELOPER_RUNTIME_USER}`,
      `--property=Group=${DEVELOPER_RUNTIME_GROUP}`,
      `--property=WorkingDirectory=${DEVELOPER_RUNTIME_WORKING_DIRECTORY}`,
      "--property=UMask=0077",
      "--property=KillMode=control-group",
      "--property=NoNewPrivileges=no",
      "--property=RemainAfterExit=yes",
      "--property=TimeoutStopSec=10s",
      ...(launch.standardInputPath === undefined
        ? []
        : [`--property=StandardInput=file:${launch.standardInputPath}`]),
      "--property=StandardOutput=journal",
      "--property=StandardError=journal",
      "--",
      launch.command.executable,
      ...launch.command.arguments,
    ]);
    if (runResult.exitCode !== 0) {
      throw commandFailure("/usr/bin/systemd-run", runResult);
    }
    try {
      const identity = await this.#waitForStarted(
        launch,
        unitName,
        expectedMark,
      );
      return Object.freeze({
        kind: "developer-runtime-launched",
        schemaVersion: DEVELOPER_RUNTIME_RECEIPT_SCHEMA_VERSION,
        observedAt: this.#clock.now().toISOString(),
        identity,
      });
    } catch (error) {
      const rollback = await this.#runner.run("/usr/bin/systemctl", [
        "stop",
        unitName,
      ]);
      if (rollback.exitCode !== 0) {
        await this.#runner.run("/usr/bin/systemctl", [
          "kill",
          "--kill-whom=all",
          "--signal=SIGKILL",
          unitName,
        ]);
      }
      throw error;
    }
  }

  async #assertSameRuntime(
    identity: DeveloperRuntimeIdentity,
    facts: SystemdUnitFacts,
  ): Promise<void> {
    const bootId = await this.#inspector.readBootId();
    if (
      bootId !== identity.bootId ||
      facts.invocationId !== identity.invocationId ||
      facts.controlGroup !== identity.controlGroup
    ) {
      throw new DeveloperRuntimeError(
        "DEVELOPER_RUNTIME_IDENTITY_MISMATCH",
        "Refusing to terminate a unit that does not match the recorded runtime identity.",
      );
    }
    if (await this.#inspector.cgroupExists(identity.controlGroup)) {
      const inode = await this.#inspector.readCgroupInode(
        identity.controlGroup,
      );
      if (inode !== identity.controlGroupInode) {
        throw new DeveloperRuntimeError(
          "DEVELOPER_RUNTIME_IDENTITY_MISMATCH",
          "Refusing to terminate a reused cgroup.",
        );
      }
    }
    if (facts.mainPid > 0) {
      const process = await this.#inspector.readProcessIdentity(facts.mainPid);
      if (
        facts.mainPid !== identity.mainPid ||
        process.startTimeTicks !== identity.mainPidStartTimeTicks
      ) {
        throw new DeveloperRuntimeError(
          "DEVELOPER_RUNTIME_IDENTITY_MISMATCH",
          "Refusing to terminate a reused process identity.",
        );
      }
    }
  }

  async #assertSameInactiveUnit(
    identity: DeveloperRuntimeIdentity,
    facts: SystemdUnitFacts,
  ): Promise<void> {
    const bootId = await this.#inspector.readBootId();
    if (
      bootId !== identity.bootId ||
      facts.invocationId !== identity.invocationId ||
      (facts.controlGroup !== "" &&
        facts.controlGroup !== identity.controlGroup)
    ) {
      throw new DeveloperRuntimeError(
        "DEVELOPER_RUNTIME_IDENTITY_MISMATCH",
        "An inactive unit with this name does not match the recorded runtime identity.",
      );
    }
  }

  async #terminationState(identity: DeveloperRuntimeIdentity): Promise<{
    readonly facts: SystemdUnitFacts | null;
    readonly pids: readonly number[];
    readonly done: boolean;
  }> {
    const [facts, pids] = await Promise.all([
      this.#showUnit(identity.unitName),
      this.#inspector.listCgroupPids(identity.controlGroup),
    ]);
    const inactive =
      facts === null ||
      facts.loadState === "not-found" ||
      ["inactive", "failed"].includes(facts.activeState);
    return { facts, pids, done: inactive && pids.length === 0 };
  }

  async #waitForTermination(
    identity: DeveloperRuntimeIdentity,
    timeoutMilliseconds: number,
  ): Promise<{
    readonly facts: SystemdUnitFacts | null;
    readonly pids: readonly number[];
    readonly done: boolean;
  }> {
    const deadline = this.#clock.now().getTime() + timeoutMilliseconds;
    let state = await this.#terminationState(identity);
    while (!state.done && this.#clock.now().getTime() <= deadline) {
      await this.#clock.sleep(50);
      state = await this.#terminationState(identity);
    }
    return state;
  }

  public async terminate(
    receipt: DeveloperRuntimeLaunchReceipt,
  ): Promise<DeveloperRuntimeTerminationReceipt> {
    const identity = receipt.identity;
    if (
      receipt.kind !== "developer-runtime-launched" ||
      receipt.schemaVersion !== DEVELOPER_RUNTIME_RECEIPT_SCHEMA_VERSION ||
      identity.schemaVersion !== DEVELOPER_RUNTIME_RECEIPT_SCHEMA_VERSION ||
      identity.unitName !== developerRuntimeUnitName(identity.runId)
    ) {
      throw new DeveloperRuntimeError(
        "DEVELOPER_RUNTIME_INPUT_INVALID",
        "Developer launch receipt is invalid.",
      );
    }

    const initial = await this.#terminationState(identity);
    if (initial.done) {
      if (initial.facts !== null && initial.facts.loadState !== "not-found") {
        await this.#assertSameInactiveUnit(identity, initial.facts);
      }
      return Object.freeze({
        kind: "developer-runtime-terminated",
        schemaVersion: DEVELOPER_RUNTIME_RECEIPT_SCHEMA_VERSION,
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
    if (initial.facts === null) {
      throw new DeveloperRuntimeError(
        "DEVELOPER_RUNTIME_IDENTITY_MISMATCH",
        "Runtime cgroup still has processes but its unit is no longer measurable.",
      );
    }
    await this.#assertSameRuntime(identity, initial.facts);

    const stopResult = await this.#runner.run("/usr/bin/systemctl", [
      "stop",
      "--no-block",
      identity.unitName,
    ]);
    if (stopResult.exitCode !== 0) {
      throw commandFailure("/usr/bin/systemctl", stopResult);
    }
    let finalState = await this.#waitForTermination(
      identity,
      this.#gracefulStopMilliseconds,
    );
    let escalatedToSigkill = false;
    if (!finalState.done) {
      const killResult = await this.#runner.run("/usr/bin/systemctl", [
        "kill",
        "--kill-whom=all",
        "--signal=SIGKILL",
        identity.unitName,
      ]);
      if (killResult.exitCode !== 0) {
        throw commandFailure("/usr/bin/systemctl", killResult);
      }
      escalatedToSigkill = true;
      finalState = await this.#waitForTermination(
        identity,
        this.#forceStopMilliseconds,
      );
    }
    if (!finalState.done) {
      throw new DeveloperRuntimeError(
        "DEVELOPER_RUNTIME_TERMINATION_TIMEOUT",
        `Developer runtime still contains PIDs: ${finalState.pids.join(",")}`,
      );
    }
    return Object.freeze({
      kind: "developer-runtime-terminated",
      schemaVersion: DEVELOPER_RUNTIME_RECEIPT_SCHEMA_VERSION,
      observedAt: this.#clock.now().toISOString(),
      identity,
      alreadyInactive: false,
      escalatedToSigkill,
      finalActiveState:
        finalState.facts === null || finalState.facts.loadState === "not-found"
          ? "not-found"
          : finalState.facts.activeState === "failed"
            ? "failed"
            : "inactive",
      remainingPids: Object.freeze([]),
    });
  }

  async #waitForProcessTreeEmpty(
    identity: DeveloperRuntimeIdentity,
  ): Promise<SystemdUnitFacts> {
    for (;;) {
      const [facts, pids] = await Promise.all([
        this.#showUnit(identity.unitName),
        this.#inspector.listCgroupPids(identity.controlGroup),
      ]);
      if (facts === null || facts.loadState === "not-found") {
        throw new DeveloperRuntimeError(
          "DEVELOPER_RUNTIME_IDENTITY_MISMATCH",
          "Developer unit disappeared before its exact exit status was recorded.",
        );
      }
      if (pids.length === 0 && facts.mainPid === 0) {
        await this.#assertSameInactiveUnit(identity, facts);
        return facts;
      }
      if (
        pids.length === 0 &&
        ["exited", "dead", "failed"].includes(facts.subState)
      ) {
        if (
          facts.invocationId !== identity.invocationId ||
          (facts.controlGroup !== "" &&
            facts.controlGroup !== identity.controlGroup)
        ) {
          throw new DeveloperRuntimeError(
            "DEVELOPER_RUNTIME_IDENTITY_MISMATCH",
            "Developer unit exit status belongs to another invocation.",
          );
        }
        return facts;
      }
      await this.#clock.sleep(100);
    }
  }

  /**
   * Waits for the complete systemd cgroup to become empty and maps the exact
   * ExecMain status. RemainAfterExit keeps the transient unit measurable across
   * controller restarts until the signed DB receipt is acknowledged.
   */
  public async waitForExit(
    receipt: DeveloperRuntimeLaunchReceipt,
  ): Promise<DeveloperRuntimeExitObservation> {
    const identity = receipt.identity;
    if (
      receipt.kind !== "developer-runtime-launched" ||
      identity.unitName !== developerRuntimeUnitName(identity.runId)
    ) {
      throw new DeveloperRuntimeError(
        "DEVELOPER_RUNTIME_INPUT_INVALID",
        "Developer launch receipt is invalid.",
      );
    }
    const facts = await this.#waitForProcessTreeEmpty(identity);
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
        ([, number]) => number === facts.execMainStatus,
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
    throw new DeveloperRuntimeError(
      "DEVELOPER_RUNTIME_MEASUREMENT_INVALID",
      `Developer unit has unsupported exit status ${facts.execMainCode}/${facts.execMainStatus}/${facts.result}.`,
    );
  }

  /**
   * Removes a measured RemainAfterExit unit only after its durable exit receipt
   * has been accepted. This cannot target a reused unit or live process tree.
   */
  public async collectExited(
    receipt: DeveloperRuntimeLaunchReceipt,
  ): Promise<void> {
    const identity = receipt.identity;
    const state = await this.#terminationState(identity);
    if (state.pids.length !== 0 || state.facts === null) {
      throw new DeveloperRuntimeError(
        "DEVELOPER_RUNTIME_IDENTITY_MISMATCH",
        "Refusing to collect a developer unit with a live or missing process tree.",
      );
    }
    if (state.facts.loadState === "not-found") return;
    if (
      state.facts.invocationId !== identity.invocationId ||
      (state.facts.controlGroup !== "" &&
        state.facts.controlGroup !== identity.controlGroup)
    ) {
      throw new DeveloperRuntimeError(
        "DEVELOPER_RUNTIME_IDENTITY_MISMATCH",
        "Refusing to collect a reused developer unit.",
      );
    }
    const result = await this.#runner.run("/usr/bin/systemctl", [
      "stop",
      identity.unitName,
    ]);
    if (result.exitCode !== 0) {
      throw commandFailure("/usr/bin/systemctl", result);
    }
  }
}

export function createHostDeveloperRuntimeController(): DeveloperRuntimeController {
  return new DeveloperRuntimeController({
    runner: new NodeCommandRunner(),
    inspector: new ProcfsDeveloperRuntimeHostInspector(),
  });
}
