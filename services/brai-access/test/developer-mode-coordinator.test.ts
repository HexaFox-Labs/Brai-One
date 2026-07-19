import { generateKeyPairSync, sign } from "node:crypto";

import {
  USER_ACCESS_STATE_SCHEMA_VERSION,
  type ActiveUserAccessState,
  type SignedTrustedReceiptEnvelope,
} from "@brai/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  DeveloperModeCoordinator,
  type DeveloperModeCommands,
} from "../src/developer-mode-coordinator.js";
import { trustedReceiptEnvelopeSigningBytes } from "../src/signed-receipts.js";
import { trustedPlatformAdminContextFromServerIdentity } from "../src/trusted-context.js";
import type { RuntimeTerminator } from "../src/runtime-terminator.js";
import type { DeveloperModeTransition } from "../src/types.js";

const ADMIN_ID = "1f88bde1-2b49-46cb-914d-7500afdf82d6";
const PROJECT_ID = "2f88bde1-2b49-46cb-914d-7500afdf82d6";
const USER_ID = "3f88bde1-2b49-46cb-914d-7500afdf82d6";
const RUN_ID = "4f88bde1-2b49-46cb-914d-7500afdf82d6";
const KEY_ID = "runtime-receipt:test";
const keys = generateKeyPairSync("ed25519");

function activeState(): ActiveUserAccessState {
  return {
    schema_version: USER_ACCESS_STATE_SCHEMA_VERSION,
    status: "active",
    user_id: USER_ID,
    developer_mode: true,
    access_generation: 2,
    quota: { bytes: 5_368_709_120, inodes: 500_000 },
  };
}

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
      terminatedAt: "2026-07-17T12:00:00.000Z",
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

function commands(
  overrides: Partial<DeveloperModeCommands> = {},
): DeveloperModeCommands {
  return {
    beginDeveloperModeTransition: vi.fn(
      async (): Promise<DeveloperModeTransition> => ({
        changed: true,
        user_id: USER_ID,
        access_generation: 2,
        runs_to_terminate: [{ run_id: RUN_ID, access_generation: 1 }],
        runtime_bindings_to_terminate: [
          {
            projectId: PROJECT_ID,
            runId: RUN_ID,
            profile: "developer",
            environmentId: null,
            accessGeneration: 1,
            runtimeIdentity: null,
          },
        ],
      }),
    ),
    completeDeveloperModeTransitionFromTrustedRuntime: vi.fn(
      async (_context, _command, receipts) => {
        expect(receipts).toHaveLength(1);
        expect(receipts[0]).toMatchObject({
          projectId: PROJECT_ID,
          userId: USER_ID,
          runId: RUN_ID,
          kind: "cancelled_before_start",
        });
        return activeState();
      },
    ),
    ...overrides,
  };
}

function coordinator(
  access: DeveloperModeCommands,
  terminator: RuntimeTerminator,
) {
  return new DeveloperModeCoordinator(access, terminator, (keyId) =>
    keyId === KEY_ID ? keys.publicKey : undefined,
  );
}

describe("DeveloperModeCoordinator", () => {
  it("activates the new profile only after the exact signed termination receipt", async () => {
    const access = commands();
    const terminate = vi.fn(async () => terminationEnvelope());
    const result = await coordinator(access, { terminate }).setMode(
      trustedPlatformAdminContextFromServerIdentity(ADMIN_ID),
      {
        target_user_id: USER_ID,
        requested_developer_mode: true,
      },
    );

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
      access.completeDeveloperModeTransitionFromTrustedRuntime,
    ).toHaveBeenCalledOnce();
    expect(result).toEqual({
      changed: true,
      user_id: USER_ID,
      access_generation: 2,
      runs_to_terminate: [],
    });
  });

  it("leaves the fail-closed transition incomplete when the receipt is invalid", async () => {
    const access = commands();
    const invalid = {
      ...terminationEnvelope(),
      signature: "A".repeat(86),
    };

    await expect(
      coordinator(access, {
        terminate: vi.fn(async () => invalid),
      }).setMode(trustedPlatformAdminContextFromServerIdentity(ADMIN_ID), {
        target_user_id: USER_ID,
        requested_developer_mode: true,
      }),
    ).rejects.toMatchObject({
      code: "access_trusted_context_required",
    });
    expect(
      access.completeDeveloperModeTransitionFromTrustedRuntime,
    ).not.toHaveBeenCalled();
  });

  it("completes an empty transition without issuing a runtime command", async () => {
    const access = commands({
      beginDeveloperModeTransition: vi.fn(async () => ({
        changed: true,
        user_id: USER_ID,
        access_generation: 2,
        runs_to_terminate: [],
        runtime_bindings_to_terminate: [],
      })),
      completeDeveloperModeTransitionFromTrustedRuntime: vi.fn(async () =>
        activeState(),
      ),
    });
    const terminate = vi.fn();

    await expect(
      coordinator(access, {
        terminate: terminate as RuntimeTerminator["terminate"],
      }).setMode(trustedPlatformAdminContextFromServerIdentity(ADMIN_ID), {
        target_user_id: USER_ID,
        requested_developer_mode: true,
      }),
    ).resolves.toMatchObject({ changed: true });
    expect(terminate).not.toHaveBeenCalled();
    expect(
      access.completeDeveloperModeTransitionFromTrustedRuntime,
    ).toHaveBeenCalledOnce();
  });
});
