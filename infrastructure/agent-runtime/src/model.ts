import type { HostIdPoolFacts } from "./host-id-pool.js";

export const ACCESS_PROFILES = ["developer", "user-sandbox"] as const;

export type AccessProfile = (typeof ACCESS_PROFILES)[number];

export const GUEST_RUNTIME_EXECUTABLES = [
  "dockerd-rootless.sh",
  "rootlesskit",
  "slirp4netns",
  "fuse-overlayfs",
  "newuidmap",
  "newgidmap",
] as const;

export type GuestRuntimeExecutable = (typeof GUEST_RUNTIME_EXECUTABLES)[number];

export type PreflightErrorCode =
  | "DEVELOPER_MARK_ACCOUNT_MISSING"
  | "DEVELOPER_RUNTIME_USER_NOT_MARK"
  | "DEVELOPER_UID_MISMATCH"
  | "DEVELOPER_GID_MISMATCH"
  | "DEVELOPER_CHECKOUT_OWNER_MISMATCH"
  | "DEVELOPER_CHECKOUT_NOT_WRITABLE"
  | "DEVELOPER_INITGROUPS_MISMATCH"
  | "DEVELOPER_UMASK_INVALID"
  | "DEVELOPER_SOURCE_TREE_AUDIT_INCOMPLETE"
  | "DEVELOPER_SOURCE_TREE_POLICY_VIOLATION"
  | "DEVELOPER_SUDO_POLICY_UNAVAILABLE"
  | "DEVELOPER_SUDO_FULL_ACCESS_MISSING"
  | "SANDBOX_STORAGE_PATH_NOT_CANONICAL"
  | "SANDBOX_STORAGE_PATH_MISSING"
  | "SANDBOX_STORAGE_NOT_SEPARATE_MOUNT"
  | "SANDBOX_STORAGE_MOUNTPOINT_MISMATCH"
  | "SANDBOX_STORAGE_FS_NOT_XFS"
  | "SANDBOX_STORAGE_PROJECT_QUOTA_DISABLED"
  | "SANDBOX_STORAGE_LOOP_SOURCE_INVALID"
  | "SANDBOX_STORAGE_LOOP_BACKING_MISMATCH"
  | "SANDBOX_STORAGE_LOOP_MAPPING_COUNT_INVALID"
  | "SANDBOX_STORAGE_BACKING_PATH_INVALID"
  | "SANDBOX_STORAGE_BACKING_MISSING"
  | "SANDBOX_STORAGE_BACKING_SYMLINK"
  | "SANDBOX_STORAGE_BACKING_NOT_REGULAR"
  | "SANDBOX_STORAGE_BACKING_NOT_ROOT_OWNED"
  | "SANDBOX_STORAGE_BACKING_MODE_INVALID"
  | "SANDBOX_STORAGE_BACKING_DESCRIPTOR_UNVERIFIED"
  | "SANDBOX_STORAGE_BACKING_PARENT_CHAIN_UNTRUSTED"
  | "SANDBOX_STORAGE_BACKING_NOT_ON_ROOT_EXT4"
  | "SANDBOX_STORAGE_LOGICAL_CEILING_CONFIG_UNTRUSTED"
  | "SANDBOX_STORAGE_LOGICAL_CEILING_INVALID"
  | "SANDBOX_STORAGE_LOGICAL_CEILING_MISMATCH"
  | "SANDBOX_STORAGE_SPARSE_ALLOCATION_INVALID"
  | "SANDBOX_STORAGE_OUTER_HEADROOM_INSUFFICIENT"
  | "SANDBOX_STORAGE_INNER_GATE_FREE_SPACE_LOW"
  | "SANDBOX_STORAGE_OUTER_GATE_FREE_SPACE_LOW"
  | "SANDBOX_STORAGE_FSTRIM_MISSING"
  | "SANDBOX_STORAGE_TRIM_TIMER_INACTIVE"
  | "SANDBOX_SYSTEMD_NSPAWN_MISSING"
  | "SANDBOX_HOST_PRINCIPAL_SCAN_INCOMPLETE"
  | "SANDBOX_HOST_ID_POOL_SCAN_INCOMPLETE"
  | "SANDBOX_HOST_ID_POOL_RESERVATION_INVALID"
  | "SANDBOX_HOST_ID_POOL_COLLISION"
  | "SANDBOX_BIND_PATH_MISSING"
  | "SANDBOX_BIND_PATH_SYMLINK"
  | "SANDBOX_BIND_PATH_NOT_CANONICAL"
  | "SANDBOX_BIND_PATH_NOT_DIRECTORY"
  | "SANDBOX_BIND_PATH_OWNER_ACCESS_MISSING"
  | "SANDBOX_BIND_PATH_EFFECTIVE_ACCESS_MISSING"
  | "SANDBOX_BIND_PATH_OWNER_IS_ROOT"
  | "SANDBOX_BIND_OWNER_UID_COLLIDES_WITH_HOST_ACCOUNT"
  | "SANDBOX_BIND_OWNER_GID_COLLIDES_WITH_HOST_GROUP"
  | "SANDBOX_IMAGE_MISSING"
  | "SANDBOX_IMAGE_SYMLINK"
  | "SANDBOX_IMAGE_NOT_REGULAR_FILE"
  | "SANDBOX_IMAGE_NOT_ROOT_OWNED"
  | "SANDBOX_IMAGE_WRITABLE_BY_NON_ROOT"
  | "SANDBOX_IMAGE_DESCRIPTOR_UNVERIFIED"
  | "SANDBOX_IMAGE_PARENT_CHAIN_UNTRUSTED"
  | "SANDBOX_IMAGE_SIDECAR_UNTRUSTED"
  | "SANDBOX_IMAGE_DIGEST_UNVERIFIED"
  | "SANDBOX_IMAGE_INSIDE_USER_STORAGE"
  | "SANDBOX_GUEST_RUNTIME_PROBE_MISSING"
  | "SANDBOX_GUEST_RUNTIME_PROBE_DIGEST_MISMATCH"
  | "SANDBOX_GUEST_BRAI_ACCOUNT_INVALID"
  | "SANDBOX_GUEST_ROOTLESS_DOCKER_MISSING"
  | "SANDBOX_GUEST_ROOTLESSKIT_MISSING"
  | "SANDBOX_GUEST_SLIRP4NETNS_MISSING"
  | "SANDBOX_GUEST_FUSE_OVERLAYFS_MISSING"
  | "SANDBOX_GUEST_NEWUIDMAP_MISSING"
  | "SANDBOX_GUEST_NEWGIDMAP_MISSING"
  | "SANDBOX_GUEST_NETWORK_DRIVER_INVALID"
  | "SANDBOX_GUEST_STORAGE_DRIVER_INVALID"
  | "SANDBOX_GUEST_NEWUIDMAP_NOT_SETUID_ROOT"
  | "SANDBOX_GUEST_NEWGIDMAP_NOT_SETUID_ROOT"
  | "SANDBOX_GUEST_SUBUID_RANGE_INVALID"
  | "SANDBOX_GUEST_SUBGID_RANGE_INVALID";

