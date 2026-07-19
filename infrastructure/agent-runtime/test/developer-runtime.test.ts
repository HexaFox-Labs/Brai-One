import { describe, expect, it } from "vitest";
import {
  BRAI_SINGLE_RUNTIME_HOST_ID,
  INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
  LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
  type InternalAgentLaunchContract,
} from "@brai/contracts";
import {
  calculateDeveloperJobDigest,
  developerRuntimeLaunchFromVerifiedContract,
  developerRuntimeIdentityForAccessReceipt,
  DeveloperRuntimeController,
  type BoundDeveloperCommand,
  type CommandResult,
  type CommandRunner,
  type DeveloperRuntimeClock,
  type DeveloperRuntimeHostInspector,
  type ProcessIdentityFacts,
} from "../src/developer-runtime.js";

const RUN_ID = "4f88bde1-2b49-46cb-914d-7500afdf82d6";
const INVOCATION_ID = "a".repeat(32);
const BOOT_ID = "3f88bde1-2b49-46cb-914d-7500afdf82d6";
const CONTROL_GROUP =
  "/system.slice/brai-developer-agent-4f88bde1-2b49-46cb-914d-7500afdf82d6.service";
const COMMAND: BoundDeveloperCommand = {
  schemaVersion: 1,
  executable: "/usr/bin/node",
  arguments: ["/srv/projects/brai-new/tools/agent.mjs", "--task", "safe value"],
};

function result(stdout = "", exitCode = 0, stderr = ""): CommandResult {
  return { exitCode, signal: null, stdout, stderr };
}

interface FakeRuntimeState {
  created: boolean;
  activeState: "active" | "deactivating" | "inactive";
  subState: "running" | "stop-sigterm" | "dead" | "exited";
  pids: number[];
  invocationId: string;
  stopLeavesProcess: boolean;
  execMainCode: number;
  execMainStatus: number;
  result: string;
}

function showOutput(state: FakeRuntimeState): string {
  if (!state.created) {
    return [
      "LoadState=not-found",
      "ActiveState=inactive",
      "SubState=dead",
      "User=",
      "Group=",
      "WorkingDirectory=",
      "UMask=",
      "KillMode=",
      "NoNewPrivileges=no",
      "RemainAfterExit=no",
      "InvocationID=",
      "ControlGroup=",
      "MainPID=0",
      "ExecMainCode=0",
      "ExecMainStatus=0",
      "Result=",
      "",
    ].join("\n");
  }
  return [
    "LoadState=loaded",
    `ActiveState=${state.activeState}`,
    `SubState=${state.subState}`,
    "User=mark",
    "Group=mark",
    "WorkingDirectory=/srv/projects/brai-new",
    "UMask=0077",
    "KillMode=control-group",
    "NoNewPrivileges=no",
    "RemainAfterExit=yes",
    `InvocationID=${state.invocationId}`,
    `ControlGroup=${CONTROL_GROUP}`,
    `MainPID=${state.activeState === "inactive" ? 0 : 4242}`,
    `ExecMainCode=${state.execMainCode}`,
    `ExecMainStatus=${state.execMainStatus}`,
    `Result=${state.result}`,
    "",
  ].join("\n");
}

class FakeRunner implements CommandRunner {
  public readonly calls: {
    readonly executable: string;
    readonly arguments: readonly string[];
  }[] = [];

  public constructor(private readonly state: FakeRuntimeState) {}

  public async run(
    executable: string,
    arguments_: readonly string[],
  ): Promise<CommandResult> {
    this.calls.push({ executable, arguments: [...arguments_] });
    if (executable === "/usr/bin/id") {
      if (arguments_[0] === "-u") return result("1000\n");
      if (arguments_[0] === "-g") return result("1000\n");
      if (arguments_[0] === "-G") return result("1000 27 999\n");
    }
    if (executable === "/usr/bin/systemctl" && arguments_[0] === "show") {
      return result(showOutput(this.state));
    }
    if (executable === "/usr/bin/systemd-run") {
      this.state.created = true;
      this.state.activeState = "active";
      this.state.subState = "running";
      this.state.pids = [4242];
      this.state.execMainCode = 0;
      this.state.execMainStatus = 0;
      this.state.result = "";
      return result();
    }
    if (executable === "/usr/bin/systemctl" && arguments_[0] === "stop") {
      if (this.state.stopLeavesProcess) {
        this.state.activeState = "deactivating";
        this.state.subState = "stop-sigterm";
      } else {
        this.state.activeState = "inactive";
        this.state.subState = "dead";
        this.state.pids = [];
      }
      return result();
    }
    if (executable === "/usr/bin/systemctl" && arguments_[0] === "kill") {
      this.state.activeState = "inactive";
      this.state.subState = "dead";
      this.state.pids = [];
      return result();
    }
    return result("", 1, `unexpected command: ${executable}`);
  }
}

