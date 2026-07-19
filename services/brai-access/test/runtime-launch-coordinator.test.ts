import { generateKeyPairSync, sign } from "node:crypto";

import {
  BRAI_SINGLE_RUNTIME_HOST_ID,
  INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
  LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
  type InternalAgentLaunchContract,
  type SignedTrustedReceiptEnvelope,
} from "@brai/contracts";
import { describe, expect, it, vi } from "vitest";

import { CompensatingRuntimeDispatcher } from "../src/runtime-launch-coordinator.js";
import { trustedReceiptEnvelopeSigningBytes } from "../src/signed-receipts.js";

const PROJECT_ID = "2f88bde1-2b49-46cb-914d-7500afdf82d6";
const USER_ID = "3f88bde1-2b49-46cb-914d-7500afdf82d6";
const RUN_ID = "4f88bde1-2b49-46cb-914d-7500afdf82d6";
const KEY_ID = "runtime-receipt:test";
const keys = generateKeyPairSync("ed25519");

const launchContract: InternalAgentLaunchContract = {
  schema_version: INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
  run_id: RUN_ID,
  project_id: PROJECT_ID,
  environment_id: null,
  runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
  job: {
    reference: `brai.web-agent.codex-exec.v1:${"a".repeat(64)}`,
    command_sha256: "b".repeat(64),
  },
  access: {
    schema_version: LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
    user_id: USER_ID,
    profile: "developer",
    access_generation: 1,
    quota: { bytes: 5_368_709_120, inodes: 500_000 },
  },
  issued_at: "2026-07-17T12:00:00.000Z",
  expires_at: "2026-07-17T12:02:00.000Z",
  key_id: "launch:test",
  signature: "A".repeat(86),
};

function terminationEnvelope(): SignedTrustedReceiptEnvelope {
  const unsigned = {
    version: 1,
    purpose: "runtime-termination-v2",
    key_id: KEY_ID,
    payload: JSON.stringify({
      projectId: PROJECT_ID,
      userId: USER_ID,
      runId: RUN_ID,
      accessGeneration: 1,
      kind: "cancelled_before_start",
      runtimeIdentity: null,
      terminatedAt: "2026-07-17T12:00:01.000Z",
      emptyCgroup: null,
    }),
  } as const;
  return {
    ...unsigned,
    signature: sign(
      null,
      trustedReceiptEnvelopeSigningBytes(unsigned),
      keys.privateKey,
    ).toString("base64url"),
  };
}

describe("CompensatingRuntimeDispatcher", () => {
  it("turns a failed dispatch into exact verified termination", async () => {
    const dispatchFailure = new Error("ack lost");
    const access = {
      requestRunTerminationAfterDispatchFailure: vi.fn(async () => ({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        profile: "developer" as const,
        environmentId: null,
        accessGeneration: 1,
        runtimeIdentity: null,
      })),
      completeRequestedRunTerminationFromTrustedRuntime: vi.fn(
        async (_context, receipt) => {
          expect(receipt).toMatchObject({
            projectId: PROJECT_ID,
            userId: USER_ID,
            runId: RUN_ID,
            kind: "cancelled_before_start",
          });
        },
      ),
    };
    const terminate = vi.fn(async () => terminationEnvelope());
    const coordinator = new CompensatingRuntimeDispatcher(
      access,
      { dispatch: vi.fn(async () => Promise.reject(dispatchFailure)) },
      { terminate },
      (keyId) => (keyId === KEY_ID ? keys.publicKey : undefined),
    );

    await expect(
      coordinator.dispatch({
        launchContract,
        prompt: "test",
      }),
    ).rejects.toBe(dispatchFailure);
    expect(
      access.requestRunTerminationAfterDispatchFailure,
    ).toHaveBeenCalledWith(USER_ID, RUN_ID);
    expect(terminate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_ID,
      runId: RUN_ID,
      profile: "developer",
      environmentId: null,
      accessGeneration: 1,
      runtimeIdentity: null,
    });
    expect(
      access.completeRequestedRunTerminationFromTrustedRuntime,
    ).toHaveBeenCalledOnce();
  });

  it("fails closed with termination_requested retained when evidence is invalid", async () => {
    const access = {
      requestRunTerminationAfterDispatchFailure: vi.fn(async () => ({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        profile: "developer" as const,
        environmentId: null,
        accessGeneration: 1,
        runtimeIdentity: null,
      })),
      completeRequestedRunTerminationFromTrustedRuntime: vi.fn(),
    };
    const invalid = {
      ...terminationEnvelope(),
      signature: "A".repeat(86),
    };
    const coordinator = new CompensatingRuntimeDispatcher(
      access,
      { dispatch: vi.fn(async () => Promise.reject(new Error("failed"))) },
      { terminate: vi.fn(async () => invalid) },
      (keyId) => (keyId === KEY_ID ? keys.publicKey : undefined),
    );

    await expect(
      coordinator.dispatch({
        launchContract,
        prompt: "test",
      }),
    ).rejects.toThrow("exact termination remains pending");
    expect(
      access.completeRequestedRunTerminationFromTrustedRuntime,
    ).not.toHaveBeenCalled();
  });
});
