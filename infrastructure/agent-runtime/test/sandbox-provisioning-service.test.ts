import { generateKeyPairSync, verify } from "node:crypto";

import {
  issueEnvironmentProvisionContract,
  trustedReceiptEnvelopeSigningBytes,
} from "@brai/agent-access";
import {
  RUNTIME_USER_ENVIRONMENT_PROVISION_REQUEST_SCHEMA_VERSION,
  environmentProvisionReceiptPayloadSchema,
  type EnvironmentProvisionReservation,
} from "@brai/contracts";
import { describe, expect, it, vi } from "vitest";

import { SandboxProvisioningHostService } from "../src/sandbox-provisioning-service.js";
import type { TrustedProvisioningReceipt } from "../src/trusted-provisioning.js";

const launchKeys = generateKeyPairSync("ed25519");
const receiptKeys = generateKeyPairSync("ed25519");
const NOW = new Date("2026-07-17T12:01:00.000Z");

const reservation: EnvironmentProvisionReservation = {
  schema_version: "brai.user-environment.reservation.v1",
  reservation_id: "10000000-0000-4000-8000-000000000001",
  user_id: "20000000-0000-4000-8000-000000000002",
  environment_id: "30000000-0000-4000-8000-000000000003",
  runtime_host_id: "brai-runtime-host-1",
  provision_generation: 1,
  access_generation: 1,
  allocation_slot: 0,
  environment_name: "brai-u-0",
  outer_id_range_start: 1_879_048_192,
  outer_id_range_count: 131_072,
  image_brai_uid: 1_879_049_192,
  image_brai_gid: 1_879_049_192,
  inner_subuid_start: 1_879_113_728,
  inner_subgid_start: 1_879_113_728,
  inner_subid_count: 65_536,
  xfs_project_id: 10_000,
  storage_path: "/srv/brai-user-data/brai-u-0",
  storage_mount_point: "/srv/brai-user-data",
  quota_bytes: 5_368_709_120,
  quota_inodes: 500_000,
};

const measured: TrustedProvisioningReceipt = {
  schema_version: "brai.user-environment.provisioned.v1",
  reservation_id: reservation.reservation_id,
  user_id: reservation.user_id,
  environment_id: reservation.environment_id,
  runtime_host_id: "brai-runtime-host-1",
  access_generation: 1,
  provisioned_at: NOW.toISOString(),
  allocation: {
    slot: 0,
    environment_name: "brai-u-0",
    outer_id_range_start: 1_879_048_192,
    outer_id_range_count: 131_072,
    image_brai_uid: 1_879_049_192,
    image_brai_gid: 1_879_049_192,
    inner_subuid_start: 1_879_113_728,
    inner_subgid_start: 1_879_113_728,
    inner_subid_count: 65_536,
  },
  image: {
    path: "/srv/opt/brai-agent-runtime/images/user-sandbox-v1.raw",
    sha256: "a".repeat(64),
    descriptorVerified: true,
  },
  storage: {
    mount_point: "/srv/brai-user-data",
    path: "/srv/brai-user-data/brai-u-0",
    device: "/dev/loop7",
    owner_uid: 1_879_049_192,
    owner_gid: 1_879_049_192,
    mode: 0o700,
    xfs_project_id: 10_000,
    hard_limit_bytes: 5_368_709_120,
    hard_limit_inodes: 500_000,
    project_inheritance: true,
    quota_enforcement_active: true,
  },
};

function request(contract: unknown) {
  return {
    schema_version: RUNTIME_USER_ENVIRONMENT_PROVISION_REQUEST_SCHEMA_VERSION,
    request_id: "40000000-0000-4000-8000-000000000004",
    sent_at: NOW.toISOString(),
    payload: { contract },
  };
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("sandbox provisioning host service", () => {
  it("verifies access reservation and returns a measured host-signed receipt", async () => {
    const provision = vi.fn(async () => measured);
    const service = new SandboxProvisioningHostService({
      executor: { provision },
      launchKeyId: "access-2026-07",
      launchPublicKey: launchKeys.publicKey,
      receiptKeyId: "runtime-2026-07",
      receiptPrivateKey: receiptKeys.privateKey,
      logger,
      now: () => NOW,
    });
    const contract = issueEnvironmentProvisionContract({
      reservation,
      issuedAt: new Date("2026-07-17T12:00:00.000Z"),
      expiresAt: new Date("2026-07-17T12:05:00.000Z"),
      keyId: "access-2026-07",
      privateKey: launchKeys.privateKey,
    });
    const response = await service.handleProvision(request(contract));
    expect(response.payload.accepted).toBe(true);
    if (!response.payload.accepted) return;
    expect(provision).toHaveBeenCalledExactlyOnceWith(reservation);
    const envelope = response.payload.provision_receipt;
    expect(
      verify(
        null,
        trustedReceiptEnvelopeSigningBytes({
          version: envelope.version,
          purpose: envelope.purpose,
          key_id: envelope.key_id,
          payload: envelope.payload,
        }),
        receiptKeys.publicKey,
        Buffer.from(envelope.signature, "base64url"),
      ),
    ).toBe(true);
    expect(
      environmentProvisionReceiptPayloadSchema.parse(
        JSON.parse(envelope.payload),
      ),
    ).toMatchObject({
      environmentId: reservation.environment_id,
      provisionGeneration: 1,
      allocationSlot: 0,
      receipt: {
        storage: {
          device: "/dev/loop7",
          quotaEnforcementActive: true,
        },
      },
    });
  });

  it("rejects a modified allocation before calling the host executor", async () => {
    const provision = vi.fn(async () => measured);
    const service = new SandboxProvisioningHostService({
      executor: { provision },
      launchKeyId: "access-2026-07",
      launchPublicKey: launchKeys.publicKey,
      receiptKeyId: "runtime-2026-07",
      receiptPrivateKey: receiptKeys.privateKey,
      logger,
      now: () => NOW,
    });
    const contract = issueEnvironmentProvisionContract({
      reservation,
      issuedAt: new Date("2026-07-17T12:00:00.000Z"),
      expiresAt: new Date("2026-07-17T12:05:00.000Z"),
      keyId: "access-2026-07",
      privateKey: launchKeys.privateKey,
    });
    const response = await service.handleProvision(
      request({ ...contract, quota_inodes: contract.quota_inodes + 1 }),
    );
    expect(response.payload).toMatchObject({
      accepted: false,
      code: "invalid_contract",
    });
    expect(provision).not.toHaveBeenCalled();
  });
});