class FakeInspector implements DeveloperRuntimeHostInspector {
  public constructor(private readonly state: FakeRuntimeState) {}

  public async readBootId(): Promise<string> {
    return BOOT_ID;
  }

  public async readProcessIdentity(
    _pid: number,
  ): Promise<ProcessIdentityFacts> {
    return {
      uid: 1000,
      gid: 1000,
      supplementaryGids: [999, 27, 1000],
      startTimeTicks: "818181",
    };
  }

  public async readCgroupInode(_controlGroup: string): Promise<string> {
    return "99117";
  }

  public async listCgroupPids(
    _controlGroup: string,
  ): Promise<readonly number[]> {
    return [...this.state.pids];
  }

  public async cgroupExists(_controlGroup: string): Promise<boolean> {
    return this.state.created && this.state.activeState !== "inactive";
  }
}

class FakeClock implements DeveloperRuntimeClock {
  private milliseconds = Date.parse("2026-07-17T12:00:00.000Z");

  public now(): Date {
    return new Date(this.milliseconds);
  }

  public async sleep(milliseconds: number): Promise<void> {
    this.milliseconds += milliseconds;
  }
}

function fixture(stopLeavesProcess = false): {
  readonly state: FakeRuntimeState;
  readonly runner: FakeRunner;
  readonly controller: DeveloperRuntimeController;
} {
  const state: FakeRuntimeState = {
    created: false,
    activeState: "inactive",
    subState: "dead",
    pids: [],
    invocationId: INVOCATION_ID,
    stopLeavesProcess,
    execMainCode: 0,
    execMainStatus: 0,
    result: "",
  };
  const runner = new FakeRunner(state);
  return {
    state,
    runner,
    controller: new DeveloperRuntimeController({
      runner,
      inspector: new FakeInspector(state),
      clock: new FakeClock(),
      launchTimeoutMilliseconds: 100,
      gracefulStopMilliseconds: 100,
      forceStopMilliseconds: 100,
    }),
  };
}

function launchInput() {
  return {
    profile: "developer" as const,
    runId: RUN_ID,
    jobDigestSha256: calculateDeveloperJobDigest(COMMAND),
    command: COMMAND,
  };
}

function verifiedContract(
  profile: "developer" | "user-sandbox" = "developer",
): InternalAgentLaunchContract {
  return {
    schema_version: INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
    run_id: RUN_ID,
    project_id: "dbb46c2e-bef0-4c9f-96f6-8a020fe20846",
    environment_id:
      profile === "developer" ? null : "d9bdc807-0df2-4d48-b38c-119bc8a3456b",
    runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
    job: {
      reference: "jobs/developer-runtime-test@1",
      command_sha256: calculateDeveloperJobDigest(COMMAND),
    },
    access: {
      schema_version: LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
      user_id: "3f88bde1-2b49-46cb-914d-7500afdf82d6",
      profile,
      access_generation: 7,
      quota: { bytes: 5_368_709_120, inodes: 500_000 },
    },
    issued_at: "2026-07-17T12:00:00.000Z",
    expires_at: "2026-07-17T12:05:00.000Z",
    key_id: "launch-key:2026-07",
    signature: "A".repeat(86),
  };
}

