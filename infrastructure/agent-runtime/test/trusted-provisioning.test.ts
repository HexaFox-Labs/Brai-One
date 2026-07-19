import { describe, expect, it, vi } from "vitest";

import { allocateEnvironment, OUTER_ID_RANGE_BASE } from "../src/allocation.js";
import {
  CANONICAL_IMAGE_PATH,
  CANONICAL_STORAGE_ROOT,
  provisionTrustedReservation,
  TRUSTED_RESERVATION_VERSION,
  TrustedProvisioningError,
  validateTrustedReservation,
  type TrustedEnvironmentReservation,
} from "../src/trusted-provisioning.js";

const IDS = {
  reservation: "10000000-0000-4000-8000-000000000001",
  user: "20000000-0000-4000-8000-000000000002",
  environment: "30000000-0000-4000-8000-000000000003",
} as const;

function reservation(
  overrides: Partial<TrustedEnvironmentReservation> = {},
): TrustedEnvironmentReservation {
  const allocation = allocateEnvironment({
    userId: IDS.user,
    slot: 0,
    policy: {
      storageRoot: CANONICAL_STORAGE_ROOT,
      outerIdRangeBase: OUTER_ID_RANGE_BASE,
      xfsProjectIdBase: 10_000,
    },
  });
  return {
    schema_version: TRUSTED_RESERVATION_VERSION,
    reservation_id: IDS.reservation,
    user_id: IDS.user,
    environment_id: IDS.environment,
    runtime_host_id: "brai-runtime-host-1",
    provision_generation: 1,
    access_generation: 1,
    allocation_slot: 0,
    environment_name: allocation.environmentName,
    outer_id_range_start: allocation.outerUidRange.start,
    outer_id_range_count: allocation.outerUidRange.count,
    image_brai_uid: allocation.imageBraiUid,
    image_brai_gid: allocation.imageBraiGid,
    inner_subuid_start: allocation.innerSubuidRange.start,
    inner_subgid_start: allocation.innerSubgidRange.start,
    inner_subid_count: allocation.innerSubuidRange.count,
    xfs_project_id: allocation.xfsProjectId,
    storage_path: allocation.dataPath,
    storage_mount_point: CANONICAL_STORAGE_ROOT,
    quota_bytes: allocation.quotaHardLimit.bytes,
    quota_inodes: allocation.quotaHardLimit.inodes,
    ...overrides,
  };
}

function rejectionCode(action: () => unknown): string {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof TrustedProvisioningError) return error.code;
    throw error;
  }
  throw new Error("Expected rejection.");
}

