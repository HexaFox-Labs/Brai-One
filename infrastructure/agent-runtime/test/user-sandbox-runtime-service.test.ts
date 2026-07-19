import { generateKeyPairSync } from "node:crypto";

import {
  WEB_AGENT_COMMAND_SHA256,
  issueInternalAgentLaunchContract,
  webAgentJobReference,
} from "@brai/agent-access";
import {
  ACCESS_RUNTIME_AGENT_RUN_LAUNCH_REQUEST_SCHEMA_VERSION,
  LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
  type InternalAgentLaunchContract,
  type SignedTrustedReceiptEnvelope,
} from "@brai/contracts";
import { describe, expect, it } from "vitest";

import type { RuntimeReceiptSubmitter } from "../src/runtime-host-receipts.js";
import type { RuntimeHostLogger } from "../src/runtime-host-service.js";
import {
  RuntimeHostRouterService,
  type RuntimeProfileHostService,
} from "../src/runtime-host-router.js";
import {
  type UserSandboxRunRegistry,
  type UserSandboxRunRegistryEntry,
  type UserSandboxRunRegistryRecord,
} from "../src/user-sandbox-runtime-registry.js";
import {
  type PreparedUserSandboxRuntime,
  type UserSandboxRuntimeController,
  type UserSandboxRuntimeLaunchReceipt,
} from "../src/user-sandbox-runtime.js";
import { UserSandboxRuntimeHostService } from "../src/user-sandbox-runtime-service.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const USER_ID = "2f88bde1-2b49-46cb-914d-7500afdf82d6";
const PROJECT_ID = "1f88bde1-2b49-46cb-914d-7500afdf82d6";
const ENVIRONMENT_ID = "5f88bde1-2b49-46cb-914d-7500afdf82d6";
const RUNS = [
  "4f88bde1-2b49-46cb-914d-7500afdf82d6",
  "7f88bde1-2b49-46cb-914d-7500afdf82d6",
] as const;
const PROMPT = "Собери два проекта параллельно.";
const launchKeys = generateKeyPairSync("ed25519");
const receiptKeys = generateKeyPairSync("ed25519");

function contract(runId: string): InternalAgentLaunchContract {
  return issueInternalAgentLaunchContract({
    runId,
    projectId: PROJECT_ID,
    environmentId: ENVIRONMENT_ID,
    job: {
      reference: webAgentJobReference(PROMPT),
      command_sha256: WEB_AGENT_COMMAND_SHA256,
    },
    access: {
      schema_version: LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
      user_id: USER_ID,
      profile: "user-sandbox",
      access_generation: 9,
      quota: { bytes: 1_073_741_824, inodes: 100_000 },
    },
    issuedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 120_000),
    keyId: "launch-key",
    privateKey: launchKeys.privateKey,
  });
}

function request(runId: string, requestId: string) {
  return {
    schema_version: ACCESS_RUNTIME_AGENT_RUN_LAUNCH_REQUEST_SCHEMA_VERSION,
    request_id: requestId,
    sent_at: NOW.toISOString(),
    payload: { launch_contract: contract(runId), prompt: PROMPT },
  };
}

function receipt(
  launchContract: InternalAgentLaunchContract,
): UserSandboxRuntimeLaunchReceipt {
  const runId = launchContract.run_id;
  return {
    kind: "user-sandbox-runtime-launched",
    schemaVersion: 1,
    observedAt: NOW.toISOString(),
    identity: {
      schemaVersion: 1,
      profile: "user-sandbox",
      runId,
      jobDigestSha256: WEB_AGENT_COMMAND_SHA256,
      environmentId: ENVIRONMENT_ID,
      userId: USER_ID,
      accessGeneration: 9,
      environmentName: "brai-u-0",
      machineName: "brai-u-0",
      unitName: `brai-sandbox-agent-${runId}.service`,
      innerMainPid: 42,
      bootId: "3f88bde1-2b49-46cb-914d-7500afdf82d6",
      invocationId: "a".repeat(32),
      controlGroup: `/machine.slice/brai-u-0/${runId}`,
      controlGroupInode: "99117",
      mainPid: runId === RUNS[0] ? 4242 : 4243,
      mainPidStartTimeTicks: "818181",
      outerRootUid: 1_879_048_192,
      imageBraiUid: 1_879_049_192,
      systemd: {
        user: "root",
        group: "root",
        workingDirectory: "/data/workspace",
        umask: "0077",
        killMode: "control-group",
        noNewPrivileges: true,
        remainAfterExit: true,
      },
    },
  };
}

class MemoryRegistry implements UserSandboxRunRegistry {
  readonly entries = new Map<string, UserSandboxRunRegistryEntry>();
  public async get(runId: string) {
    return this.entries.get(runId) ?? null;
  }
  public async put(record: UserSandboxRunRegistryEntry): Promise<void> {
    this.entries.set(record.run_id, record);
  }
  public async listRecoverable(): Promise<
    readonly UserSandboxRunRegistryRecord[]
  > {
    return [...this.entries.values()].filter(
      (entry): entry is UserSandboxRunRegistryRecord =>
        entry.kind === "user-sandbox-runtime" &&
        !["exited", "terminated"].includes(entry.phase),
    );
  }
}

