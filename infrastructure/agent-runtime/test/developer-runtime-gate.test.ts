import { describe, expect, it } from "vitest";

import {
  BRAI_SINGLE_RUNTIME_HOST_ID,
  INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
  LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
  type InternalAgentLaunchContract,
} from "@brai/contracts";

import {
  GatedDeveloperRuntimeController,
  type DeveloperGateDescriptor,
  type DeveloperGateStore,
  type DeveloperRuntimePreflight,
  type DeveloperRuntimeProcessController,
} from "../src/developer-runtime-gate.js";
import {
  calculateDeveloperJobDigest,
  type BoundDeveloperCommand,
  type DeveloperRuntimeExitObservation,
  type DeveloperRuntimeLaunchReceipt,
  type DeveloperRuntimeTerminationReceipt,
  type VerifiedDeveloperRuntimeLaunch,
} from "../src/developer-runtime.js";

const RUN_ID = "4f88bde1-2b49-46cb-914d-7500afdf82d6";
const COMMAND: BoundDeveloperCommand = {
  schemaVersion: 1,
  executable: "/srv/opt/codex-cli/bin/codex",
  arguments: ["exec", "--skip-git-repo-check", "-"],
};

function contract(
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
      reference: "jobs/codex-web-agent@1",
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

function launchReceipt(
  launch: VerifiedDeveloperRuntimeLaunch,
): DeveloperRuntimeLaunchReceipt {
  return {
    kind: "developer-runtime-launched",
    schemaVersion: 1,
    observedAt: "2026-07-17T12:00:01.000Z",
    identity: {
      schemaVersion: 1,
      profile: "developer",
      runId: launch.runId,
      jobDigestSha256: launch.jobDigestSha256,
      unitName: `brai-developer-agent-${RUN_ID}.service`,
      bootId: "3f88bde1-2b49-46cb-914d-7500afdf82d6",
      invocationId: "a".repeat(32),
      controlGroup: `/system.slice/brai-developer-agent-${RUN_ID}.service`,
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
  };
}

class FakeProcessController implements DeveloperRuntimeProcessController {
  public launches: VerifiedDeveloperRuntimeLaunch[] = [];
  public terminations: DeveloperRuntimeLaunchReceipt[] = [];

  public async launch(
    launch: VerifiedDeveloperRuntimeLaunch,
  ): Promise<DeveloperRuntimeLaunchReceipt> {
    this.launches.push(launch);
    return launchReceipt(launch);
  }

  public async terminate(
    receipt: DeveloperRuntimeLaunchReceipt,
  ): Promise<DeveloperRuntimeTerminationReceipt> {
    this.terminations.push(receipt);
    return {
      kind: "developer-runtime-terminated",
      schemaVersion: 1,
      observedAt: "2026-07-17T12:00:02.000Z",
      identity: receipt.identity,
      alreadyInactive: false,
      escalatedToSigkill: false,
      finalActiveState: "inactive",
      remainingPids: [],
    };
  }

  public async waitForExit(
    receipt: DeveloperRuntimeLaunchReceipt,
  ): Promise<DeveloperRuntimeExitObservation> {
    return {
      observedAt: "2026-07-17T12:00:03.000Z",
      identity: receipt.identity,
      outcome: "succeeded",
      exitCode: 0,
      signal: null,
    };
  }

  public async collectExited(): Promise<void> {}
}

class FakeGateStore implements DeveloperGateStore {
  public readonly events: string[] = [];
  public readonly gate: DeveloperGateDescriptor = {
    fifoPath: `${"/run/brai-agent-runtime/gates/"}${RUN_ID}.release`,
    readyPath: `${"/run/brai-agent-runtime/gates/"}${RUN_ID}.ready`,
    stdinPath: `${"/run/brai-agent-runtime/gates/"}${RUN_ID}.stdin`,
    token: "b".repeat(64),
  };

  public async create(runId: string): Promise<DeveloperGateDescriptor> {
    this.events.push(`create:${runId}`);
    return this.gate;
  }

  public async waitUntilReady(): Promise<void> {
    this.events.push("ready");
  }

  public async release(): Promise<void> {
    this.events.push("release");
  }

  public async cleanup(): Promise<void> {
    this.events.push("cleanup");
  }
}

class FakePreflight implements DeveloperRuntimePreflight {
  public readonly runIds: string[] = [];

  public async verify(runId: string): Promise<void> {
    this.runIds.push(runId);
  }
}

describe("developer durable-claim exec gate", () => {
  it("holds a trusted fixed wrapper while preserving the signed target digest", async () => {
    const processController = new FakeProcessController();
    const gates = new FakeGateStore();
    const preflight = new FakePreflight();
    const controller = new GatedDeveloperRuntimeController(
      processController,
      gates,
      preflight,
    );

    const prepared = await controller.prepareFromVerifiedContract(
      contract(),
      COMMAND,
      "task over stdin",
    );

    expect(preflight.runIds).toEqual([RUN_ID]);
    expect(gates.events).toEqual([`create:${RUN_ID}`, "ready"]);
    expect(processController.launches[0]?.command).toEqual({
      schemaVersion: 1,
      executable: "/srv/opt/brai-agent-runtime/bin/brai-exec-gate",
      arguments: [
        gates.gate.fifoPath,
        gates.gate.readyPath,
        gates.gate.token,
        "--",
        COMMAND.executable,
        ...COMMAND.arguments,
      ],
    });
    expect(prepared.launchReceipt.identity.jobDigestSha256).toBe(
      contract().job.command_sha256,
    );

    await controller.release(prepared);
    expect(gates.events).toEqual([
      `create:${RUN_ID}`,
      "ready",
      "release",
      "cleanup",
    ]);
  });

  it("can kill the measured gate before the target is released", async () => {
    const processController = new FakeProcessController();
    const gates = new FakeGateStore();
    const controller = new GatedDeveloperRuntimeController(
      processController,
      gates,
      new FakePreflight(),
    );
    const prepared = await controller.prepareFromVerifiedContract(
      contract(),
      COMMAND,
      "task over stdin",
    );

    const terminated = await controller.terminate(prepared);

    expect(processController.terminations).toHaveLength(1);
    expect(terminated.identity.jobDigestSha256).toBe(
      contract().job.command_sha256,
    );
    expect(gates.events.at(-1)).toBe("cleanup");
  });

  it("rejects a sandbox contract before creating a host gate", async () => {
    const gates = new FakeGateStore();
    const controller = new GatedDeveloperRuntimeController(
      new FakeProcessController(),
      gates,
      new FakePreflight(),
    );

    await expect(
      controller.prepareFromVerifiedContract(
        contract("user-sandbox"),
        COMMAND,
        "task over stdin",
      ),
    ).rejects.toMatchObject({ code: "DEVELOPER_RUNTIME_INPUT_INVALID" });
    expect(gates.events).toEqual([]);
  });
});
