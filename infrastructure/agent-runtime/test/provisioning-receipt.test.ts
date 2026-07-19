import { describe, expect, it } from "vitest";
import {
  allocateEnvironment,
  type EnvironmentAllocation,
  type EnvironmentAllocationPolicy,
} from "../src/allocation.js";
import type { UserSandboxPreflightFacts } from "../src/model.js";
import { evaluateUserSandboxPreflight } from "../src/preflight.js";
import {
  createProvisioningReceipt,
  ProvisioningReceiptRejectedError,
} from "../src/provisioning-receipt.js";
import { canonicalHostIdPoolFacts } from "./host-id-pool.fixture.js";

const policy: EnvironmentAllocationPolicy = {
  storageRoot: "/srv/brai-user-data",
  outerIdRangeBase: 1_879_048_192,
  xfsProjectIdBase: 10_000,
};

function allocation(): EnvironmentAllocation {
  return allocateEnvironment({ userId: "user-42", slot: 3, policy });
}

function facts(target: EnvironmentAllocation): UserSandboxPreflightFacts {
  return {
    storagePath: "/srv/brai-user-data",
    storagePathCanonicalPath: "/srv/brai-user-data",
    storagePathExists: true,
    logicalCeilingConfigurationPath:
      "/etc/brai-agent-runtime/storage-ceiling-bytes",
    logicalCeilingConfigurationTrusted: true,
    configuredLogicalCeilingBytes: 12_884_901_888,
    backingFile: {
      path: "/srv/brai-storage/user-data.xfs",
      canonicalPath: "/srv/brai-storage/user-data.xfs",
      exists: true,
      regularFile: true,
      symbolicLink: false,
      ownerUid: 0,
      ownerGid: 0,
      mode: 0o600,
      openedWithNoFollow: true,
      parentChainTrusted: true,
      logicalBytes: 12_884_901_888,
      allocatedBytes: 67_108_864,
    },
    backingMount: {
      mountPoint: "/",
      device: "8:1",
      source: "/dev/sda1",
      fsType: "ext4",
      options: ["rw"],
    },
    loopBackingFilePath: "/srv/brai-storage/user-data.xfs",
    backingFileLoopDeviceCount: 1,
    rootMount: {
      mountPoint: "/",
      device: "8:1",
      source: "/dev/sda1",
      fsType: "ext4",
      options: ["rw"],
    },
    storageMount: {
      mountPoint: "/srv/brai-user-data",
      device: "8:17",
      source: "/dev/loop0",
      fsType: "xfs",
      options: ["rw", "prjquota"],
    },
    storageTotalBytes: 12_000_000_000,
    storageAvailableBytes: 3_000_000_000,
    outerStorageTotalBytes: 100_000_000_000,
    outerStorageAvailableBytes: 50_000_000_000,
    storageFstrimAvailable: true,
    storageTrimTimerActive: true,
    systemdNspawnAvailable: true,
    hostPrincipalScanCompleted: true,
    hostAccountUids: [0, 1_000],
    hostGroupGids: [0, 1_000],
    hostIdPool: canonicalHostIdPoolFacts(),
    bindPath: {
      path: target.dataPath,
      canonicalPath: target.dataPath,
      exists: true,
      symbolicLink: false,
      directory: true,
      ownerUid: target.imageBraiUid,
      ownerGid: target.imageBraiGid,
      mode: 0o700,
      effectiveOwnerAccess: true,
    },
    image: {
      path: "/srv/opt/brai-agent-runtime/images/user-sandbox-v1.raw",
      exists: true,
      regularFile: true,
      symbolicLink: false,
      ownerUid: 0,
      ownerGid: 0,
      mode: 0o644,
      openedWithNoFollow: true,
      parentChainTrusted: true,
      sidecarTrusted: true,
      sha256: "a".repeat(64),
      digestVerified: true,
      insideUserStorage: false,
    },
    guestRuntime: {
      imageSha256: "a".repeat(64),
      braiAccount: { username: "brai", uid: 1_000, gid: 1_000 },
      executables: {
        "dockerd-rootless.sh": true,
        rootlesskit: true,
        slirp4netns: true,
        "fuse-overlayfs": true,
        newuidmap: true,
        newgidmap: true,
      },
      networkDriver: "slirp4netns",
      storageDriver: "fuse-overlayfs",
      subuidRanges: [{ start: 65_536, count: 65_536 }],
      subgidRanges: [{ start: 65_536, count: 65_536 }],
      newuidmap: { exists: true, ownerUid: 0, mode: 0o4755 },
      newgidmap: { exists: true, ownerUid: 0, mode: 0o4755 },
    },
    projectQuota: {
      dataPath: target.dataPath,
      configuredProjectId: target.xfsProjectId,
      treeProjectId: target.xfsProjectId,
      projectInheritance: true,
      enforcementActive: true,
      byteHardLimit: target.quotaHardLimit.bytes,
      inodeHardLimit: target.quotaHardLimit.inodes,
    },
  };
}

