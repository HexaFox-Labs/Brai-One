import { generateKeyPairSync, sign } from "node:crypto";

import { type SignedTrustedReceiptEnvelope } from "@brai/contracts";
import { describe, expect, it, vi } from "vitest";

import { allocationReservationForSlot } from "../src/allocation-policy.js";
import {
  Ed25519EnvironmentProvisionContractIssuer,
  EnvironmentProvisioningCoordinator,
  type EnvironmentProvisionDispatcher,
  type EnvironmentProvisioningCommands,
} from "../src/environment-provisioning-coordinator.js";
import { trustedReceiptEnvelopeSigningBytes } from "../src/signed-receipts.js";
import type { EnvironmentProvisioning, UserEnvironment } from "../src/types.js";

const USER_ID = "1f88bde1-2b49-46cb-914d-7500afdf82d6";
const ENVIRONMENT_ID = "2f88bde1-2b49-46cb-914d-7500afdf82d6";
const RESERVATION_ID = "3f88bde1-2b49-46cb-914d-7500afdf82d6";
const RECEIPT_KEY_ID = "runtime-receipt:test";
const LAUNCH_KEY_ID = "access-launch:test";
const NOW = new Date("2026-07-17T12:00:00.000Z");
const QUOTA = { bytes: 5_368_709_120, inodes: 500_000 } as const;
const allocation = allocationReservationForSlot(0);
const launchKeys = generateKeyPairSync("ed25519");
const receiptKeys = generateKeyPairSync("ed25519");

function provisioning(): EnvironmentProvisioning {
  return {
    access_generation: 1,
    environment: {
      userId: USER_ID,
      environmentId: ENVIRONMENT_ID,
      status: "provisioning",
      provisionGeneration: 1,
      provisionAccessGeneration: 1,
      quota: QUOTA,
      enforcedQuota: null,
      allocationSlot: allocation.allocationSlot,
      environmentName: allocation.environmentName,
      outerIdRangeStart: allocation.outerIdRangeStart,
      outerIdRangeCount: allocation.outerIdRangeCount,
      unixUid: allocation.unixUid,
      unixGid: allocation.unixGid,
      subuidStart: allocation.subuidStart,
      subgidStart: allocation.subgidStart,
      subidCount: allocation.subidCount,
      quotaProjectId: allocation.quotaProjectId,
      storagePath: allocation.storagePath,
      storageMountPoint: allocation.storageMountPoint,
      storageDevice: null,
      projectInheritance: null,
      quotaEnforcementActive: null,
      imagePath: null,
      imageSha256: null,
      hostProvisionedAt: null,
    },
  };
}

function readyEnvironment(): UserEnvironment {
  return {
    ...provisioning().environment,
    status: "ready",
    enforcedQuota: QUOTA,
    storageDevice: "/dev/loop42",
    projectInheritance: true,
    quotaEnforcementActive: true,
    imagePath: "/srv/opt/brai-agent-runtime/images/user-sandbox-v1.raw",
    imageSha256: "a".repeat(64),
    hostProvisionedAt: NOW.toISOString(),
  };
}

function signedReceipt(): SignedTrustedReceiptEnvelope {
  const unsigned = {
    version: 1,
    purpose: "environment-provision-v1",
    key_id: RECEIPT_KEY_ID,
    payload: JSON.stringify({
      environmentId: ENVIRONMENT_ID,
      provisionGeneration: 1,
      allocationSlot: allocation.allocationSlot,
      receipt: {
        version: 1,
        profile: "user-sandbox",
        userId: USER_ID,
        accessGeneration: 1,
        provisionedAt: NOW.toISOString(),
        runtime: {
          environmentName: allocation.environmentName,
          outerIdRangeStart: allocation.outerIdRangeStart,
          outerIdRangeCount: allocation.outerIdRangeCount,
          imageBraiUid: allocation.unixUid,
          imageBraiGid: allocation.unixGid,
          guestInnerSubuidStart: 65_536,
          guestInnerSubgidStart: 65_536,
          effectiveHostInnerSubuidStart: allocation.subuidStart,
          effectiveHostInnerSubgidStart: allocation.subgidStart,
          innerSubidCount: allocation.subidCount,
        },
        image: {
          path: "/srv/opt/brai-agent-runtime/images/user-sandbox-v1.raw",
          sha256: "a".repeat(64),
        },
        storage: {
          mountPoint: allocation.storageMountPoint,
          device: "/dev/loop42",
          dataPath: allocation.storagePath,
          xfsProjectId: allocation.quotaProjectId,
          hardLimitBytes: QUOTA.bytes,
          hardLimitInodes: QUOTA.inodes,
          projectInheritance: true,
          quotaEnforcementActive: true,
        },
      },
    }),
  } as const;
  return {
    ...unsigned,
    signature: sign(
      null,
      trustedReceiptEnvelopeSigningBytes(unsigned),
      receiptKeys.privateKey,
    ).toString("base64url"),
  };
}

