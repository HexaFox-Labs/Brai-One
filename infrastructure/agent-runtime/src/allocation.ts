import { resolve } from "node:path";
import {
  BRAI_SANDBOX_ID_POOL_MAX_SLOT,
  BRAI_SANDBOX_ID_POOL_START,
  BRAI_SANDBOX_ID_RANGE_SIZE,
} from "@brai/contracts";
import type { StorageConsumption } from "./storage-admission.js";

export const OUTER_ID_RANGE_SIZE = BRAI_SANDBOX_ID_RANGE_SIZE;
export const OUTER_ID_RANGE_BASE = BRAI_SANDBOX_ID_POOL_START;
export const MAX_ALLOCATION_SLOT = BRAI_SANDBOX_ID_POOL_MAX_SLOT;
export const IMAGE_BRAI_ID = 1_000;
export const INNER_SUBORDINATE_OFFSET = 65_536;
export const INNER_SUBORDINATE_RANGE_SIZE = 65_536;
export const DEFAULT_USER_QUOTA: StorageConsumption = {
  bytes: 5 * 1_024 * 1_024 * 1_024,
  inodes: 500_000,
};

const MAX_XFS_PROJECT_ID = 4_294_967_295;

export interface IdRange {
  readonly start: number;
  readonly count: number;
}

export interface EnvironmentAllocationPolicy {
  readonly storageRoot: string;
  readonly outerIdRangeBase: number;
  readonly xfsProjectIdBase: number;
  readonly quotaDefaults?: StorageConsumption;
}

export interface EnvironmentAllocationRequest {
  readonly userId: string;
  readonly slot: number;
  readonly policy: EnvironmentAllocationPolicy;
  readonly quotaHardLimit?: StorageConsumption;
}

export interface EnvironmentAllocation {
  readonly userId: string;
  readonly slot: number;
  /** Stable instance/storage label only; no host login account is created. */
  readonly environmentName: string;
  readonly outerUidRange: IdRange;
  readonly outerGidRange: IdRange;
  readonly imageBraiUid: number;
  readonly imageBraiGid: number;
  readonly innerSubuidRange: IdRange;
  readonly innerSubgidRange: IdRange;
  readonly xfsProjectId: number;
  readonly dataPath: string;
  readonly quotaHardLimit: StorageConsumption;
}

export type AllocationIssueCode =
  | "ALLOCATION_USER_ID_INVALID"
  | "ALLOCATION_SLOT_INVALID"
  | "ALLOCATION_OUTER_RANGE_INVALID"
  | "ALLOCATION_OUTER_RANGE_MISALIGNED"
  | "ALLOCATION_IMAGE_ID_MAPPING_INVALID"
  | "ALLOCATION_INNER_SUBID_RANGE_INVALID"
  | "ALLOCATION_ENVIRONMENT_NAME_INVALID"
  | "ALLOCATION_PROJECT_ID_INVALID"
  | "ALLOCATION_DATA_PATH_INVALID"
  | "ALLOCATION_DATA_PATH_ESCAPE"
  | "ALLOCATION_QUOTA_INVALID"
  | "ALLOCATION_DUPLICATE_USER_ID"
  | "ALLOCATION_DUPLICATE_SLOT"
  | "ALLOCATION_DUPLICATE_ENVIRONMENT_NAME"
  | "ALLOCATION_DUPLICATE_PROJECT_ID"
  | "ALLOCATION_UID_RANGE_OVERLAP"
  | "ALLOCATION_GID_RANGE_OVERLAP";

