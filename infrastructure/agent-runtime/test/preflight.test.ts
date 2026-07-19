import { describe, expect, it } from "vitest";
import type {
  DeveloperPreflightFacts,
  UserSandboxPreflightFacts,
} from "../src/model.js";
import {
  evaluateDeveloperPreflight,
  evaluateUserSandboxPreflight,
} from "../src/preflight.js";
import { canonicalHostIdPoolFacts } from "./host-id-pool.fixture.js";

function developerFacts(): DeveloperPreflightFacts {
  return {
    currentIdentity: { username: "mark", uid: 1_000, gid: 1_000 },
    markAccount: { username: "mark", uid: 1_000, gid: 1_000 },
    checkout: {
      path: "/srv/projects/brai-new",
      ownerUid: 1_000,
      ownerGid: 1_000,
      writable: true,
    },
    checkoutAudit: { completed: true, violations: [] },
    currentSupplementaryGids: [1_000, 27, 999],
    markInitgroupsGids: [27, 999, 1_000],
    umask: 0o077,
    sudoPolicy: {
      nonInteractiveListAvailable: true,
      nonInteractiveAll: true,
    },
  };
}

function sandboxFacts(): UserSandboxPreflightFacts {
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
      path: "/srv/brai-user-data/brai-u-3",
      canonicalPath: "/srv/brai-user-data/brai-u-3",
      exists: true,
      symbolicLink: false,
      directory: true,
      ownerUid: 20_042,
      ownerGid: 20_042,
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
    projectQuota: null,
  };
}

