import { generateKeyPairSync, sign } from "node:crypto";

import {
  ACCESS_RUNTIME_RECEIPT_REQUEST_SCHEMA_VERSION,
  RUNTIME_IDENTITY_SCHEMA_VERSION,
} from "@brai/contracts";
import { createLogger } from "@brai/runtime";
import { describe, expect, it, vi } from "vitest";

import {
  RuntimeReceiptApiService,
  type RuntimeReceiptCommands,
} from "../src/runtime-receipt-api-service.js";
import {
  trustedReceiptEnvelopeSigningBytes,
  type SignedTrustedReceiptEnvelope,
  type TrustedReceiptPurpose,
} from "../src/signed-receipts.js";

const REQUEST_ID = "1f88bde1-2b49-46cb-914d-7500afdf82d6";
const PROJECT_ID = "2f88bde1-2b49-46cb-914d-7500afdf82d6";
const USER_ID = "3f88bde1-2b49-46cb-914d-7500afdf82d6";
const RUN_ID = "4f88bde1-2b49-46cb-914d-7500afdf82d6";
const KEY_ID = "runtime-receipt:test";
const SENT_AT = "2026-07-17T12:00:00.000Z";
const keys = generateKeyPairSync("ed25519");
const runtimeIdentity = {
  schema_version: RUNTIME_IDENTITY_SCHEMA_VERSION,
  profile: "developer",
  runtime_host_id: "brai-runtime-host-1",
  boot_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  systemd_invocation_id: "a".repeat(32),
  unit: "brai-developer-run.service",
  cgroup_path: "/brai-developer.slice/brai-developer-run.service",
  cgroup_inode: 42_001,
  leader_pid: 12_345,
  leader_start_time_ticks: 987_654,
  machine: null,
} as const;

function envelope(
  purpose: TrustedReceiptPurpose,
  payload: unknown,
): SignedTrustedReceiptEnvelope {
  const unsigned = {
    version: 1,
    purpose,
    key_id: KEY_ID,
    payload: JSON.stringify(payload),
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

function request(receipt: SignedTrustedReceiptEnvelope) {
  return {
    schema_version: ACCESS_RUNTIME_RECEIPT_REQUEST_SCHEMA_VERSION,
    request_id: REQUEST_ID,
    sent_at: SENT_AT,
    payload: { receipt },
  };
}

function service(commands: RuntimeReceiptCommands) {
  return new RuntimeReceiptApiService(
    commands,
    (keyId) => (keyId === KEY_ID ? keys.publicKey : undefined),
    createLogger({
      name: "runtime-receipt-api-test",
      level: "silent",
    }),
  );
}

function commands(
  overrides: Partial<RuntimeReceiptCommands> = {},
): RuntimeReceiptCommands {
  return {
    claimPendingRunFromTrustedRuntime: vi.fn(async () => "applied" as const),
    markClaimedRunRunningFromTrustedRuntime: vi.fn(
      async () => "applied" as const,
    ),
    completeClaimedRunFromTrustedRuntime: vi.fn(async () => "applied" as const),
    ...overrides,
  };
}

describe("RuntimeReceiptApiService", () => {
  it("verifies a signed claim before the one-use access CAS", async () => {
    let calls = 0;
    const claim = vi.fn(async (_context, verified) => {
      expect(verified).toMatchObject({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        runtimeIdentity,
      });
      calls += 1;
      return calls === 1 ? ("applied" as const) : ("replayed" as const);
    }) satisfies RuntimeReceiptCommands["claimPendingRunFromTrustedRuntime"];
    const api = service(commands({ claimPendingRunFromTrustedRuntime: claim }));
    const signed = envelope("runtime-claim-v2", {
      projectId: PROJECT_ID,
      userId: USER_ID,
      environmentId: null,
      runId: RUN_ID,
      profile: "developer",
      accessGeneration: 2,
      runtimeHostId: "brai-runtime-host-1",
      jobReference: `brai.web-agent.codex-exec.v1:${"b".repeat(64)}`,
      commandSha256: "c".repeat(64),
      runtimeIdentity,
    });

    await expect(api.handleClaim(request(signed))).resolves.toMatchObject({
      payload: { accepted: true, disposition: "applied" },
    });
    await expect(api.handleClaim(request(signed))).resolves.toMatchObject({
      payload: { accepted: true, disposition: "replayed" },
    });
  });

  it("rejects a tampered signed envelope before the CAS", async () => {
    const runtimeCommands = commands();
    const signed = envelope("runtime-claim-v2", {
      projectId: PROJECT_ID,
    });
    const response = await service(runtimeCommands).handleClaim(
      request({
        ...signed,
        payload: JSON.stringify({ projectId: USER_ID }),
      }),
    );

    expect(response.payload).toMatchObject({
      accepted: false,
      code: "invalid_receipt",
    });
    expect(
      runtimeCommands.claimPendingRunFromTrustedRuntime,
    ).not.toHaveBeenCalled();
  });

  it("applies signed started and exit receipts to their exact CAS methods", async () => {
    const runtimeCommands = commands();
    const api = service(runtimeCommands);
    const started = envelope("runtime-started-v2", {
      projectId: PROJECT_ID,
      userId: USER_ID,
      runId: RUN_ID,
      accessGeneration: 2,
      runtimeIdentity,
      startedAt: SENT_AT,
    });
    const exit = envelope("runtime-exit-v2", {
      projectId: PROJECT_ID,
      userId: USER_ID,
      runId: RUN_ID,
      accessGeneration: 2,
      runtimeIdentity,
      outcome: "succeeded",
      exitCode: 0,
      signal: null,
      exitedAt: "2026-07-17T12:01:00.000Z",
      emptyCgroup: {
        observed_at: "2026-07-17T12:01:00.000Z",
        boot_id: runtimeIdentity.boot_id,
        systemd_invocation_id: runtimeIdentity.systemd_invocation_id,
        unit: runtimeIdentity.unit,
        cgroup_path: runtimeIdentity.cgroup_path,
        cgroup_inode: runtimeIdentity.cgroup_inode,
        populated: false,
        leader_present: false,
      },
    });

    await expect(api.handleStarted(request(started))).resolves.toMatchObject({
      payload: { accepted: true, disposition: "applied" },
    });
    await expect(api.handleExit(request(exit))).resolves.toMatchObject({
      payload: { accepted: true, disposition: "applied" },
    });
    expect(
      runtimeCommands.markClaimedRunRunningFromTrustedRuntime,
    ).toHaveBeenCalledOnce();
    expect(
      runtimeCommands.completeClaimedRunFromTrustedRuntime,
    ).toHaveBeenCalledOnce();
  });
});