export interface IdentityFacts {
  readonly username: string | null;
  readonly uid: number;
  readonly gid: number;
}

export interface AccountFacts {
  readonly username: string;
  readonly uid: number;
  readonly gid: number;
}

export interface CheckoutFacts {
  readonly path: string;
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly writable: boolean;
}

export interface CheckoutAuditFacts {
  readonly completed: boolean;
  readonly violations: readonly string[];
}

export interface DeveloperPreflightFacts {
  readonly currentIdentity: IdentityFacts;
  readonly markAccount: AccountFacts | null;
  readonly checkout: CheckoutFacts;
  readonly checkoutAudit: CheckoutAuditFacts;
  readonly currentSupplementaryGids: readonly number[];
  readonly markInitgroupsGids: readonly number[];
  readonly umask: number;
  readonly sudoPolicy: {
    readonly nonInteractiveListAvailable: boolean;
    readonly nonInteractiveAll: boolean;
  };
}

export interface MountFacts {
  readonly mountPoint: string;
  /** Kernel major:minor identity from mountinfo. */
  readonly device: string;
  /** Filesystem source from mountinfo, for example /dev/loop0. */
  readonly source: string;
  readonly fsType: string;
  readonly options: readonly string[];
}

export interface StorageBackingFileFacts {
  readonly path: string;
  readonly canonicalPath: string | null;
  readonly exists: boolean;
  readonly regularFile: boolean;
  readonly symbolicLink: boolean;
  readonly ownerUid: number | null;
  readonly ownerGid: number | null;
  readonly mode: number | null;
  readonly openedWithNoFollow: boolean;
  readonly parentChainTrusted: boolean;
  readonly logicalBytes: number;
  readonly allocatedBytes: number;
}