describe("developer preflight", () => {
  it("accepts exact mark identity and a clean full-tree audit", () => {
    expect(evaluateDeveloperPreflight(developerFacts())).toEqual({
      ok: true,
      profile: "developer",
    });
  });

  it("fails closed on nested root/nobody files and broken parity", () => {
    const facts = developerFacts();
    const result = evaluateDeveloperPreflight({
      ...facts,
      currentIdentity: { username: "root", uid: 0, gid: 0 },
      checkout: { ...facts.checkout, ownerUid: 0, writable: false },
      checkoutAudit: {
        completed: true,
        violations: [
          "foreign_owner:src/root.ts:0:0",
          "foreign_owner:src/nobody.ts:65534:65534",
        ],
      },
      currentSupplementaryGids: [1_000],
      umask: 0o700,
      sudoPolicy: {
        nonInteractiveListAvailable: true,
        nonInteractiveAll: false,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map(({ code }) => code)).toEqual([
      "DEVELOPER_RUNTIME_USER_NOT_MARK",
      "DEVELOPER_UID_MISMATCH",
      "DEVELOPER_GID_MISMATCH",
      "DEVELOPER_CHECKOUT_OWNER_MISMATCH",
      "DEVELOPER_CHECKOUT_NOT_WRITABLE",
      "DEVELOPER_SOURCE_TREE_POLICY_VIOLATION",
      "DEVELOPER_INITGROUPS_MISMATCH",
      "DEVELOPER_UMASK_INVALID",
      "DEVELOPER_SUDO_FULL_ACCESS_MISSING",
    ]);
  });
});

describe("user-sandbox preflight", () => {
  it("accepts the canonical one-disk sparse XFS pool plus a digest-bound guest probe", () => {
    expect(evaluateUserSandboxPreflight(sandboxFacts())).toEqual({
      ok: true,
      profile: "user-sandbox",
    });
  });

  it("rejects a per-user/direct-device pool and an untrusted or unbounded backing file", () => {
    const facts = sandboxFacts();
    const result = evaluateUserSandboxPreflight({
      ...facts,
      storagePath: "/srv/brai-user-data/user-42.img",
      storagePathCanonicalPath: "/srv/brai-user-data/user-42.img",
      logicalCeilingConfigurationTrusted: false,
      configuredLogicalCeilingBytes: Number.POSITIVE_INFINITY,
      storageMount: {
        ...facts.storageMount!,
        mountPoint: "/srv/brai-user-data/user-42.img",
        source: "/dev/sdb1",
      },
      loopBackingFilePath: "/srv/brai-storage/user-42.xfs",
      backingFile: {
        ...facts.backingFile,
        path: "/srv/brai-storage/user-42.xfs",
        canonicalPath: "/srv/brai-storage/user-42.xfs",
        ownerUid: 1_000,
        mode: 0o660,
        openedWithNoFollow: false,
        parentChainTrusted: false,
        allocatedBytes: 13_000_000_000,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "SANDBOX_STORAGE_PATH_NOT_CANONICAL",
        "SANDBOX_STORAGE_MOUNTPOINT_MISMATCH",
        "SANDBOX_STORAGE_LOOP_SOURCE_INVALID",
        "SANDBOX_STORAGE_LOOP_BACKING_MISMATCH",
        "SANDBOX_STORAGE_BACKING_PATH_INVALID",
        "SANDBOX_STORAGE_BACKING_NOT_ROOT_OWNED",
        "SANDBOX_STORAGE_BACKING_MODE_INVALID",
        "SANDBOX_STORAGE_BACKING_DESCRIPTOR_UNVERIFIED",
        "SANDBOX_STORAGE_BACKING_PARENT_CHAIN_UNTRUSTED",
        "SANDBOX_STORAGE_LOGICAL_CEILING_CONFIG_UNTRUSTED",
        "SANDBOX_STORAGE_LOGICAL_CEILING_INVALID",
        "SANDBOX_STORAGE_SPARSE_ALLOCATION_INVALID",
      ]),
    );
  });

  it("fails launch when either the outer ext4 host or inner XFS pool is low", () => {
    const facts = sandboxFacts();
    const result = evaluateUserSandboxPreflight({
      ...facts,
      storageAvailableBytes: 1_199_999_999,
      outerStorageAvailableBytes: 9_999_999_999,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "SANDBOX_STORAGE_INNER_GATE_FREE_SPACE_LOW",
        "SANDBOX_STORAGE_OUTER_GATE_FREE_SPACE_LOW",
      ]),
    );
  });

  it("rejects sparse growth that could consume the outer ext4 safety floor", () => {
    const facts = sandboxFacts();
    const result = evaluateUserSandboxPreflight({
      ...facts,
      configuredLogicalCeilingBytes: 50_000_000_000,
      backingFile: {
        ...facts.backingFile,
        logicalBytes: 50_000_000_000,
        allocatedBytes: 67_108_864,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map(({ code }) => code)).toContain(
      "SANDBOX_STORAGE_OUTER_HEADROOM_INSUFFICIENT",
    );
  });

  it("rejects invalid host storage, mutable image and invalid guest", () => {
    const facts = sandboxFacts();
    const guest = facts.guestRuntime!;
    const result = evaluateUserSandboxPreflight({
      ...facts,
      storageMount: {
        mountPoint: "/srv/brai-user-data",
        device: "8:1",
        source: "/dev/sda1",
        fsType: "ext4",
        options: ["rw"],
      },
      storageAvailableBytes: 99_999,
      guestRuntime: {
        ...guest,
        executables: { ...guest.executables, rootlesskit: false },
        subuidRanges: [{ start: 2_000_000, count: 65_535 }],
        newuidmap: { exists: true, ownerUid: 1_000, mode: 0o755 },
      },
      image: {
        ...facts.image,
        ownerUid: 1_000,
        mode: 0o666,
        digestVerified: false,
        insideUserStorage: true,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map(({ code }) => code)).toEqual([
      "SANDBOX_STORAGE_FS_NOT_XFS",
      "SANDBOX_STORAGE_PROJECT_QUOTA_DISABLED",
      "SANDBOX_STORAGE_LOOP_SOURCE_INVALID",
      "SANDBOX_STORAGE_INNER_GATE_FREE_SPACE_LOW",
      "SANDBOX_IMAGE_NOT_ROOT_OWNED",
      "SANDBOX_IMAGE_WRITABLE_BY_NON_ROOT",
      "SANDBOX_IMAGE_DIGEST_UNVERIFIED",
      "SANDBOX_IMAGE_INSIDE_USER_STORAGE",
      "SANDBOX_GUEST_ROOTLESSKIT_MISSING",
      "SANDBOX_GUEST_NEWUIDMAP_NOT_SETUID_ROOT",
      "SANDBOX_GUEST_SUBUID_RANGE_INVALID",
    ]);
  });

  it("fails closed when the digest-bound guest probe is absent", () => {
    const result = evaluateUserSandboxPreflight({
      ...sandboxFacts(),
      guestRuntime: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map(({ code }) => code)).toContain(
      "SANDBOX_GUEST_RUNTIME_PROBE_MISSING",
    );
  });

  it("rejects a symlink/non-directory bind without owner rwx", () => {
    const facts = sandboxFacts();
    const result = evaluateUserSandboxPreflight({
      ...facts,
      bindPath: {
        ...facts.bindPath,
        canonicalPath: "/srv/brai-user-data/other",
        symbolicLink: true,
        directory: false,
        mode: 0o500,
        effectiveOwnerAccess: false,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "SANDBOX_BIND_PATH_SYMLINK",
        "SANDBOX_BIND_PATH_NOT_CANONICAL",
        "SANDBOX_BIND_PATH_NOT_DIRECTORY",
        "SANDBOX_BIND_PATH_OWNER_ACCESS_MISSING",
      ]),
    );
  });

  it("rejects a numeric bind owner that is an existing host principal", () => {
    const facts = sandboxFacts();
    const result = evaluateUserSandboxPreflight({
      ...facts,
      hostAccountUids: [...facts.hostAccountUids, facts.bindPath.ownerUid!],
      hostGroupGids: [...facts.hostGroupGids, facts.bindPath.ownerGid!],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "SANDBOX_BIND_OWNER_UID_COLLIDES_WITH_HOST_ACCOUNT",
        "SANDBOX_BIND_OWNER_GID_COLLIDES_WITH_HOST_GROUP",
      ]),
    );
  });

  it("rejects missing reservations and host IDs inside the canonical pool", () => {
    const facts = sandboxFacts();
    const result = evaluateUserSandboxPreflight({
      ...facts,
      hostIdPool: {
        ...facts.hostIdPool,
        passwdEntries: [
          ...facts.hostIdPool.passwdEntries,
          {
            name: "future-user",
            uid: 1_879_048_193,
            gid: 1_000,
            home: "/home/future-user",
            shell: "/bin/bash",
          },
        ],
        subgidEntries: facts.hostIdPool.subgidEntries.filter(
          ({ owner }) => owner !== "brai-sandbox-map",
        ),
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "SANDBOX_HOST_ID_POOL_COLLISION",
        "SANDBOX_HOST_ID_POOL_RESERVATION_INVALID",
      ]),
    );
  });

  it("rejects an immutable-image symlink", () => {
    const facts = sandboxFacts();
    const result = evaluateUserSandboxPreflight({
      ...facts,
      image: {
        ...facts.image,
        symbolicLink: true,
        regularFile: false,
        openedWithNoFollow: false,
        sha256: null,
        digestVerified: false,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map(({ code }) => code)).toContain(
      "SANDBOX_IMAGE_SYMLINK",
    );
  });

  it("rejects an image opened through an untrusted path or sidecar", () => {
    const facts = sandboxFacts();
    const result = evaluateUserSandboxPreflight({
      ...facts,
      image: {
        ...facts.image,
        openedWithNoFollow: false,
        parentChainTrusted: false,
        sidecarTrusted: false,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "SANDBOX_IMAGE_DESCRIPTOR_UNVERIFIED",
        "SANDBOX_IMAGE_PARENT_CHAIN_UNTRUSTED",
        "SANDBOX_IMAGE_SIDECAR_UNTRUSTED",
      ]),
    );
  });

  it("does not report a low-space gate error when storage is absent", () => {
    const facts = sandboxFacts();
    const result = evaluateUserSandboxPreflight({
      ...facts,
      storagePathExists: false,
      storageMount: null,
      storageTotalBytes: 0,
      storageAvailableBytes: 0,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map(({ code }) => code)).toContain(
      "SANDBOX_STORAGE_PATH_MISSING",
    );
    expect(result.failures.map(({ code }) => code)).not.toContain(
      "SANDBOX_STORAGE_INNER_GATE_FREE_SPACE_LOW",
    );
  });
});