describe("developer transient systemd runtime", () => {
  it("adapts only a verified developer contract whose signed digest matches argv", () => {
    expect(
      developerRuntimeLaunchFromVerifiedContract(verifiedContract(), COMMAND),
    ).toEqual(launchInput());
    expect(() =>
      developerRuntimeLaunchFromVerifiedContract(
        verifiedContract("user-sandbox"),
        COMMAND,
      ),
    ).toThrow(
      expect.objectContaining({ code: "DEVELOPER_RUNTIME_INPUT_INVALID" }),
    );
  });

  it("starts the immutable argv as mark with only fixed unit properties", async () => {
    const { controller, runner } = fixture();

    const receipt = await controller.launch(launchInput());

    expect(receipt).toMatchObject({
      kind: "developer-runtime-launched",
      identity: {
        runId: RUN_ID,
        unitName: `brai-developer-agent-${RUN_ID}.service`,
        bootId: BOOT_ID,
        invocationId: INVOCATION_ID,
        controlGroup: CONTROL_GROUP,
        controlGroupInode: "99117",
        mainPid: 4242,
        mainPidStartTimeTicks: "818181",
        uid: 1000,
        gid: 1000,
        supplementaryGids: [27, 999, 1000],
        systemd: {
          user: "mark",
          group: "mark",
          workingDirectory: "/srv/projects/brai-new",
          umask: "0077",
          killMode: "control-group",
          noNewPrivileges: false,
        },
      },
    });
    expect(developerRuntimeIdentityForAccessReceipt(receipt.identity)).toEqual({
      schema_version: "brai.agent.runtime.identity.v1",
      runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
      profile: "developer",
      boot_id: BOOT_ID,
      systemd_invocation_id: INVOCATION_ID,
      unit: `brai-developer-agent-${RUN_ID}.service`,
      cgroup_path: CONTROL_GROUP,
      cgroup_inode: 99117,
      leader_pid: 4242,
      leader_start_time_ticks: 818181,
      machine: null,
    });
    const systemdRun = runner.calls.find(
      (call) => call.executable === "/usr/bin/systemd-run",
    );
    expect(systemdRun?.arguments).toEqual([
      "--system",
      "--no-block",
      "--quiet",
      `--unit=brai-developer-agent-${RUN_ID}.service`,
      "--property=Type=exec",
      "--property=User=mark",
      "--property=Group=mark",
      "--property=WorkingDirectory=/srv/projects/brai-new",
      "--property=UMask=0077",
      "--property=KillMode=control-group",
      "--property=NoNewPrivileges=no",
      "--property=RemainAfterExit=yes",
      "--property=TimeoutStopSec=10s",
      "--property=StandardOutput=journal",
      "--property=StandardError=journal",
      "--",
      "/usr/bin/node",
      "/srv/projects/brai-new/tools/agent.mjs",
      "--task",
      "safe value",
    ]);
  });

  it("rejects an argv changed after its immutable digest was issued", async () => {
    const { controller, runner } = fixture();
    const input = launchInput();

    await expect(
      controller.launch({
        ...input,
        command: {
          ...input.command,
          arguments: [...input.command.arguments, "--changed"],
        },
      }),
    ).rejects.toMatchObject({
      code: "DEVELOPER_RUNTIME_JOB_DIGEST_MISMATCH",
    });
    expect(
      runner.calls.some((call) => call.executable === "/usr/bin/systemd-run"),
    ).toBe(false);
  });

  it("terminates the exact measured unit and verifies an empty cgroup", async () => {
    const { controller, runner } = fixture();
    const launchReceipt = await controller.launch(launchInput());

    const receipt = await controller.terminate(launchReceipt);

    expect(receipt).toMatchObject({
      kind: "developer-runtime-terminated",
      alreadyInactive: false,
      escalatedToSigkill: false,
      finalActiveState: "inactive",
      remainingPids: [],
    });
    expect(
      runner.calls.filter(
        (call) =>
          call.executable === "/usr/bin/systemctl" &&
          call.arguments[0] === "stop",
      ),
    ).toEqual([
      {
        executable: "/usr/bin/systemctl",
        arguments: [
          "stop",
          "--no-block",
          `brai-developer-agent-${RUN_ID}.service`,
        ],
      },
    ]);
  });

  it("maps numeric systemd CLD_EXITED only after the whole cgroup is empty", async () => {
    const { controller, state } = fixture();
    const launchReceipt = await controller.launch(launchInput());
    state.subState = "exited";
    state.pids = [];
    state.execMainCode = 1;
    state.execMainStatus = 0;
    state.result = "success";

    await expect(controller.waitForExit(launchReceipt)).resolves.toMatchObject({
      outcome: "succeeded",
      exitCode: 0,
      signal: null,
    });
  });

  it("maps numeric systemd CLD_KILLED to the exact signal", async () => {
    const { controller, state } = fixture();
    const launchReceipt = await controller.launch(launchInput());
    state.subState = "exited";
    state.pids = [];
    state.execMainCode = 2;
    state.execMainStatus = 15;
    state.result = "signal";

    await expect(controller.waitForExit(launchReceipt)).resolves.toMatchObject({
      outcome: "failed",
      exitCode: null,
      signal: "SIGTERM",
    });
  });

  it("uses SIGKILL only after the fixed graceful interval expires", async () => {
    const { controller, runner } = fixture(true);
    const launchReceipt = await controller.launch(launchInput());

    const receipt = await controller.terminate(launchReceipt);

    expect(receipt.escalatedToSigkill).toBe(true);
    expect(
      runner.calls.find(
        (call) =>
          call.executable === "/usr/bin/systemctl" &&
          call.arguments[0] === "kill",
      )?.arguments,
    ).toEqual([
      "kill",
      "--kill-whom=all",
      "--signal=SIGKILL",
      `brai-developer-agent-${RUN_ID}.service`,
    ]);
  });

  it("fails closed before stop when InvocationID no longer matches", async () => {
    const { controller, runner, state } = fixture();
    const launchReceipt = await controller.launch(launchInput());
    state.invocationId = "b".repeat(32);

    await expect(controller.terminate(launchReceipt)).rejects.toMatchObject({
      code: "DEVELOPER_RUNTIME_IDENTITY_MISMATCH",
    });
    expect(
      runner.calls.some(
        (call) =>
          call.executable === "/usr/bin/systemctl" &&
          call.arguments[0] === "stop",
      ),
    ).toBe(false);
  });
});