class FakeController implements UserSandboxRuntimeController {
  readonly prepared: string[] = [];
  readonly released: string[] = [];

  public async prepareFromVerifiedContract(
    launchContract: InternalAgentLaunchContract,
    standardInput: string,
  ): Promise<PreparedUserSandboxRuntime> {
    expect(standardInput).toBe(PROMPT);
    this.prepared.push(launchContract.run_id);
    const launchReceipt = receipt(launchContract);
    return {
      launchReceipt,
      recovery: {
        launchReceipt,
        gate: {
          fifoHostPath: `/var/lib/brai-agent-runtime/user-gates/brai-u-0/${launchContract.run_id}.release`,
          readyHostPath: `/var/lib/brai-agent-runtime/user-gates/brai-u-0/${launchContract.run_id}.ready`,
          stdinHostPath: `/var/lib/brai-agent-runtime/user-gates/brai-u-0/${launchContract.run_id}.stdin`,
          fifoGuestPath: `/run/brai-agent-gates/${launchContract.run_id}.release`,
          readyGuestPath: `/run/brai-agent-gates/${launchContract.run_id}.ready`,
          stdinGuestPath: `/run/brai-agent-gates/${launchContract.run_id}.stdin`,
          token: "b".repeat(64),
        },
      },
    };
  }

  public restoreHeld(recovery: PreparedUserSandboxRuntime["recovery"]) {
    return { launchReceipt: recovery.launchReceipt, recovery };
  }

  public async release(prepared: PreparedUserSandboxRuntime): Promise<void> {
    this.released.push(prepared.launchReceipt.identity.runId);
  }

  public async terminate(prepared: PreparedUserSandboxRuntime) {
    return this.termination(prepared.launchReceipt);
  }

  public async terminateRecovered(
    recovery: PreparedUserSandboxRuntime["recovery"],
  ) {
    return this.termination(recovery.launchReceipt);
  }

  private termination(launchReceipt: UserSandboxRuntimeLaunchReceipt) {
    return {
      kind: "user-sandbox-runtime-terminated" as const,
      schemaVersion: 1 as const,
      observedAt: NOW.toISOString(),
      identity: launchReceipt.identity,
      alreadyInactive: false,
      escalatedToSigkill: false,
      finalActiveState: "inactive" as const,
      remainingPids: [] as const,
    };
  }

  public async waitForExit() {
    return await new Promise<never>(() => undefined);
  }

  public async collectExited(): Promise<void> {}
}

class Submitter implements RuntimeReceiptSubmitter {
  readonly receipts: SignedTrustedReceiptEnvelope[] = [];
  public async submit(receipt: SignedTrustedReceiptEnvelope) {
    this.receipts.push(receipt);
    return "applied" as const;
  }
}

const logger: RuntimeHostLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe("user-sandbox runtime lifecycle", () => {
  it("starts parallel agents as separate units in one persistent machine and emits typed claim/started receipts", async () => {
    const controller = new FakeController();
    const submitter = new Submitter();
    const service = new UserSandboxRuntimeHostService({
      controller,
      registry: new MemoryRegistry(),
      receiptSubmitter: submitter,
      launchKeyId: "launch-key",
      launchPublicKey: launchKeys.publicKey,
      receiptKeyId: "receipt-key",
      receiptPrivateKey: receiptKeys.privateKey,
      logger,
      now: () => NOW,
    });
    const developer = {
      handleLaunch: async () => {
        throw new Error("sandbox launch was routed to developer");
      },
      handleTerminate: async () => {
        throw new Error("sandbox termination was routed to developer");
      },
      recover: async () => undefined,
    } as RuntimeProfileHostService;
    const router = new RuntimeHostRouterService(developer, service);

    const responses = await Promise.all([
      router.handleLaunch(
        request(RUNS[0], "6f88bde1-2b49-46cb-914d-7500afdf82d6"),
      ),
      router.handleLaunch(
        request(RUNS[1], "8f88bde1-2b49-46cb-914d-7500afdf82d6"),
      ),
    ]);

    expect(responses.every((response) => response.payload.accepted)).toBe(true);
    expect(controller.prepared.sort()).toEqual([...RUNS].sort());
    expect(controller.released.sort()).toEqual([...RUNS].sort());
    expect(submitter.receipts.map((item) => item.purpose).sort()).toEqual([
      "runtime-claim-v2",
      "runtime-claim-v2",
      "runtime-started-v2",
      "runtime-started-v2",
    ]);
    const identities = submitter.receipts
      .filter((item) => item.purpose === "runtime-claim-v2")
      .map((item) => {
        const payload = JSON.parse(item.payload) as {
          runtimeIdentity: { profile: string; machine: string };
        };
        return payload.runtimeIdentity;
      });
    expect(identities).toEqual([
      expect.objectContaining({
        profile: "user-sandbox",
        machine: "brai-u-0",
      }),
      expect.objectContaining({
        profile: "user-sandbox",
        machine: "brai-u-0",
      }),
    ]);
  });
});
