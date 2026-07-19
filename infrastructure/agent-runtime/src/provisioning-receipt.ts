import { resolve } from "node:path";
import {
  auditEnvironmentAllocations,
  type EnvironmentAllocation,
  type EnvironmentAllocationPolicy,
} from "./allocation.js";
import { auditCanonicalHostIdPool } from "./host-id-pool.js";
import type { PreflightResult, UserSandboxPreflightFacts } from "./model.js";
import {
  CANONICAL_SANDBOX_BACKING_PATH,
  CANONICAL_SANDBOX_STORAGE_PATH,
} from "./storage-layout.js";
import type { StorageConsumption } from "./storage-admission.js";

export type ProvisioningReceiptRejectionCode =
  | "PROVISIONING_PREFLIGHT_FAILED"
  | "PROVISIONING_ALLOCATION_REGISTRY_INVALID"
  | "PROVISIONING_ALLOCATION_NOT_EXACT"
  | "PROVISIONING_BIND_PATH_MISMATCH"
  | "PROVISIONING_HOST_PRINCIPAL_SCAN_INCOMPLETE"
  | "PROVISIONING_HOST_ID_POOL_INVALID"
  | "PROVISIONING_HOST_ID_RANGE_COLLISION"
  | "PROVISIONING_QUOTA_STATE_MISMATCH"
  | "PROVISIONING_GUEST_RUNTIME_MISMATCH"
  | "PROVISIONING_IMAGE_DIGEST_MISSING"
  | "PROVISIONING_STORAGE_MOUNT_MISSING"
  | "PROVISIONING_STORAGE_ALLOCATION_MISMATCH"
  | "PROVISIONING_XFS_QUOTA_FACTS_MISSING"
  | "PROVISIONING_XFS_PROJECT_TREE_MISMATCH"
  | "PROVISIONING_XFS_PROJECT_INHERIT_DISABLED"
  | "PROVISIONING_XFS_QUOTA_ENFORCEMENT_INACTIVE"
  | "PROVISIONING_XFS_HARD_LIMIT_MISMATCH"
  | "PROVISIONING_ACCESS_GENERATION_INVALID"
  | "PROVISIONING_TIMESTAMP_INVALID";

export class ProvisioningReceiptRejectedError extends Error {
  public constructor(
    public readonly code: ProvisioningReceiptRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = "ProvisioningReceiptRejectedError";
  }
}

export interface ProvisioningReceipt {
  readonly version: 1;
  readonly profile: "user-sandbox";
  readonly userId: string;
  readonly accessGeneration: number;
  readonly provisionedAt: string;
  readonly runtime: {
    readonly environmentName: string;
    readonly outerIdRangeStart: number;
    readonly outerIdRangeCount: number;
    readonly imageBraiUid: number;
    readonly imageBraiGid: number;
    readonly guestInnerSubuidStart: number;
    readonly guestInnerSubgidStart: number;
    readonly effectiveHostInnerSubuidStart: number;
    readonly effectiveHostInnerSubgidStart: number;
    readonly innerSubidCount: number;
  };
  readonly image: {
    readonly path: string;
    readonly sha256: string;
  };
  readonly storage: {
    readonly mountPoint: string;
    readonly device: string;
    readonly source: string;
    readonly backingFile: string;
    readonly logicalCeilingBytes: number;
    readonly dataPath: string;
    readonly xfsProjectId: number;
    readonly hardLimitBytes: number;
    readonly hardLimitInodes: number;
    readonly projectInheritance: true;
    readonly quotaEnforcementActive: true;
  };
}

export interface CreateProvisioningReceiptInput {
  readonly allocation: EnvironmentAllocation;
  readonly allocationRegistry: readonly EnvironmentAllocation[];
  readonly allocationPolicy: EnvironmentAllocationPolicy;
  readonly facts: UserSandboxPreflightFacts;
  readonly persistedQuota: StorageConsumption;
  readonly accessGeneration: number;
}

export interface ProvisioningReceiptDependencies {
  readonly runPreflight: (facts: UserSandboxPreflightFacts) => PreflightResult;
  readonly now: () => Date;
}

function allocationsEqual(
  left: EnvironmentAllocation,
  right: EnvironmentAllocation,
): boolean {
  return (
    left.userId === right.userId &&
    left.slot === right.slot &&
    left.environmentName === right.environmentName &&
    left.outerUidRange.start === right.outerUidRange.start &&
    left.outerUidRange.count === right.outerUidRange.count &&
    left.outerGidRange.start === right.outerGidRange.start &&
    left.outerGidRange.count === right.outerGidRange.count &&
    left.imageBraiUid === right.imageBraiUid &&
    left.imageBraiGid === right.imageBraiGid &&
    left.innerSubuidRange.start === right.innerSubuidRange.start &&
    left.innerSubuidRange.count === right.innerSubuidRange.count &&
    left.innerSubgidRange.start === right.innerSubgidRange.start &&
    left.innerSubgidRange.count === right.innerSubgidRange.count &&
    left.xfsProjectId === right.xfsProjectId &&
    left.dataPath === right.dataPath &&
    left.quotaHardLimit.bytes === right.quotaHardLimit.bytes &&
    left.quotaHardLimit.inodes === right.quotaHardLimit.inodes
  );
}

