export const STORAGE_GATE_FREE_FRACTION = 0.1;

export type StorageDenialCode = "storage_quota_exceeded" | "storage_pool_full";

export interface StorageConsumption {
  readonly bytes: number;
  readonly inodes: number;
}

export interface UserQuotaState {
  readonly hardLimit: StorageConsumption;
  readonly used: StorageConsumption;
}

export interface StoragePoolState {
  readonly total: StorageConsumption;
  readonly available: StorageConsumption;
}

export interface StorageAdmissionInput {
  readonly quota: UserQuotaState;
  readonly pool: StoragePoolState;
  readonly requested: StorageConsumption;
  readonly gateFreeFraction?: number;
}

export interface StorageAdmissionCapacity {
  readonly userRemaining: StorageConsumption;
  readonly poolGateHeadroom: StorageConsumption;
}

export type StorageAdmissionResult =
  | {
      readonly allowed: true;
      readonly capacity: StorageAdmissionCapacity;
    }
  | {
      readonly allowed: false;
      readonly code: StorageDenialCode;
      readonly capacity: StorageAdmissionCapacity;
    };

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

function validateConsumption(value: StorageConsumption, name: string): void {
  assertNonNegativeInteger(value.bytes, `${name}.bytes`);
  assertNonNegativeInteger(value.inodes, `${name}.inodes`);
}

function remaining(limit: number, used: number): number {
  return Math.max(0, limit - used);
}

/**
 * Best-effort gate for platform-mediated launch/build/provision operations.
 * It cannot intercept arbitrary guest writes and does not reserve pool space.
 */
export function admitStorageWrite(
  input: StorageAdmissionInput,
): StorageAdmissionResult {
  validateConsumption(input.quota.hardLimit, "quota.hardLimit");
  validateConsumption(input.quota.used, "quota.used");
  validateConsumption(input.pool.total, "pool.total");
  validateConsumption(input.pool.available, "pool.available");
  validateConsumption(input.requested, "requested");

  const gateFreeFraction = input.gateFreeFraction ?? STORAGE_GATE_FREE_FRACTION;
  if (
    !Number.isFinite(gateFreeFraction) ||
    gateFreeFraction < 0 ||
    gateFreeFraction >= 1
  ) {
    throw new RangeError("gateFreeFraction must be in the interval [0, 1).");
  }
  if (
    input.pool.available.bytes > input.pool.total.bytes ||
    input.pool.available.inodes > input.pool.total.inodes
  ) {
    throw new RangeError("Pool availability cannot exceed pool capacity.");
  }

  const userRemaining = {
    bytes: remaining(input.quota.hardLimit.bytes, input.quota.used.bytes),
    inodes: remaining(input.quota.hardLimit.inodes, input.quota.used.inodes),
  };
  const poolGateHeadroom = {
    bytes: remaining(
      input.pool.available.bytes,
      Math.ceil(input.pool.total.bytes * gateFreeFraction),
    ),
    inodes: remaining(
      input.pool.available.inodes,
      Math.ceil(input.pool.total.inodes * gateFreeFraction),
    ),
  };
  const capacity = { userRemaining, poolGateHeadroom };

  if (
    input.requested.bytes > userRemaining.bytes ||
    input.requested.inodes > userRemaining.inodes
  ) {
    return { allowed: false, code: "storage_quota_exceeded", capacity };
  }
  if (
    input.requested.bytes > poolGateHeadroom.bytes ||
    input.requested.inodes > poolGateHeadroom.inodes
  ) {
    return { allowed: false, code: "storage_pool_full", capacity };
  }
  return { allowed: true, capacity };
}

export interface StorageErrnoContext {
  /**
   * Fresh trusted XFS measurement taken after the failed wrapped operation.
   * XFS project-quota exhaustion can surface as ENOSPC, so errno alone is not
   * sufficient to distinguish the project ceiling from the shared pool.
   */
  readonly projectQuotaExhausted?: boolean;
}

/** Maps kernel storage failures only where the platform wraps the operation. */
export function classifyStorageErrno(
  errno: string,
  context: StorageErrnoContext = {},
): StorageDenialCode | null {
  if (errno === "EDQUOT") return "storage_quota_exceeded";
  if (errno === "ENOSPC" && context.projectQuotaExhausted === true) {
    return "storage_quota_exceeded";
  }
  if (errno === "ENOSPC") return "storage_pool_full";
  return null;
}