export interface AllocationIssue {
  readonly code: AllocationIssueCode;
  readonly allocationIndex: number;
  readonly conflictingAllocationIndex?: number;
  readonly message: string;
}

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer.`);
  }
}

function quotaDefaults(
  policy: EnvironmentAllocationPolicy,
): StorageConsumption {
  return policy.quotaDefaults ?? DEFAULT_USER_QUOTA;
}

function validateQuota(quota: StorageConsumption, description: string): void {
  if (!isValidQuota(quota)) {
    throw new RangeError(`${description} must be positive safe integers.`);
  }
}

function isValidQuota(quota: StorageConsumption): boolean {
  return (
    Number.isSafeInteger(quota.bytes) &&
    quota.bytes > 0 &&
    Number.isSafeInteger(quota.inodes) &&
    quota.inodes > 0
  );
}

function validatePolicy(policy: EnvironmentAllocationPolicy): void {
  assertSafeInteger(policy.outerIdRangeBase, "outerIdRangeBase");
  if (
    policy.outerIdRangeBase !== OUTER_ID_RANGE_BASE ||
    policy.outerIdRangeBase % OUTER_ID_RANGE_SIZE !== 0
  ) {
    throw new RangeError(
      `outerIdRangeBase must equal the canonical host pool start ${OUTER_ID_RANGE_BASE}.`,
    );
  }
  assertSafeInteger(policy.xfsProjectIdBase, "xfsProjectIdBase");
  if (
    policy.xfsProjectIdBase <= 0 ||
    policy.xfsProjectIdBase > MAX_XFS_PROJECT_ID
  ) {
    throw new RangeError("xfsProjectIdBase must be a positive uint32 value.");
  }
  validateQuota(quotaDefaults(policy), "Quota defaults");
}

export function environmentNameForSlot(slot: number): string {
  assertSafeInteger(slot, "slot");
  if (slot < 0) throw new RangeError("slot must be non-negative.");
  return `brai-u-${slot.toString(36)}`;
}

export function allocateEnvironment(
  request: EnvironmentAllocationRequest,
): EnvironmentAllocation {
  validatePolicy(request.policy);
  if (request.userId.trim() === "") {
    throw new RangeError("userId must not be empty.");
  }
  assertSafeInteger(request.slot, "slot");
  if (request.slot < 0 || request.slot > MAX_ALLOCATION_SLOT) {
    throw new RangeError(`slot must be between 0 and ${MAX_ALLOCATION_SLOT}.`);
  }

  const outerStart =
    request.policy.outerIdRangeBase + request.slot * OUTER_ID_RANGE_SIZE;
  const outerEnd = outerStart + OUTER_ID_RANGE_SIZE - 1;
  const xfsProjectId = request.policy.xfsProjectIdBase + request.slot;
  if (!Number.isSafeInteger(outerEnd)) {
    throw new RangeError("Allocated UID/GID range is not a safe integer.");
  }
  if (xfsProjectId > MAX_XFS_PROJECT_ID) {
    throw new RangeError("Allocated XFS project ID exceeds uint32.");
  }

  const environmentName = environmentNameForSlot(request.slot);
  const storageRoot = resolve(request.policy.storageRoot);
  const quota = request.quotaHardLimit ?? quotaDefaults(request.policy);
  validateQuota(quota, "User quota hard limit");
  return {
    userId: request.userId,
    slot: request.slot,
    environmentName,
    outerUidRange: { start: outerStart, count: OUTER_ID_RANGE_SIZE },
    outerGidRange: { start: outerStart, count: OUTER_ID_RANGE_SIZE },
    imageBraiUid: outerStart + IMAGE_BRAI_ID,
    imageBraiGid: outerStart + IMAGE_BRAI_ID,
    innerSubuidRange: {
      start: outerStart + INNER_SUBORDINATE_OFFSET,
      count: INNER_SUBORDINATE_RANGE_SIZE,
    },
    innerSubgidRange: {
      start: outerStart + INNER_SUBORDINATE_OFFSET,
      count: INNER_SUBORDINATE_RANGE_SIZE,
    },
    xfsProjectId,
    dataPath: resolve(storageRoot, environmentName),
    quotaHardLimit: { bytes: quota.bytes, inodes: quota.inodes },
  };
}

function sameRange(left: IdRange, right: IdRange): boolean {
  return left.start === right.start && left.count === right.count;
}

function pushMismatchIssues(
  issues: AllocationIssue[],
  actual: EnvironmentAllocation,
  expected: EnvironmentAllocation,
  index: number,
  policy: EnvironmentAllocationPolicy,
): void {
  const add = (code: AllocationIssueCode, message: string): void => {
    issues.push({ code, allocationIndex: index, message });
  };

  if (actual.userId.trim() === "" || actual.userId !== expected.userId) {
    add("ALLOCATION_USER_ID_INVALID", "Allocation user ID is invalid.");
  }
  if (actual.slot !== expected.slot) {
    add("ALLOCATION_SLOT_INVALID", "Allocation slot is invalid.");
  }
  if (
    actual.outerUidRange.count !== OUTER_ID_RANGE_SIZE ||
    actual.outerGidRange.count !== OUTER_ID_RANGE_SIZE ||
    actual.outerUidRange.start !== actual.outerGidRange.start
  ) {
    add(
      "ALLOCATION_OUTER_RANGE_INVALID",
      `Outer UID/GID ranges must be identical and exactly ${OUTER_ID_RANGE_SIZE} IDs wide.`,
    );
  }
  if (
    actual.outerUidRange.start % OUTER_ID_RANGE_SIZE !== 0 ||
    actual.outerGidRange.start % OUTER_ID_RANGE_SIZE !== 0
  ) {
    add(
      "ALLOCATION_OUTER_RANGE_MISALIGNED",
      `Outer UID/GID starts must be aligned to ${OUTER_ID_RANGE_SIZE}.`,
    );
  }
  if (
    !sameRange(actual.outerUidRange, expected.outerUidRange) ||
    !sameRange(actual.outerGidRange, expected.outerGidRange)
  ) {
    add(
      "ALLOCATION_OUTER_RANGE_INVALID",
      "Outer UID/GID ranges do not match the deterministic slot allocation.",
    );
  }
  if (
    actual.imageBraiUid !== actual.outerUidRange.start + IMAGE_BRAI_ID ||
    actual.imageBraiGid !== actual.outerGidRange.start + IMAGE_BRAI_ID
  ) {
    add(
      "ALLOCATION_IMAGE_ID_MAPPING_INVALID",
      `Image brai UID/GID ${IMAGE_BRAI_ID} must map to outer START+${IMAGE_BRAI_ID}.`,
    );
  }
  if (
    !sameRange(actual.innerSubuidRange, expected.innerSubuidRange) ||
    !sameRange(actual.innerSubgidRange, expected.innerSubgidRange)
  ) {
    add(
      "ALLOCATION_INNER_SUBID_RANGE_INVALID",
      `Inner subordinate ranges must start at START+${INNER_SUBORDINATE_OFFSET} and contain ${INNER_SUBORDINATE_RANGE_SIZE} IDs.`,
    );
  }
  if (
    actual.environmentName !== expected.environmentName ||
    !/^[a-z_][a-z0-9_-]{0,31}$/u.test(actual.environmentName)
  ) {
    add(
      "ALLOCATION_ENVIRONMENT_NAME_INVALID",
      "Environment name does not match the deterministic slot name.",
    );
  }
  if (actual.xfsProjectId !== expected.xfsProjectId) {
    add(
      "ALLOCATION_PROJECT_ID_INVALID",
      "XFS project ID does not match the deterministic slot allocation.",
    );
  }

  const storageRoot = resolve(policy.storageRoot);
  const canonicalDataPath = resolve(actual.dataPath);
  const expectedDataPath = resolve(storageRoot, expected.environmentName);
  if (
    canonicalDataPath !== actual.dataPath ||
    actual.dataPath !== expectedDataPath
  ) {
    add(
      "ALLOCATION_DATA_PATH_INVALID",
      "Data path must be canonical and derived from the storage root and environment name.",
    );
  }
  if (!canonicalDataPath.startsWith(`${storageRoot}/`)) {
    add(
      "ALLOCATION_DATA_PATH_ESCAPE",
      "Data path escapes the configured storage root.",
    );
  }
  if (!isValidQuota(actual.quotaHardLimit)) {
    add(
      "ALLOCATION_QUOTA_INVALID",
      "Allocation hard limit must contain positive safe integers.",
    );
  }
}

function rangesOverlap(left: IdRange, right: IdRange): boolean {
  const leftEnd = left.start + left.count;
  const rightEnd = right.start + right.count;
  return left.start < rightEnd && right.start < leftEnd;
}

export function auditEnvironmentAllocations(
  allocations: readonly EnvironmentAllocation[],
  policy: EnvironmentAllocationPolicy,
): readonly AllocationIssue[] {
  validatePolicy(policy);
  const issues: AllocationIssue[] = [];

  allocations.forEach((allocation, index) => {
    let expected: EnvironmentAllocation;
    try {
      expected = allocateEnvironment({
        userId: allocation.userId,
        slot: allocation.slot,
        policy,
        quotaHardLimit: isValidQuota(allocation.quotaHardLimit)
          ? allocation.quotaHardLimit
          : quotaDefaults(policy),
      });
    } catch (error: unknown) {
      issues.push({
        code: "ALLOCATION_SLOT_INVALID",
        allocationIndex: index,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    pushMismatchIssues(issues, allocation, expected, index, policy);
  });

  for (let left = 0; left < allocations.length; left += 1) {
    const leftAllocation = allocations[left];
    if (leftAllocation === undefined) continue;
    for (let right = left + 1; right < allocations.length; right += 1) {
      const rightAllocation = allocations[right];
      if (rightAllocation === undefined) continue;
      const addConflict = (
        code: AllocationIssueCode,
        message: string,
      ): void => {
        issues.push({
          code,
          allocationIndex: right,
          conflictingAllocationIndex: left,
          message,
        });
      };
      if (leftAllocation.userId === rightAllocation.userId) {
        addConflict("ALLOCATION_DUPLICATE_USER_ID", "Duplicate user ID.");
      }
      if (leftAllocation.slot === rightAllocation.slot) {
        addConflict("ALLOCATION_DUPLICATE_SLOT", "Duplicate allocation slot.");
      }
      if (leftAllocation.environmentName === rightAllocation.environmentName) {
        addConflict(
          "ALLOCATION_DUPLICATE_ENVIRONMENT_NAME",
          "Duplicate environment name.",
        );
      }
      if (leftAllocation.xfsProjectId === rightAllocation.xfsProjectId) {
        addConflict(
          "ALLOCATION_DUPLICATE_PROJECT_ID",
          "Duplicate XFS project ID.",
        );
      }
      if (
        rangesOverlap(
          leftAllocation.outerUidRange,
          rightAllocation.outerUidRange,
        )
      ) {
        addConflict(
          "ALLOCATION_UID_RANGE_OVERLAP",
          "Outer UID ranges overlap.",
        );
      }
      if (
        rangesOverlap(
          leftAllocation.outerGidRange,
          rightAllocation.outerGidRange,
        )
      ) {
        addConflict(
          "ALLOCATION_GID_RANGE_OVERLAP",
          "Outer GID ranges overlap.",
        );
      }
    }
  }

  return issues;
}