function rejectionCode(action: () => unknown): string {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof ProvisioningReceiptRejectedError) return error.code;
    throw error;
  }
  throw new Error("Expected provisioning to be rejected.");
}

function create(
  target: EnvironmentAllocation,
  hostFacts: UserSandboxPreflightFacts,
) {
  return createProvisioningReceipt(
    {
      allocation: target,
      allocationRegistry: [target],
      allocationPolicy: policy,
      facts: hostFacts,
      persistedQuota: target.quotaHardLimit,
      accessGeneration: 7,
    },
    {
      runPreflight: evaluateUserSandboxPreflight,
      now: () => new Date("2026-07-17T02:30:00.000Z"),
    },
  );
}

describe("provisioning receipt", () => {
  it("records verified guest-relative/host-effective IDs and enforced quota", () => {
    const target = allocation();
    const receipt = create(target, facts(target));

    expect(receipt).toMatchObject({
      version: 1,
      profile: "user-sandbox",
      userId: "user-42",
      accessGeneration: 7,
      provisionedAt: "2026-07-17T02:30:00.000Z",
      runtime: {
        guestInnerSubuidStart: 65_536,
        guestInnerSubgidStart: 65_536,
        effectiveHostInnerSubuidStart: target.outerUidRange.start + 65_536,
        effectiveHostInnerSubgidStart: target.outerGidRange.start + 65_536,
      },
      image: { sha256: "a".repeat(64) },
      storage: {
        device: "8:17",
        xfsProjectId: 10_003,
        hardLimitBytes: 5 * 1_024 * 1_024 * 1_024,
        hardLimitInodes: 500_000,
        projectInheritance: true,
        quotaEnforcementActive: true,
      },
    });
    expect(receipt.runtime.outerIdRangeCount).toBe(131_072);
  });

  it("refuses a receipt when the injected guest preflight fails", () => {
    const target = allocation();
    const hostFacts = facts(target);
    const guest = hostFacts.guestRuntime!;
    expect(
      rejectionCode(() =>
        create(target, {
          ...hostFacts,
          guestRuntime: {
            ...guest,
            executables: { ...guest.executables, rootlesskit: false },
          },
        }),
      ),
    ).toBe("PROVISIONING_PREFLIGHT_FAILED");
  });

  it("refuses a numeric bind owner that differs from the exact allocation", () => {
    const target = allocation();
    const hostFacts = facts(target);
    expect(
      rejectionCode(() =>
        create(target, {
          ...hostFacts,
          bindPath: {
            ...hostFacts.bindPath,
            ownerUid: target.imageBraiUid + 1,
            ownerGid: target.imageBraiGid + 1,
          },
        }),
      ),
    ).toBe("PROVISIONING_BIND_PATH_MISMATCH");
  });

  it("rechecks the bind path even if an injected preflight adapter lies", () => {
    const target = allocation();
    const hostFacts = facts(target);
    expect(
      rejectionCode(() =>
        createProvisioningReceipt(
          {
            allocation: target,
            allocationRegistry: [target],
            allocationPolicy: policy,
            facts: {
              ...hostFacts,
              bindPath: {
                ...hostFacts.bindPath,
                symbolicLink: true,
                mode: 0o500,
                effectiveOwnerAccess: false,
              },
            },
            persistedQuota: target.quotaHardLimit,
            accessGeneration: 7,
          },
          {
            runPreflight: () => ({ ok: true, profile: "user-sandbox" }),
            now: () => new Date(),
          },
        ),
      ),
    ).toBe("PROVISIONING_BIND_PATH_MISMATCH");
  });

  it("binds the enforced quota to the user's persisted quota state", () => {
    const target = allocation();
    expect(
      rejectionCode(() =>
        createProvisioningReceipt(
          {
            allocation: target,
            allocationRegistry: [target],
            allocationPolicy: policy,
            facts: facts(target),
            persistedQuota: {
              bytes: target.quotaHardLimit.bytes + 1,
              inodes: target.quotaHardLimit.inodes,
            },
            accessGeneration: 7,
          },
          {
            runPreflight: evaluateUserSandboxPreflight,
            now: () => new Date(),
          },
        ),
      ),
    ).toBe("PROVISIONING_QUOTA_STATE_MISMATCH");
  });

  it("rejects a host principal anywhere in the full allocated ID window", () => {
    const target = allocation();
    const hostFacts = facts(target);
    expect(
      rejectionCode(() =>
        createProvisioningReceipt(
          {
            allocation: target,
            allocationRegistry: [target],
            allocationPolicy: policy,
            facts: {
              ...hostFacts,
              hostAccountUids: [
                ...hostFacts.hostAccountUids,
                target.outerUidRange.start + 42,
              ],
            },
            persistedQuota: target.quotaHardLimit,
            accessGeneration: 7,
          },
          {
            runPreflight: evaluateUserSandboxPreflight,
            now: () => new Date(),
          },
        ),
      ),
    ).toBe("PROVISIONING_HOST_ID_RANGE_COLLISION");
  });

  it("refuses duplicate project IDs in the allocation registry", () => {
    const target = allocation();
    const peer = allocateEnvironment({ userId: "user-peer", slot: 4, policy });
    const invalidPeer = { ...peer, xfsProjectId: target.xfsProjectId };
    expect(
      rejectionCode(() =>
        createProvisioningReceipt(
          {
            allocation: target,
            allocationRegistry: [target, invalidPeer],
            allocationPolicy: policy,
            facts: facts(target),
            persistedQuota: target.quotaHardLimit,
            accessGeneration: 7,
          },
          {
            runPreflight: evaluateUserSandboxPreflight,
            now: () => new Date(),
          },
        ),
      ),
    ).toBe("PROVISIONING_ALLOCATION_REGISTRY_INVALID");
  });

  it.each([
    [
      "missing quota facts",
      (hostFacts: UserSandboxPreflightFacts) => ({
        ...hostFacts,
        projectQuota: null,
      }),
      "PROVISIONING_XFS_QUOTA_FACTS_MISSING",
    ],
    [
      "wrong project tree",
      (hostFacts: UserSandboxPreflightFacts) => ({
        ...hostFacts,
        projectQuota: {
          ...hostFacts.projectQuota!,
          treeProjectId: hostFacts.projectQuota!.treeProjectId + 1,
        },
      }),
      "PROVISIONING_XFS_PROJECT_TREE_MISMATCH",
    ],
    [
      "disabled project inheritance",
      (hostFacts: UserSandboxPreflightFacts) => ({
        ...hostFacts,
        projectQuota: {
          ...hostFacts.projectQuota!,
          projectInheritance: false,
        },
      }),
      "PROVISIONING_XFS_PROJECT_INHERIT_DISABLED",
    ],
    [
      "inactive enforcement",
      (hostFacts: UserSandboxPreflightFacts) => ({
        ...hostFacts,
        projectQuota: {
          ...hostFacts.projectQuota!,
          enforcementActive: false,
        },
      }),
      "PROVISIONING_XFS_QUOTA_ENFORCEMENT_INACTIVE",
    ],
    [
      "wrong hard limits",
      (hostFacts: UserSandboxPreflightFacts) => ({
        ...hostFacts,
        projectQuota: {
          ...hostFacts.projectQuota!,
          byteHardLimit: hostFacts.projectQuota!.byteHardLimit - 1,
        },
      }),
      "PROVISIONING_XFS_HARD_LIMIT_MISMATCH",
    ],
  ] as const)("refuses %s", (_name, mutate, code) => {
    const target = allocation();
    expect(rejectionCode(() => create(target, mutate(facts(target))))).toBe(
      code,
    );
  });

  it("refuses a passing preflight for a different storage pool", () => {
    const target = allocation();
    const hostFacts = facts(target);
    expect(
      rejectionCode(() =>
        createProvisioningReceipt(
          {
            allocation: target,
            allocationRegistry: [target],
            allocationPolicy: policy,
            facts: {
              ...hostFacts,
              storagePath: "/srv/other-xfs",
              storageMount: {
                ...hostFacts.storageMount!,
                mountPoint: "/srv/other-xfs",
              },
            },
            persistedQuota: target.quotaHardLimit,
            accessGeneration: 7,
          },
          {
            runPreflight: () => ({
              ok: true,
              profile: "user-sandbox",
            }),
            now: () => new Date("2026-07-17T02:30:00.000Z"),
          },
        ),
      ),
    ).toBe("PROVISIONING_STORAGE_ALLOCATION_MISMATCH");
  });

  it("independently rejects host ID pool drift even if preflight lies", () => {
    const target = allocation();
    const hostFacts = facts(target);
    expect(
      rejectionCode(() =>
        createProvisioningReceipt(
          {
            allocation: target,
            allocationRegistry: [target],
            allocationPolicy: policy,
            facts: {
              ...hostFacts,
              hostIdPool: {
                ...hostFacts.hostIdPool,
                subuidEntries: [],
              },
            },
            persistedQuota: target.quotaHardLimit,
            accessGeneration: 7,
          },
          {
            runPreflight: () => ({ ok: true, profile: "user-sandbox" }),
            now: () => new Date(),
          },
        ),
      ),
    ).toBe("PROVISIONING_HOST_ID_POOL_INVALID");
  });
});
