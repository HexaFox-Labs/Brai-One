import { resolve } from "node:path";
import { auditCanonicalHostIdPool } from "./host-id-pool.js";
import {
  GUEST_RUNTIME_EXECUTABLES,
  type DeveloperPreflightFacts,
  type GuestRuntimeExecutable,
  type PreflightErrorCode,
  type PreflightFailure,
  type PreflightResult,
  type SetuidHelperFacts,
  type SubordinateIdRange,
  type UserSandboxPreflightFacts,
} from "./model.js";
import {
  CANONICAL_SANDBOX_BACKING_PATH,
  CANONICAL_SANDBOX_STORAGE_PATH,
  CANONICAL_STORAGE_CEILING_PATH,
  MAXIMUM_SANDBOX_STORAGE_BYTES,
  MINIMUM_SANDBOX_STORAGE_BYTES,
} from "./storage-layout.js";

export const MINIMUM_STORAGE_GATE_FREE_FRACTION = 0.1;
export const GUEST_SUBORDINATE_ID_START = 65_536;
export const GUEST_SUBORDINATE_ID_COUNT = 65_536;

const guestExecutableFailureCodes: Readonly<
  Record<GuestRuntimeExecutable, PreflightErrorCode>
> = {
  "dockerd-rootless.sh": "SANDBOX_GUEST_ROOTLESS_DOCKER_MISSING",
  rootlesskit: "SANDBOX_GUEST_ROOTLESSKIT_MISSING",
  slirp4netns: "SANDBOX_GUEST_SLIRP4NETNS_MISSING",
  "fuse-overlayfs": "SANDBOX_GUEST_FUSE_OVERLAYFS_MISSING",
  newuidmap: "SANDBOX_GUEST_NEWUIDMAP_MISSING",
  newgidmap: "SANDBOX_GUEST_NEWGIDMAP_MISSING",
};

function failure(code: PreflightErrorCode, message: string): PreflightFailure {
  return { code, message };
}

export function evaluateDeveloperPreflight(
  facts: DeveloperPreflightFacts,
): PreflightResult {
  const failures: PreflightFailure[] = [];
  const mark = facts.markAccount;

  if (mark === null) {
    failures.push(
      failure(
        "DEVELOPER_MARK_ACCOUNT_MISSING",
        "The host account 'mark' does not exist.",
      ),
    );
  } else {
    if (facts.currentIdentity.username !== "mark") {
      failures.push(
        failure(
          "DEVELOPER_RUNTIME_USER_NOT_MARK",
          "Developer runtime must execute as the host account 'mark'.",
        ),
      );
    }
    if (facts.currentIdentity.uid !== mark.uid) {
      failures.push(
        failure(
          "DEVELOPER_UID_MISMATCH",
          `Developer runtime UID ${facts.currentIdentity.uid} does not match mark UID ${mark.uid}.`,
        ),
      );
    }
    if (facts.currentIdentity.gid !== mark.gid) {
      failures.push(
        failure(
          "DEVELOPER_GID_MISMATCH",
          `Developer runtime GID ${facts.currentIdentity.gid} does not match mark GID ${mark.gid}.`,
        ),
      );
    }
    if (
      facts.checkout.ownerUid !== mark.uid ||
      facts.checkout.ownerGid !== mark.gid
    ) {
      failures.push(
        failure(
          "DEVELOPER_CHECKOUT_OWNER_MISMATCH",
          `Checkout '${facts.checkout.path}' must be owned by mark (${mark.uid}:${mark.gid}).`,
        ),
      );
    }
  }

  if (!facts.checkout.writable) {
    failures.push(
      failure(
        "DEVELOPER_CHECKOUT_NOT_WRITABLE",
        `Checkout '${facts.checkout.path}' is not writable by the developer runtime.`,
      ),
    );
  }
  if (!facts.checkoutAudit.completed) {
    failures.push(
      failure(
        "DEVELOPER_SOURCE_TREE_AUDIT_INCOMPLETE",
        "Developer launch requires a completed source-tree ownership and mode audit.",
      ),
    );
  }
  if (facts.checkoutAudit.violations.length > 0) {
    failures.push(
      failure(
        "DEVELOPER_SOURCE_TREE_POLICY_VIOLATION",
        `Developer source tree failed ownership/mode audit (${facts.checkoutAudit.violations.length} violation(s)).`,
      ),
    );
  }
  const currentGroups = [...new Set(facts.currentSupplementaryGids)].sort(
    (left, right) => left - right,
  );
  const markGroups = [...new Set(facts.markInitgroupsGids)].sort(
    (left, right) => left - right,
  );
  if (
    currentGroups.length !== markGroups.length ||
    currentGroups.some((gid, index) => gid !== markGroups[index])
  ) {
    failures.push(
      failure(
        "DEVELOPER_INITGROUPS_MISMATCH",
        "Developer runtime supplementary groups must exactly match initgroups(mark).",
      ),
    );
  }
  if (facts.umask !== 0o077) {
    failures.push(
      failure(
        "DEVELOPER_UMASK_INVALID",
        "Developer executor must set deterministic umask 0077 so owner rwx is preserved and new entries are private.",
      ),
    );
  }
  if (!facts.sudoPolicy.nonInteractiveListAvailable) {
    failures.push(
      failure(
        "DEVELOPER_SUDO_POLICY_UNAVAILABLE",
        "Developer runtime must be able to inspect its sudo policy non-interactively.",
      ),
    );
  } else if (!facts.sudoPolicy.nonInteractiveAll) {
    failures.push(
      failure(
        "DEVELOPER_SUDO_FULL_ACCESS_MISSING",
        "Developer runtime requires explicit NOPASSWD full sudo parity with Codex Desktop.",
      ),
    );
  }

  return failures.length === 0
    ? { ok: true, profile: "developer" }
    : { ok: false, profile: "developer", failures };
}