export interface SubordinateIdRange {
  readonly start: number;
  readonly count: number;
}

export interface SandboxImageFacts {
  readonly path: string;
  readonly exists: boolean;
  readonly regularFile: boolean;
  readonly symbolicLink: boolean;
  readonly ownerUid: number | null;
  readonly ownerGid: number | null;
  readonly mode: number | null;
  readonly openedWithNoFollow: boolean;
  readonly parentChainTrusted: boolean;
  readonly sidecarTrusted: boolean;
  readonly sha256: string | null;
  readonly digestVerified: boolean;
  readonly insideUserStorage: boolean;
}

export interface BindPathFacts {
  readonly path: string;
  readonly canonicalPath: string | null;
  readonly exists: boolean;
  readonly symbolicLink: boolean;
  readonly directory: boolean;
  readonly ownerUid: number | null;
  readonly ownerGid: number | null;
  readonly mode: number | null;
  readonly effectiveOwnerAccess: boolean;
}

export interface SetuidHelperFacts {
  readonly exists: boolean;
  readonly ownerUid: number | null;
  readonly mode: number | null;
}

/** Facts measured inside the exact digest-pinned immutable guest image. */
export interface GuestRuntimeFacts {
  readonly imageSha256: string;
  readonly braiAccount: AccountFacts | null;
  readonly executables: Readonly<Record<GuestRuntimeExecutable, boolean>>;
  readonly networkDriver: string | null;
  readonly storageDriver: string | null;
  readonly subuidRanges: readonly SubordinateIdRange[];
  readonly subgidRanges: readonly SubordinateIdRange[];
  readonly newuidmap: SetuidHelperFacts;
  readonly newgidmap: SetuidHelperFacts;
}

/** Read-only XFS measurements for one already provisioned project tree. */
export interface XfsProjectQuotaFacts {
  readonly dataPath: string;
  readonly configuredProjectId: number;
  readonly treeProjectId: number;
  readonly projectInheritance: boolean;
  readonly enforcementActive: boolean;
  readonly byteHardLimit: number;
  readonly inodeHardLimit: number;
}

export interface UserSandboxPreflightFacts {
  readonly storagePath: string;
  readonly storagePathCanonicalPath: string | null;
  readonly storagePathExists: boolean;
  readonly logicalCeilingConfigurationPath: string;
  readonly logicalCeilingConfigurationTrusted: boolean;
  readonly configuredLogicalCeilingBytes: number;
  readonly backingFile: StorageBackingFileFacts;
  readonly backingMount: MountFacts | null;
  readonly loopBackingFilePath: string | null;
  readonly backingFileLoopDeviceCount: number;
  readonly rootMount: MountFacts;
  readonly storageMount: MountFacts | null;
  readonly storageTotalBytes: number;
  readonly storageAvailableBytes: number;
  readonly outerStorageTotalBytes: number;
  readonly outerStorageAvailableBytes: number;
  readonly storageFstrimAvailable: boolean;
  readonly storageTrimTimerActive: boolean;
  readonly systemdNspawnAvailable: boolean;
  readonly hostPrincipalScanCompleted: boolean;
  readonly hostAccountUids: readonly number[];
  readonly hostGroupGids: readonly number[];
  readonly hostIdPool: HostIdPoolFacts;
  readonly bindPath: BindPathFacts;
  readonly image: SandboxImageFacts;
  readonly guestRuntime: GuestRuntimeFacts | null;
  readonly projectQuota: XfsProjectQuotaFacts | null;
}

export interface PreflightFailure {
  readonly code: PreflightErrorCode;
  readonly message: string;
}

export type PreflightResult =
  | { readonly ok: true; readonly profile: AccessProfile }
  | {
      readonly ok: false;
      readonly profile: AccessProfile;
      readonly failures: readonly PreflightFailure[];
    };
