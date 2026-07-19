import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  WEB_AGENT_COMMAND,
  WEB_AGENT_COMMAND_SHA256,
  issueInternalAgentLaunchContract,
  webAgentJobReference,
} from "@brai/agent-access";
import {
  ACCESS_RUNTIME_AGENT_RUN_LAUNCH_REQUEST_SCHEMA_VERSION,
  LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
  RUNTIME_AGENT_RUN_TERMINATE_REQUEST_SCHEMA_VERSION,
  type InternalAgentLaunchContract,
  type RuntimeIdentity,
  type SignedTrustedReceiptEnvelope,
} from "@brai/contracts";

import type {
  DeveloperGatedController,
  RuntimeHostLogger,
} from "../src/runtime-host-service.js";
import { DeveloperRuntimeHostService } from "../src/runtime-host-service.js";
import type {
  DeveloperRunRegistry,
  DeveloperRunRegistryEntry,
  DeveloperRunRegistryRecord,
} from "../src/runtime-host-registry.js";
import {
  RuntimeReceiptRejectedError,
  type RuntimeReceiptSubmitter,
} from "../src/runtime-host-receipts.js";
import {
  developerRuntimeIdentityForAccessReceipt,
  type DeveloperRuntimeLaunchReceipt,
} from "../src/developer-runtime.js";
import type {
  PreparedDeveloperRuntime,
  PreparedDeveloperRuntimeRecovery,
} from "../src/developer-runtime-gate.js";

const RUN_ID = "4f88bde1-2b49-46cb-914d-7500afdf82d6";
const PROJECT_ID = "1f88bde1-2b49-46cb-914d-7500afdf82d6";
const USER_ID = "2f88bde1-2b49-46cb-914d-7500afdf82d6";
const ENVIRONMENT_ID = "5f88bde1-2b49-46cb-914d-7500afdf82d6";
const REQUEST_ID = "6f88bde1-2b49-46cb-914d-7500afdf82d6";
const NOW = new Date("2026-07-17T12:00:00.000Z");
const PROMPT = "Исправь права без рекурсивного chmod.";
const launchKeys = generateKeyPairSync("ed25519");
const receiptKeys = generateKeyPairSync("ed25519");