function hasProjectQuota(options: readonly string[]): boolean {
  return options.includes("pquota") || options.includes("prjquota");
}

function isExactGuestSubidRange(
  ranges: readonly SubordinateIdRange[],
): boolean {
  return (
    ranges.length === 1 &&
    ranges[0]?.start === GUEST_SUBORDINATE_ID_START &&
    ranges[0].count === GUEST_SUBORDINATE_ID_COUNT
  );
}

function isSetuidRoot(helper: SetuidHelperFacts): boolean {
  return (
    helper.exists &&
    helper.ownerUid === 0 &&
    helper.mode !== null &&
    (helper.mode & 0o4000) === 0o4000
  );
}

function evaluateGuestRuntime(
  facts: UserSandboxPreflightFacts,
  failures: PreflightFailure[],
): void {
  const guest = facts.guestRuntime;
  if (guest === null) {
    failures.push(
      failure(
        "SANDBOX_GUEST_RUNTIME_PROBE_MISSING",
        "The exact digest-pinned guest image has no trusted runtime probe result.",
      ),
    );
    return;
  }

  if (facts.image.sha256 === null || guest.imageSha256 !== facts.image.sha256) {
    failures.push(
      failure(
        "SANDBOX_GUEST_RUNTIME_PROBE_DIGEST_MISMATCH",
        "Guest runtime probe digest does not match the immutable image digest.",
      ),
    );
  }
  if (
    guest.braiAccount?.username !== "brai" ||
    guest.braiAccount.uid !== 1_000 ||
    guest.braiAccount.gid !== 1_000
  ) {
    failures.push(
      failure(
        "SANDBOX_GUEST_BRAI_ACCOUNT_INVALID",
        "Guest image must contain the brai account with UID/GID 1000:1000.",
      ),
    );
  }

  for (const name of GUEST_RUNTIME_EXECUTABLES) {
    if (!guest.executables[name]) {
      failures.push(
        failure(
          guestExecutableFailureCodes[name],
          `Required guest executable '${name}' is unavailable inside the image.`,
        ),
      );
    }
  }
  if (guest.networkDriver !== "slirp4netns") {
    failures.push(
      failure(
        "SANDBOX_GUEST_NETWORK_DRIVER_INVALID",
        "Guest rootless network driver must be slirp4netns.",
      ),
    );
  }
  if (guest.storageDriver !== "fuse-overlayfs") {
    failures.push(
      failure(
        "SANDBOX_GUEST_STORAGE_DRIVER_INVALID",
        "Guest rootless storage driver must be fuse-overlayfs.",
      ),
    );
  }
  if (!isSetuidRoot(guest.newuidmap)) {
    failures.push(
      failure(
        "SANDBOX_GUEST_NEWUIDMAP_NOT_SETUID_ROOT",
        "Guest newuidmap must exist, be root-owned and carry the setuid bit.",
      ),
    );
  }
  if (!isSetuidRoot(guest.newgidmap)) {
    failures.push(
      failure(
        "SANDBOX_GUEST_NEWGIDMAP_NOT_SETUID_ROOT",
        "Guest newgidmap must exist, be root-owned and carry the setuid bit.",
      ),
    );
  }
  if (!isExactGuestSubidRange(guest.subuidRanges)) {
    failures.push(
      failure(
        "SANDBOX_GUEST_SUBUID_RANGE_INVALID",
        "Guest /etc/subuid must contain exactly brai:65536:65536.",
      ),
    );
  }
  if (!isExactGuestSubidRange(guest.subgidRanges)) {
    failures.push(
      failure(
        "SANDBOX_GUEST_SUBGID_RANGE_INVALID",
        "Guest /etc/subgid must contain exactly brai:65536:65536.",
      ),
    );
  }
}