function commands(): EnvironmentProvisioningCommands {
  return {
    beginEnvironmentProvisioningFromTrustedHost: vi.fn(async () =>
      provisioning(),
    ),
    completeEnvironmentProvisioningFromTrustedHost: vi.fn(
      async (_context, receipt) => {
        expect(receipt).toMatchObject({
          userId: USER_ID,
          environmentId: ENVIRONMENT_ID,
          provisionGeneration: 1,
          quotaBytes: QUOTA.bytes,
        });
        return readyEnvironment();
      },
    ),
  };
}

function issuer() {
  return new Ed25519EnvironmentProvisionContractIssuer({
    keyId: LAUNCH_KEY_ID,
    privateKey: launchKeys.privateKey,
    lifetimeMs: 120_000,
    now: () => NOW,
    generateId: () => RESERVATION_ID,
  });
}

function coordinator(
  access: EnvironmentProvisioningCommands,
  dispatcher: EnvironmentProvisionDispatcher,
) {
  return new EnvironmentProvisioningCoordinator(
    access,
    issuer(),
    dispatcher,
    (keyId) => (keyId === RECEIPT_KEY_ID ? receiptKeys.publicKey : undefined),
  );
}

describe("EnvironmentProvisioningCoordinator", () => {
  it("signs only the durable DB reservation and activates only a measured signed receipt", async () => {
    const access = commands();
    const dispatch = vi.fn(async (contract) => {
      expect(contract).toMatchObject({
        reservation_id: RESERVATION_ID,
        user_id: USER_ID,
        environment_id: ENVIRONMENT_ID,
        allocation_slot: 0,
        environment_name: allocation.environmentName,
        outer_id_range_start: allocation.outerIdRangeStart,
        xfs_project_id: allocation.quotaProjectId,
        quota_bytes: QUOTA.bytes,
        key_id: LAUNCH_KEY_ID,
      });
      expect(contract.signature).toMatch(/^[A-Za-z0-9_-]{86}$/u);
      return signedReceipt();
    });

    await expect(
      coordinator(access, { dispatch }).ensureReady(USER_ID),
    ).resolves.toBeUndefined();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(
      access.completeEnvironmentProvisioningFromTrustedHost,
    ).toHaveBeenCalledOnce();
  });

  it("coalesces parallel first launches for one persistent user environment", async () => {
    const access = commands();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatch = vi.fn(async () => {
      await gate;
      return signedReceipt();
    });
    const service = coordinator(access, { dispatch });

    const first = service.ensureReady(USER_ID);
    const second = service.ensureReady(USER_ID);
    expect(second).toBe(first);
    release();
    await Promise.all([first, second]);
    expect(
      access.beginEnvironmentProvisioningFromTrustedHost,
    ).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("rejects a forged host receipt before the ready-state CAS", async () => {
    const access = commands();
    const forged = {
      ...signedReceipt(),
      signature: "A".repeat(86),
    };

    await expect(
      coordinator(access, {
        dispatch: vi.fn(async () => forged),
      }).ensureReady(USER_ID),
    ).rejects.toMatchObject({
      code: "access_trusted_context_required",
    });
    expect(
      access.completeEnvironmentProvisioningFromTrustedHost,
    ).not.toHaveBeenCalled();
  });
});