function localLaunchReceipt(): DeveloperRuntimeLaunchReceipt {
  return {
    kind: "developer-runtime-launched",
    schemaVersion: 1,
    observedAt: "2026-07-17T12:00:01.000Z",
    identity: {
      schemaVersion: 1,
      profile: "developer",
      runId: RUN_ID,
      jobDigestSha256: WEB_AGENT_COMMAND_SHA256,
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

function recovery(): PreparedDeveloperRuntimeRecovery {
  const receipt = localLaunchReceipt();
  return {
    rawLaunchReceipt: receipt,
    mappedLaunchReceipt: receipt,
    gate: {
      fifoPath: `/run/brai-agent-runtime/gates/${RUN_ID}.release`,
      readyPath: `/run/brai-agent-runtime/gates/${RUN_ID}.ready`,
      stdinPath: `/run/brai-agent-runtime/gates/${RUN_ID}.stdin`,
      token: "b".repeat(64),
    },
  };
}

function contract(
  profile: "developer" | "user-sandbox" = "developer",
  prompt = PROMPT,
): InternalAgentLaunchContract {
  return issueInternalAgentLaunchContract({
    runId: RUN_ID,
    projectId: PROJECT_ID,
    environmentId: profile === "developer" ? null : ENVIRONMENT_ID,
    job: {
      reference: webAgentJobReference(prompt),
      command_sha256: WEB_AGENT_COMMAND_SHA256,
    },
    access: {
      schema_version: LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
      user_id: USER_ID,
      profile,
      access_generation: 7,
      quota: { bytes: 5_368_709_120, inodes: 500_000 },
    },
    issuedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 120_000),
    keyId: "launch-key:2026-07",
    privateKey: launchKeys.privateKey,
  });
}

function launchRequest(launchContract = contract(), prompt = PROMPT) {
  return {
    schema_version: ACCESS_RUNTIME_AGENT_RUN_LAUNCH_REQUEST_SCHEMA_VERSION,
    request_id: REQUEST_ID,
    sent_at: NOW.toISOString(),
    payload: {
      launch_contract: launchContract,
      prompt,
    },
  };
}

class MemoryRegistry implements DeveloperRunRegistry {
  public readonly entries = new Map<string, DeveloperRunRegistryEntry>();
  public constructor(public readonly events: string[] = []) {}

  public async get(runId: string) {
    return this.entries.get(runId) ?? null;
  }

  public async put(entry: DeveloperRunRegistryEntry): Promise<void> {
    this.events.push(
      `registry:${entry.kind}:${entry.kind === "runtime" ? entry.phase : "cancelled"}`,
    );
    this.entries.set(entry.run_id, entry);
  }

  public async listRecoverable(): Promise<
    readonly DeveloperRunRegistryRecord[]
  > {
    return [...this.entries.values()].filter(
      (entry): entry is DeveloperRunRegistryRecord =>
        entry.kind === "runtime" &&
        !["exited", "terminated"].includes(entry.phase),
    );
  }
}

class FakeController implements DeveloperGatedController {
  private resolveExit:
    | ((
        value: Awaited<ReturnType<DeveloperGatedController["waitForExit"]>>,
      ) => void)
    | null = null;

  public constructor(public readonly events: string[] = []) {}

  public async prepareFromVerifiedContract(
    _contract: InternalAgentLaunchContract,
    command: typeof WEB_AGENT_COMMAND,
    standardInput: string,
  ): Promise<PreparedDeveloperRuntime> {
    this.events.push("prepare");
    expect(command).toEqual(WEB_AGENT_COMMAND);
    expect(standardInput).toBe(PROMPT);
    return {
      launchReceipt: localLaunchReceipt(),
      recovery: recovery(),
    };
  }

  public restoreHeld(
    stored: PreparedDeveloperRuntimeRecovery,
  ): PreparedDeveloperRuntime {
    this.events.push("restore");
    return {
      launchReceipt: stored.mappedLaunchReceipt,
      recovery: stored,
    };
  }

  public async release(): Promise<void> {
    this.events.push("release");
  }

  public async terminate() {
    this.events.push("terminate");
    return this.termination();
  }

  public async terminateRecovered() {
    this.events.push("terminate-recovered");
    return this.termination();
  }

  private termination() {
    return {
      kind: "developer-runtime-terminated" as const,
      schemaVersion: 1 as const,
      observedAt: "2026-07-17T12:00:02.000Z",
      identity: localLaunchReceipt().identity,
      alreadyInactive: false,
      escalatedToSigkill: false,
      finalActiveState: "inactive" as const,
      remainingPids: [] as const,
    };
  }

  public async waitForExit() {
    this.events.push("wait-exit");
    return await new Promise<
      Awaited<ReturnType<DeveloperGatedController["waitForExit"]>>
    >((resolve) => {
      this.resolveExit = resolve;
    });
  }

  public async collectExited(): Promise<void> {
    this.events.push("collect");
  }

  public observeSuccessfulExit(): void {
    this.resolveExit?.({
      observedAt: "2026-07-17T12:00:03.000Z",
      identity: localLaunchReceipt().identity,
      outcome: "succeeded",
      exitCode: 0,
      signal: null,
    });
  }
}

class FakeSubmitter implements RuntimeReceiptSubmitter {
  public readonly receipts: SignedTrustedReceiptEnvelope[] = [];
  public rejectPurpose: SignedTrustedReceiptEnvelope["purpose"] | null = null;

  public constructor(private readonly events: string[] = []) {}

  public async submit(receipt: SignedTrustedReceiptEnvelope) {
    this.events.push(`submit:${receipt.purpose}`);
    this.receipts.push(receipt);
    if (receipt.purpose === this.rejectPurpose) {
      throw new RuntimeReceiptRejectedError("stale_binding", "test rejection");
    }
    return "applied" as const;
  }
}

const logger: RuntimeHostLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function fixture() {
  const events: string[] = [];
  const registry = new MemoryRegistry(events);
  const controller = new FakeController(events);
  const submitter = new FakeSubmitter(events);
  const service = new DeveloperRuntimeHostService({
    controller,
    registry,
    receiptSubmitter: submitter,
    launchKeyId: "launch-key:2026-07",
    launchPublicKey: launchKeys.publicKey,
    receiptKeyId: "runtime-key:2026-07",
    receiptPrivateKey: receiptKeys.privateKey,
    logger,
    now: () => NOW,
  });
  return { events, registry, controller, submitter, service };
}

function accessIdentity(): RuntimeIdentity {
  return developerRuntimeIdentityForAccessReceipt(
    localLaunchReceipt().identity,
  );
}

describe("trusted developer runtime host", () => {
  it("persists claim, applies DB CAS, then releases and records start", async () => {
    const { events, service, registry, submitter } = fixture();

    const response = await service.handleLaunch(launchRequest());

    expect(response.payload).toEqual({
      accepted: true,
      run_id: RUN_ID,
    });
    expect(submitter.receipts.map((item) => item.purpose)).toEqual([
      "runtime-claim-v2",
      "runtime-started-v2",
    ]);
    expect(registry.events).toEqual([
      "prepare",
      "registry:runtime:held",
      "submit:runtime-claim-v2",
      "registry:runtime:claimed",
      "release",
      "registry:runtime:released",
      "submit:runtime-started-v2",
      "registry:runtime:started",
      "wait-exit",
    ]);
    expect(events).toBe(registry.events);
    const claim = JSON.parse(submitter.receipts[0]!.payload) as {
      runtimeIdentity: RuntimeIdentity;
      commandSha256: string;
    };
    expect(claim.runtimeIdentity).toEqual(accessIdentity());
    expect(claim.commandSha256).toBe(WEB_AGENT_COMMAND_SHA256);
  });

  it("kills the held gate when claim CAS is refused", async () => {
    const { service, controller, submitter } = fixture();
    submitter.rejectPurpose = "runtime-claim-v2";

    const response = await service.handleLaunch(launchRequest());

    expect(response.payload).toMatchObject({
      accepted: false,
      code: "invalid_contract",
    });
    expect(controller.events).toContain("terminate");
    expect(controller.events).not.toContain("release");
  });

  it("rejects prompt substitution and user-sandbox before host preparation", async () => {
    const first = fixture();
    const promptMismatch = await first.service.handleLaunch(
      launchRequest(contract(), "другая задача"),
    );
    expect(promptMismatch.payload).toMatchObject({
      accepted: false,
      code: "invalid_contract",
    });
    expect(first.controller.events).toEqual([]);

    const second = fixture();
    const sandbox = await second.service.handleLaunch(
      launchRequest(contract("user-sandbox")),
    );
    expect(sandbox.payload).toMatchObject({
      accepted: false,
      code: "invalid_contract",
    });
    expect(second.controller.events).toEqual([]);
  });

  it("terminates only the exact stored process identity", async () => {
    const { service, controller, registry } = fixture();
    await service.handleLaunch(launchRequest());
    const request = {
      schema_version: RUNTIME_AGENT_RUN_TERMINATE_REQUEST_SCHEMA_VERSION,
      request_id: REQUEST_ID,
      sent_at: NOW.toISOString(),
      payload: {
        project_id: PROJECT_ID,
        user_id: USER_ID,
        run_id: RUN_ID,
        access_generation: 7,
        profile: "developer",
        environment_id: null,
        runtime_identity: accessIdentity(),
      },
    };

    const response = await service.handleTerminate(request);

    expect(response.payload).toMatchObject({
      accepted: true,
      run_id: RUN_ID,
    });
    expect(controller.events).toContain("terminate-recovered");
    if (response.payload.accepted) {
      const payload = JSON.parse(
        response.payload.termination_receipt.payload,
      ) as {
        runtimeIdentity: RuntimeIdentity;
        emptyCgroup: { populated: boolean; leader_present: boolean };
      };
      expect(payload.runtimeIdentity).toEqual(accessIdentity());
      expect(payload.emptyCgroup).toMatchObject({
        populated: false,
        leader_present: false,
      });
    }
    controller.observeSuccessfulExit();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    const finalRecord = await registry.get(RUN_ID);
    expect(finalRecord?.kind === "runtime" ? finalRecord.phase : null).toBe(
      "terminated",
    );
  });

  it("durably tombstones cancellation-before-start and blocks later launch", async () => {
    const { service, registry, controller } = fixture();
    const termination = await service.handleTerminate({
      schema_version: RUNTIME_AGENT_RUN_TERMINATE_REQUEST_SCHEMA_VERSION,
      request_id: REQUEST_ID,
      sent_at: NOW.toISOString(),
      payload: {
        project_id: PROJECT_ID,
        user_id: USER_ID,
        run_id: RUN_ID,
        access_generation: 7,
        profile: "developer",
        environment_id: null,
        runtime_identity: null,
      },
    });
    expect(termination.payload).toMatchObject({ accepted: true });
    expect((await registry.get(RUN_ID))?.kind).toBe("cancellation");

    const launch = await service.handleLaunch(launchRequest());
    expect(launch.payload).toMatchObject({
      accepted: false,
      code: "invalid_contract",
    });
    expect(controller.events).not.toContain("prepare");
  });
});