describe("trusted user-environment reservation", () => {
  it("accepts slot zero and derives every host value independently", () => {
    const validated = validateTrustedReservation(reservation());

    expect(validated.allocation).toMatchObject({
      slot: 0,
      environmentName: "brai-u-0",
      dataPath: "/srv/brai-user-data/brai-u-0",
      xfsProjectId: 10_000,
      imageBraiUid: OUTER_ID_RANGE_BASE + 1_000,
    });
  });

  it("rejects client-style extra fields and altered UID/path values", () => {
    expect(
      rejectionCode(() =>
        validateTrustedReservation({
          ...reservation(),
          profile: "developer",
        }),
      ),
    ).toBe("RESERVATION_SCHEMA_INVALID");
    expect(
      rejectionCode(() =>
        validateTrustedReservation(
          reservation({ image_brai_uid: OUTER_ID_RANGE_BASE + 1_001 }),
        ),
      ),
    ).toBe("RESERVATION_ALLOCATION_MISMATCH");
    expect(
      rejectionCode(() =>
        validateTrustedReservation(
          reservation({ storage_path: "/tmp/client-path" }),
        ),
      ),
    ).toBe("RESERVATION_ALLOCATION_MISMATCH");
  });

  it("provisions only derived values and emits a measured receipt", async () => {
    const validated = validateTrustedReservation(reservation());
    let environmentFile = "";
    const provisionQuota = vi.fn(async () => undefined);
    const receipt = await provisionTrustedReservation(
      validated.reservation,
      validated.allocation,
      {
        preflight: async () => undefined,
        provisionQuota,
        measureQuota: async (allocation) => ({
          dataPath: allocation.dataPath,
          storageDevice: "/dev/loop7",
          configuredProjectId: allocation.xfsProjectId,
          treeProjectId: allocation.xfsProjectId,
          projectInheritance: true,
          enforcementActive: true,
          byteHardLimit: allocation.quotaHardLimit.bytes,
          inodeHardLimit: allocation.quotaHardLimit.inodes,
        }),
        measureBindPath: async (allocation) => ({
          path: allocation.dataPath,
          ownerUid: allocation.imageBraiUid,
          ownerGid: allocation.imageBraiGid,
          mode: 0o700,
          directory: true,
          symbolicLink: false,
        }),
        verifyImage: async () => ({
          path: CANONICAL_IMAGE_PATH,
          sha256: "a".repeat(64),
          descriptorVerified: true,
        }),
        writeEnvironmentFile: async (_name, content) => {
          environmentFile = content;
        },
        now: () => new Date("2026-07-17T12:00:00.000Z"),
      },
    );

    expect(provisionQuota).toHaveBeenCalledExactlyOnceWith(
      validated.allocation,
    );
    expect(environmentFile).toContain(
      `BRAI_USERNS_START=${OUTER_ID_RANGE_BASE}`,
    );
    expect(environmentFile).toContain(
      "BRAI_USER_DATA=/srv/brai-user-data/brai-u-0",
    );
    expect(receipt).toMatchObject({
      schema_version: "brai.user-environment.provisioned.v1",
      reservation_id: IDS.reservation,
      provisioned_at: "2026-07-17T12:00:00.000Z",
      storage: {
        path: "/srv/brai-user-data/brai-u-0",
        device: "/dev/loop7",
        owner_uid: OUTER_ID_RANGE_BASE + 1_000,
        xfs_project_id: 10_000,
        quota_enforcement_active: true,
      },
    });
  });

  it("refuses to write a launch environment when image evidence is invalid", async () => {
    const validated = validateTrustedReservation(reservation());
    await expect(
      provisionTrustedReservation(validated.reservation, validated.allocation, {
        preflight: async () => undefined,
        provisionQuota: async () => undefined,
        measureQuota: async (allocation) => ({
          dataPath: allocation.dataPath,
          storageDevice: "/dev/loop7",
          configuredProjectId: allocation.xfsProjectId,
          treeProjectId: allocation.xfsProjectId,
          projectInheritance: true,
          enforcementActive: true,
          byteHardLimit: allocation.quotaHardLimit.bytes,
          inodeHardLimit: allocation.quotaHardLimit.inodes,
        }),
        measureBindPath: async (allocation) => ({
          path: allocation.dataPath,
          ownerUid: allocation.imageBraiUid,
          ownerGid: allocation.imageBraiGid,
          mode: 0o700,
          directory: true,
          symbolicLink: false,
        }),
        verifyImage: async () => ({
          path: "/tmp/client-image.raw",
          sha256: "invalid",
          descriptorVerified: true,
        }),
        writeEnvironmentFile: vi.fn(async () => undefined),
        now: () => new Date(),
      }),
    ).rejects.toMatchObject({
      code: "PROVISIONING_MEASUREMENT_MISMATCH",
    });
  });

  it("preserves the trusted preflight cause for root-only diagnostics", async () => {
    const validated = validateTrustedReservation(reservation());
    const cause = new Error("guest probe failed");
    await expect(
      provisionTrustedReservation(validated.reservation, validated.allocation, {
        preflight: async () => {
          throw cause;
        },
        provisionQuota: vi.fn(),
        measureQuota: vi.fn(),
        measureBindPath: vi.fn(),
        verifyImage: vi.fn(),
        writeEnvironmentFile: vi.fn(),
        now: () => new Date(),
      }),
    ).rejects.toMatchObject({
      code: "PROVISIONING_PREFLIGHT_FAILED",
      cause,
    });
  });
});