export function evaluateUserSandboxPreflight(
  facts: UserSandboxPreflightFacts,
): PreflightResult {
  const failures: PreflightFailure[] = [];
  const storageMount = facts.storageMount;
  const canonicalStoragePath = resolve(CANONICAL_SANDBOX_STORAGE_PATH);
  const canonicalBackingPath = resolve(CANONICAL_SANDBOX_BACKING_PATH);

  if (!facts.storagePathExists) {
    failures.push(
      failure(
        "SANDBOX_STORAGE_PATH_MISSING",
        `Sandbox storage path '${facts.storagePath}' does not exist.`,
      ),
    );
  }
  if (
    resolve(facts.storagePath) !== canonicalStoragePath ||
    facts.storagePathCanonicalPath === null ||
    resolve(facts.storagePathCanonicalPath) !== canonicalStoragePath
  ) {
    failures.push(
      failure(
        "SANDBOX_STORAGE_PATH_NOT_CANONICAL",
        `Sandbox storage must be the real canonical path '${canonicalStoragePath}'.`,
      ),
    );
  }
  if (storageMount === null || storageMount.mountPoint === "/") {
    failures.push(
      failure(
        "SANDBOX_STORAGE_NOT_SEPARATE_MOUNT",
        "Sandbox storage must be the mounted shared XFS pool, not the outer root filesystem.",
      ),
    );
  } else {
    if (resolve(storageMount.mountPoint) !== canonicalStoragePath) {
      failures.push(
        failure(
          "SANDBOX_STORAGE_MOUNTPOINT_MISMATCH",
          `Sandbox XFS mount point must be exactly '${canonicalStoragePath}'.`,
        ),
      );
    }
    if (storageMount.fsType.toLowerCase() !== "xfs") {
      failures.push(
        failure(
          "SANDBOX_STORAGE_FS_NOT_XFS",
          `Sandbox storage filesystem is '${storageMount.fsType}', expected XFS.`,
        ),
      );
    }
    if (!hasProjectQuota(storageMount.options)) {
      failures.push(
        failure(
          "SANDBOX_STORAGE_PROJECT_QUOTA_DISABLED",
          "Sandbox XFS storage must be mounted with pquota or prjquota.",
        ),
      );
    }
    if (!/^\/dev\/loop[0-9]+$/u.test(storageMount.source)) {
      failures.push(
        failure(
          "SANDBOX_STORAGE_LOOP_SOURCE_INVALID",
          "The shared XFS pool must be mounted through exactly one kernel loop device.",
        ),
      );
    }
    if (
      facts.loopBackingFilePath === null ||
      resolve(facts.loopBackingFilePath) !== canonicalBackingPath
    ) {
      failures.push(
        failure(
          "SANDBOX_STORAGE_LOOP_BACKING_MISMATCH",
          `The mounted loop device must resolve to '${canonicalBackingPath}'.`,
        ),
      );
    }
    if (facts.backingFileLoopDeviceCount !== 1) {
      failures.push(
        failure(
          "SANDBOX_STORAGE_LOOP_MAPPING_COUNT_INVALID",
          "The canonical backing file must have exactly one loop-device mapping.",
        ),
      );
    }
  }

  const backing = facts.backingFile;
  if (
    resolve(backing.path) !== canonicalBackingPath ||
    backing.canonicalPath === null ||
    resolve(backing.canonicalPath) !== canonicalBackingPath
  ) {
    failures.push(
      failure(
        "SANDBOX_STORAGE_BACKING_PATH_INVALID",
        `The only permitted pool backing file is '${canonicalBackingPath}'.`,
      ),
    );
  }
  if (!backing.exists) {
    failures.push(
      failure(
        "SANDBOX_STORAGE_BACKING_MISSING",
        `Shared pool backing file '${canonicalBackingPath}' does not exist.`,
      ),
    );
  } else {
    if (backing.symbolicLink) {
      failures.push(
        failure(
          "SANDBOX_STORAGE_BACKING_SYMLINK",
          "Shared pool backing file must never be a symbolic link.",
        ),
      );
    }
    if (!backing.regularFile) {
      failures.push(
        failure(
          "SANDBOX_STORAGE_BACKING_NOT_REGULAR",
          "Shared pool backing must be one regular file, never a device, directory, or per-user image.",
        ),
      );
    }
    if (backing.ownerUid !== 0 || backing.ownerGid !== 0) {
      failures.push(
        failure(
          "SANDBOX_STORAGE_BACKING_NOT_ROOT_OWNED",
          "Shared pool backing file must be owned by root:root.",
        ),
      );
    }
    if (backing.mode !== 0o600) {
      failures.push(
        failure(
          "SANDBOX_STORAGE_BACKING_MODE_INVALID",
          "Shared pool backing file mode must be exactly 0600.",
        ),
      );
    }
    if (!backing.openedWithNoFollow) {
      failures.push(
        failure(
          "SANDBOX_STORAGE_BACKING_DESCRIPTOR_UNVERIFIED",
          "Shared pool backing file must be opened with O_NOFOLLOW and measured through that descriptor.",
        ),
      );
    }
    if (!backing.parentChainTrusted) {
      failures.push(
        failure(
          "SANDBOX_STORAGE_BACKING_PARENT_CHAIN_UNTRUSTED",
          "Every backing-file ancestor must be a root-owned real directory without group/other write access.",
        ),
      );
    }
  }

  if (
    facts.rootMount.fsType.toLowerCase() !== "ext4" ||
    facts.backingMount === null ||
    facts.backingMount.fsType.toLowerCase() !== "ext4" ||
    facts.backingMount.device !== facts.rootMount.device ||
    resolve(facts.backingMount.mountPoint) !==
      resolve(facts.rootMount.mountPoint)
  ) {
    failures.push(
      failure(
        "SANDBOX_STORAGE_BACKING_NOT_ON_ROOT_EXT4",
        "The one-disk design requires the canonical backing file on the existing root ext4 filesystem.",
      ),
    );
  }

  if (
    resolve(facts.logicalCeilingConfigurationPath) !==
      resolve(CANONICAL_STORAGE_CEILING_PATH) ||
    !facts.logicalCeilingConfigurationTrusted
  ) {
    failures.push(
      failure(
        "SANDBOX_STORAGE_LOGICAL_CEILING_CONFIG_UNTRUSTED",
        `Logical ceiling must be read from the root-owned non-writable file '${CANONICAL_STORAGE_CEILING_PATH}'.`,
      ),
    );
  }
  if (
    !Number.isSafeInteger(facts.configuredLogicalCeilingBytes) ||
    facts.configuredLogicalCeilingBytes < MINIMUM_SANDBOX_STORAGE_BYTES ||
    facts.configuredLogicalCeilingBytes > MAXIMUM_SANDBOX_STORAGE_BYTES
  ) {
    failures.push(
      failure(
        "SANDBOX_STORAGE_LOGICAL_CEILING_INVALID",
        "Shared pool logical ceiling must be a finite, supported, safe-integer byte value from root-owned configuration.",
      ),
    );
  } else if (
    backing.exists &&
    backing.logicalBytes !== facts.configuredLogicalCeilingBytes
  ) {
    failures.push(
      failure(
        "SANDBOX_STORAGE_LOGICAL_CEILING_MISMATCH",
        "Backing file logical size must exactly equal the configured aggregate storage ceiling.",
      ),
    );
  }
  if (
    backing.exists &&
    (backing.allocatedBytes < 0 ||
      backing.logicalBytes < 0 ||
      backing.allocatedBytes > backing.logicalBytes)
  ) {
    failures.push(
      failure(
        "SANDBOX_STORAGE_SPARSE_ALLOCATION_INVALID",
        "Sparse backing allocation must never exceed its bounded logical size.",
      ),
    );
  }
  if (
    backing.exists &&
    Number.isSafeInteger(facts.configuredLogicalCeilingBytes) &&
    facts.configuredLogicalCeilingBytes > 0 &&
    facts.outerStorageTotalBytes > 0
  ) {
    const outerReserveBytes = Math.ceil(
      facts.outerStorageTotalBytes * MINIMUM_STORAGE_GATE_FREE_FRACTION,
    );
    const outerGrowthHeadroomBytes = Math.max(
      0,
      facts.outerStorageAvailableBytes - outerReserveBytes,
    );
    const unallocatedPoolBytes = Math.max(
      0,
      facts.configuredLogicalCeilingBytes - backing.allocatedBytes,
    );
    if (unallocatedPoolBytes > outerGrowthHeadroomBytes) {
      failures.push(
        failure(
          "SANDBOX_STORAGE_OUTER_HEADROOM_INSUFFICIENT",
          "The sparse pool's remaining possible growth would cross the outer root-ext4 free-space floor.",
        ),
      );
    }
  }

  const innerFreeFraction =
    facts.storagePathExists && facts.storageTotalBytes > 0
      ? facts.storageAvailableBytes / facts.storageTotalBytes
      : null;
  if (
    innerFreeFraction !== null &&
    innerFreeFraction < MINIMUM_STORAGE_GATE_FREE_FRACTION
  ) {
    failures.push(
      failure(
        "SANDBOX_STORAGE_INNER_GATE_FREE_SPACE_LOW",
        "The inner XFS pool must have at least 10% currently available before launch or provisioning.",
      ),
    );
  }
  const outerFreeFraction =
    facts.outerStorageTotalBytes > 0
      ? facts.outerStorageAvailableBytes / facts.outerStorageTotalBytes
      : null;
  if (
    outerFreeFraction !== null &&
    outerFreeFraction < MINIMUM_STORAGE_GATE_FREE_FRACTION
  ) {
    failures.push(
      failure(
        "SANDBOX_STORAGE_OUTER_GATE_FREE_SPACE_LOW",
        "The outer root ext4 filesystem must have at least 10% currently available before launch or provisioning.",
      ),
    );
  }
  if (!facts.storageFstrimAvailable) {
    failures.push(
      failure(
        "SANDBOX_STORAGE_FSTRIM_MISSING",
        "The host must provide fstrim so deleted XFS extents can be punched out of the sparse backing file.",
      ),
    );
  }
  if (!facts.storageTrimTimerActive) {
    failures.push(
      failure(
        "SANDBOX_STORAGE_TRIM_TIMER_INACTIVE",
        "The root-owned periodic sparse-space reclamation timer must be active before sandbox launch.",
      ),
    );
  }

  if (!facts.systemdNspawnAvailable) {
    failures.push(
      failure(
        "SANDBOX_SYSTEMD_NSPAWN_MISSING",
        "Required host executable 'systemd-nspawn' is unavailable.",
      ),
    );
  }
  if (!facts.hostPrincipalScanCompleted) {
    failures.push(
      failure(
        "SANDBOX_HOST_PRINCIPAL_SCAN_INCOMPLETE",
        "Sandbox launch requires a complete trusted snapshot of occupied host account and group IDs.",
      ),
    );
  }
  const hostIdPoolIssues = auditCanonicalHostIdPool(facts.hostIdPool);
  if (
    hostIdPoolIssues.some(
      ({ code }) => code === "HOST_ID_POOL_INSPECTION_INCOMPLETE",
    )
  ) {
    failures.push(
      failure(
        "SANDBOX_HOST_ID_POOL_SCAN_INCOMPLETE",
        "Canonical host UID/GID pool inspection did not read every required local identity source.",
      ),
    );
  }
  if (
    hostIdPoolIssues.some(({ code }) =>
      [
        "HOST_ID_POOL_SYSTEMD_ALLOCATOR_COLLISION",
        "HOST_ID_POOL_PASSWD_COLLISION",
        "HOST_ID_POOL_GROUP_COLLISION",
        "HOST_ID_POOL_SUBUID_OVERLAP",
        "HOST_ID_POOL_SUBGID_OVERLAP",
      ].includes(code),
    )
  ) {
    failures.push(
      failure(
        "SANDBOX_HOST_ID_POOL_COLLISION",
        "Canonical host UID/GID pool collides with a host principal, subordinate range, or system allocator.",
      ),
    );
  }
  if (
    hostIdPoolIssues.some(
      ({ code }) =>
        ![
          "HOST_ID_POOL_INSPECTION_INCOMPLETE",
          "HOST_ID_POOL_SYSTEMD_ALLOCATOR_COLLISION",
          "HOST_ID_POOL_PASSWD_COLLISION",
          "HOST_ID_POOL_GROUP_COLLISION",
          "HOST_ID_POOL_SUBUID_OVERLAP",
          "HOST_ID_POOL_SUBGID_OVERLAP",
        ].includes(code),
    )
  ) {
    failures.push(
      failure(
        "SANDBOX_HOST_ID_POOL_RESERVATION_INVALID",
        "Canonical host UID/GID pool reservation or allocator evidence is invalid.",
      ),
    );
  }

  if (!facts.bindPath.exists) {
    failures.push(
      failure(
        "SANDBOX_BIND_PATH_MISSING",
        `Sandbox bind path '${facts.bindPath.path}' does not exist.`,
      ),
    );
  } else {
    if (facts.bindPath.symbolicLink) {
      failures.push(
        failure(
          "SANDBOX_BIND_PATH_SYMLINK",
          "Sandbox bind path must be a real directory, never a symbolic link.",
        ),
      );
    }
    if (
      facts.bindPath.canonicalPath === null ||
      resolve(facts.bindPath.canonicalPath) !== resolve(facts.bindPath.path)
    ) {
      failures.push(
        failure(
          "SANDBOX_BIND_PATH_NOT_CANONICAL",
          "Sandbox bind path must resolve exactly to its canonical allocated path.",
        ),
      );
    }
    if (!facts.bindPath.directory) {
      failures.push(
        failure(
          "SANDBOX_BIND_PATH_NOT_DIRECTORY",
          "Sandbox bind path must be a directory.",
        ),
      );
    }
    if (
      facts.bindPath.mode === null ||
      (facts.bindPath.mode & 0o700) !== 0o700
    ) {
      failures.push(
        failure(
          "SANDBOX_BIND_PATH_OWNER_ACCESS_MISSING",
          "Sandbox bind path owner requires read, write and execute access.",
        ),
      );
    }
    if (!facts.bindPath.effectiveOwnerAccess) {
      failures.push(
        failure(
          "SANDBOX_BIND_PATH_EFFECTIVE_ACCESS_MISSING",
          "Sandbox bind path must pass effective read, write and search checks; ACLs and mount state may not block access.",
        ),
      );
    }
    if (facts.bindPath.ownerUid === 0 || facts.bindPath.ownerGid === 0) {
      failures.push(
        failure(
          "SANDBOX_BIND_PATH_OWNER_IS_ROOT",
          "Sandbox bind path must use its reserved non-root numeric owner.",
        ),
      );
    }
    if (
      facts.bindPath.ownerUid !== null &&
      facts.hostAccountUids.includes(facts.bindPath.ownerUid)
    ) {
      failures.push(
        failure(
          "SANDBOX_BIND_OWNER_UID_COLLIDES_WITH_HOST_ACCOUNT",
          "Sandbox bind owner UID must be reserved numeric identity, not a host login account.",
        ),
      );
    }
    if (
      facts.bindPath.ownerGid !== null &&
      facts.hostGroupGids.includes(facts.bindPath.ownerGid)
    ) {
      failures.push(
        failure(
          "SANDBOX_BIND_OWNER_GID_COLLIDES_WITH_HOST_GROUP",
          "Sandbox bind owner GID must be reserved numeric identity, not a host group.",
        ),
      );
    }
  }

  if (!facts.image.exists) {
    failures.push(
      failure(
        "SANDBOX_IMAGE_MISSING",
        `Shared sandbox image '${facts.image.path}' does not exist.`,
      ),
    );
  } else {
    if (facts.image.symbolicLink) {
      failures.push(
        failure(
          "SANDBOX_IMAGE_SYMLINK",
          "Shared sandbox image must not be a symbolic link.",
        ),
      );
    } else if (!facts.image.regularFile) {
      failures.push(
        failure(
          "SANDBOX_IMAGE_NOT_REGULAR_FILE",
          "Shared sandbox image must be a regular immutable image file.",
        ),
      );
    }
    if (facts.image.ownerUid !== 0 || facts.image.ownerGid !== 0) {
      failures.push(
        failure(
          "SANDBOX_IMAGE_NOT_ROOT_OWNED",
          "Shared sandbox image must be owned by root:root.",
        ),
      );
    }
    if (facts.image.mode === null || (facts.image.mode & 0o022) !== 0) {
      failures.push(
        failure(
          "SANDBOX_IMAGE_WRITABLE_BY_NON_ROOT",
          "Shared sandbox image must not be writable by group or other users.",
        ),
      );
    }
    if (!facts.image.openedWithNoFollow) {
      failures.push(
        failure(
          "SANDBOX_IMAGE_DESCRIPTOR_UNVERIFIED",
          "Shared sandbox image must be opened with O_NOFOLLOW and inspected through that descriptor.",
        ),
      );
    }
    if (!facts.image.parentChainTrusted) {
      failures.push(
        failure(
          "SANDBOX_IMAGE_PARENT_CHAIN_UNTRUSTED",
          "Every image parent through the trusted image root must be a root-owned real directory with no group/other write access.",
        ),
      );
    }
    if (!facts.image.sidecarTrusted) {
      failures.push(
        failure(
          "SANDBOX_IMAGE_SIDECAR_UNTRUSTED",
          "Image digest sidecar must be a root-owned regular non-symlink file with no group/other write access.",
        ),
      );
    }
    if (!facts.image.digestVerified) {
      failures.push(
        failure(
          "SANDBOX_IMAGE_DIGEST_UNVERIFIED",
          "Shared sandbox image SHA-256 does not match its pinned sidecar digest.",
        ),
      );
    }
  }
  if (facts.image.insideUserStorage) {
    failures.push(
      failure(
        "SANDBOX_IMAGE_INSIDE_USER_STORAGE",
        "Shared immutable image must be outside per-user quota storage.",
      ),
    );
  }

  evaluateGuestRuntime(facts, failures);

  return failures.length === 0
    ? { ok: true, profile: "user-sandbox" }
    : { ok: false, profile: "user-sandbox", failures };
}
