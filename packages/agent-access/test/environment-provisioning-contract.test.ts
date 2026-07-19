import { generateKeyPairSync } from "node:crypto";

import {
  BRAI_SANDBOX_ID_POOL_START,
  type EnvironmentProvisionReservation,
} from "@brai/contracts";
import { describe, expect, it } from "vitest";

import {
  issueEnvironmentProvisionContract,
  verifyEnvironmentProvisionContract,
} from "../src/environment-provisioning-contract.js";

const keys = generateKeyPairSync("ed25519");
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
  outer_id_range_start: BRAI_SANDBOX_ID_POOL_START,
  outer_id_range_count: 131_072,
  image_brai_uid: BRAI_SANDBOX_ID_POOL_START + 1_000,
  image_brai_gid: BRAI_SANDBOX_ID_POOL_START + 1_000,
  inner_subuid_start: BRAI_SANDBOX_ID_POOL_START + 65_536,
  inner_subgid_start: BRAI_SANDBOX_ID_POOL_START + 65_536,
  inner_subid_count: 65_536,
  xfs_project_id: 10_000,
  storage_path: "/srv/brai-user-data/brai-u-0",
  storage_mount_point: "/srv/brai-user-data",
  quota_bytes: 5_368_709_120,
  quota_inodes: 500_000,
};

describe("environment provisioning contract", () => {
  it("signs and verifies the exact server-side reservation", () => {
    const contract = issueEnvironmentProvisionContract({
      reservation,
      issuedAt: new Date("2026-07-17T12:00:00.000Z"),
      expiresAt: new Date("2026-07-17T12:05:00.000Z"),
      keyId: "access-2026-07",
      privateKey: keys.privateKey,
    });
    expect(
      verifyEnvironmentProvisionContract(contract, {
        now: new Date("2026-07-17T12:01:00.000Z"),
        resolvePublicKey: () => keys.publicKey,
      }),
    ).toEqual(contract);
  });

  it("rejects a signed contract after any allocation field is changed", () => {
    const contract = issueEnvironmentProvisionContract({
      reservation,
      issuedAt: new Date("2026-07-17T12:00:00.000Z"),
      expiresAt: new Date("2026-07-17T12:05:00.000Z"),
      keyId: "access-2026-07",
      privateKey: keys.privateKey,
    });
    expect(() =>
      verifyEnvironmentProvisionContract(
        { ...contract, quota_inodes: contract.quota_inodes + 1 },
        {
          now: new Date("2026-07-17T12:01:00.000Z"),
          resolvePublicKey: () => keys.publicKey,
        },
      ),
    ).toThrow(/signature/u);
  });
});