function containsId(
  range: EnvironmentAllocation["outerUidRange"],
  id: number,
): boolean {
  return id >= range.start && id < range.start + range.count;
}

export function createProvisioningReceipt(
  input: CreateProvisioningReceiptInput,
  dependencies: ProvisioningReceiptDependencies,
): ProvisioningReceipt {
  const preflight = dependencies.runPreflight(input.facts);
  if (!preflight.ok || preflight.profile !== "user-sandbox") {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_PREFLIGHT_FAILED",
      "A provisioning receipt requires a fully passing user-sandbox preflight.",
    );
  }

  const allocationIssues = auditEnvironmentAllocations(
    input.allocationRegistry,
    input.allocationPolicy,
  );
  if (allocationIssues.length > 0) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_ALLOCATION_REGISTRY_INVALID",
      `Allocation registry failed validation: ${allocationIssues[0]?.code ?? "unknown"}.`,
    );
  }
  const exactMatches = input.allocationRegistry.filter((allocation) =>
    allocationsEqual(allocation, input.allocation),
  );
  if (exactMatches.length !== 1) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_ALLOCATION_NOT_EXACT",
      "The exact target allocation must occur once in the validated registry.",
    );
  }
  if (!input.facts.hostPrincipalScanCompleted) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_HOST_PRINCIPAL_SCAN_INCOMPLETE",
      "A complete trusted snapshot of occupied host account and group IDs is required.",
    );
  }
  if (auditCanonicalHostIdPool(input.facts.hostIdPool).length > 0) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_HOST_ID_POOL_INVALID",
      "The exact canonical host ID pool reservation must pass an independent provisioning audit.",
    );
  }
  if (
    input.persistedQuota.bytes !== input.allocation.quotaHardLimit.bytes ||
    input.persistedQuota.inodes !== input.allocation.quotaHardLimit.inodes
  ) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_QUOTA_STATE_MISMATCH",
      "Allocation hard limits must exactly match the user's persisted access-state quota.",
    );
  }
  if (
    input.facts.hostAccountUids.some((uid) =>
      containsId(input.allocation.outerUidRange, uid),
    ) ||
    input.facts.hostGroupGids.some((gid) =>
      containsId(input.allocation.outerGidRange, gid),
    )
  ) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_HOST_ID_RANGE_COLLISION",
      "The allocated outer UID/GID window intersects an existing host account or group.",
    );
  }

  if (
    resolve(input.facts.bindPath.path) !== resolve(input.allocation.dataPath) ||
    input.facts.bindPath.canonicalPath === null ||
    resolve(input.facts.bindPath.canonicalPath) !==
      resolve(input.allocation.dataPath) ||
    !input.facts.bindPath.exists ||
    input.facts.bindPath.symbolicLink ||
    !input.facts.bindPath.directory ||
    input.facts.bindPath.mode === null ||
    (input.facts.bindPath.mode & 0o700) !== 0o700 ||
    !input.facts.bindPath.effectiveOwnerAccess ||
    input.facts.bindPath.ownerUid !== input.allocation.imageBraiUid ||
    input.facts.bindPath.ownerGid !== input.allocation.imageBraiGid
  ) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_BIND_PATH_MISMATCH",
      "Bind path and owner do not match the exact allocation.",
    );
  }

  const guest = input.facts.guestRuntime;
  if (
    guest === null ||
    guest.imageSha256 !== input.facts.image.sha256 ||
    guest.subuidRanges.length !== 1 ||
    guest.subuidRanges[0]?.start !== 65_536 ||
    guest.subuidRanges[0].count !== 65_536 ||
    guest.subgidRanges.length !== 1 ||
    guest.subgidRanges[0]?.start !== 65_536 ||
    guest.subgidRanges[0].count !== 65_536
  ) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_GUEST_RUNTIME_MISMATCH",
      "Guest-relative identity facts do not match the digest-pinned image contract.",
    );
  }

  const digest = input.facts.image.sha256;
  if (
    input.facts.image.symbolicLink ||
    !input.facts.image.regularFile ||
    !input.facts.image.openedWithNoFollow ||
    !input.facts.image.parentChainTrusted ||
    !input.facts.image.sidecarTrusted ||
    !input.facts.image.digestVerified ||
    digest === null ||
    !/^[a-f0-9]{64}$/u.test(digest)
  ) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_IMAGE_DIGEST_MISSING",
      "A verified immutable image SHA-256 is required.",
    );
  }
  const storageMount = input.facts.storageMount;
  if (storageMount === null) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_STORAGE_MOUNT_MISSING",
      "A verified storage mount is required.",
    );
  }
  const allocatedStorageRoot = resolve(input.allocationPolicy.storageRoot);
  if (
    allocatedStorageRoot !== resolve(CANONICAL_SANDBOX_STORAGE_PATH) ||
    resolve(input.facts.storagePath) !== allocatedStorageRoot ||
    resolve(storageMount.mountPoint) !== allocatedStorageRoot ||
    storageMount.fsType.toLowerCase() !== "xfs" ||
    !storageMount.options.some(
      (option) => option === "prjquota" || option === "pquota",
    ) ||
    !/^\/dev\/loop[0-9]+$/u.test(storageMount.source) ||
    resolve(input.facts.backingFile.path) !==
      resolve(CANONICAL_SANDBOX_BACKING_PATH) ||
    input.facts.backingFile.canonicalPath === null ||
    resolve(input.facts.backingFile.canonicalPath) !==
      resolve(CANONICAL_SANDBOX_BACKING_PATH) ||
    input.facts.loopBackingFilePath === null ||
    resolve(input.facts.loopBackingFilePath) !==
      resolve(CANONICAL_SANDBOX_BACKING_PATH) ||
    input.facts.backingFileLoopDeviceCount !== 1 ||
    input.facts.backingFile.logicalBytes !==
      input.facts.configuredLogicalCeilingBytes
  ) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_STORAGE_ALLOCATION_MISMATCH",
      "Preflight storage mount does not match the allocation storage root.",
    );
  }

  const quota = input.facts.projectQuota;
  if (quota === null) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_XFS_QUOTA_FACTS_MISSING",
      "Read-only XFS project quota measurements are required.",
    );
  }
  if (
    resolve(quota.dataPath) !== resolve(input.allocation.dataPath) ||
    quota.configuredProjectId !== input.allocation.xfsProjectId ||
    quota.treeProjectId !== input.allocation.xfsProjectId
  ) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_XFS_PROJECT_TREE_MISMATCH",
      "XFS project configuration and actual tree project ID must match the allocation.",
    );
  }
  if (!quota.projectInheritance) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_XFS_PROJECT_INHERIT_DISABLED",
      "XFS project inheritance must be enabled on the target data tree.",
    );
  }
  if (!quota.enforcementActive) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_XFS_QUOTA_ENFORCEMENT_INACTIVE",
      "XFS project quota enforcement must be active.",
    );
  }
  if (
    quota.byteHardLimit !== input.allocation.quotaHardLimit.bytes ||
    quota.inodeHardLimit !== input.allocation.quotaHardLimit.inodes
  ) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_XFS_HARD_LIMIT_MISMATCH",
      "Enforced XFS byte and inode hard limits must exactly match the allocation.",
    );
  }
  if (
    !Number.isSafeInteger(input.accessGeneration) ||
    input.accessGeneration < 1
  ) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_ACCESS_GENERATION_INVALID",
      "Access generation must be a positive safe integer.",
    );
  }
  const timestamp = dependencies.now();
  if (!Number.isFinite(timestamp.getTime())) {
    throw new ProvisioningReceiptRejectedError(
      "PROVISIONING_TIMESTAMP_INVALID",
      "Provisioning timestamp is invalid.",
    );
  }

  return {
    version: 1,
    profile: "user-sandbox",
    userId: input.allocation.userId,
    accessGeneration: input.accessGeneration,
    provisionedAt: timestamp.toISOString(),
    runtime: {
      environmentName: input.allocation.environmentName,
      outerIdRangeStart: input.allocation.outerUidRange.start,
      outerIdRangeCount: input.allocation.outerUidRange.count,
      imageBraiUid: input.allocation.imageBraiUid,
      imageBraiGid: input.allocation.imageBraiGid,
      guestInnerSubuidStart: guest.subuidRanges[0].start,
      guestInnerSubgidStart: guest.subgidRanges[0].start,
      effectiveHostInnerSubuidStart: input.allocation.innerSubuidRange.start,
      effectiveHostInnerSubgidStart: input.allocation.innerSubgidRange.start,
      innerSubidCount: guest.subuidRanges[0].count,
    },
    image: { path: input.facts.image.path, sha256: digest },
    storage: {
      mountPoint: storageMount.mountPoint,
      device: storageMount.device,
      source: storageMount.source,
      backingFile: input.facts.backingFile.path,
      logicalCeilingBytes: input.facts.configuredLogicalCeilingBytes,
      dataPath: input.allocation.dataPath,
      xfsProjectId: input.allocation.xfsProjectId,
      hardLimitBytes: input.allocation.quotaHardLimit.bytes,
      hardLimitInodes: input.allocation.quotaHardLimit.inodes,
      projectInheritance: true,
      quotaEnforcementActive: true,
    },
  };
}
