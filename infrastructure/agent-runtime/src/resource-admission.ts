export const BRAI_USERS_SLICE = "brai-users.slice";

export interface AggregateResourceLimits {
  readonly memoryMaxBytes: number;
  readonly memorySwapMaxBytes: number;
  readonly cpuQuotaPercent: number;
  readonly tasksMax: number;
}

export interface AggregateResourceUsage {
  readonly memoryBytes: number;
  readonly memorySwapBytes: number;
  readonly tasks: number;
}

/** Trusted measurements from the host cgroup manager, never from an agent. */
export interface AggregateResourceBoundaryFacts {
  readonly measured: boolean;
  readonly active: boolean;
  readonly sliceName: string;
  readonly limits: AggregateResourceLimits | null;
  readonly usage: AggregateResourceUsage | null;
}

/**
 * Host-owned policy rendered into the slice unit and re-read for admission.
 * Headroom is a point-in-time launch gate, not a reservation.
 */
export interface AggregateResourcePolicy {
  readonly sliceName: typeof BRAI_USERS_SLICE;
  readonly limits: AggregateResourceLimits;
  readonly minimumLaunchHeadroom: AggregateResourceUsage;
}

export interface AggregateResourceCapacity {
  readonly memoryBytes: number;
  readonly memorySwapBytes: number;
  readonly tasks: number;
}

export type AggregateResourceDenialCode =
  | "aggregate_resource_boundary_unmeasured"
  | "aggregate_resource_boundary_inactive"
  | "aggregate_resource_policy_mismatch"
  | "aggregate_memory_capacity_exhausted"
  | "aggregate_swap_capacity_exhausted"
  | "aggregate_tasks_capacity_exhausted";

export type AggregateResourceAdmissionResult =
  | {
      readonly allowed: true;
      readonly capacity: AggregateResourceCapacity;
    }
  | {
      readonly allowed: false;
      readonly code: AggregateResourceDenialCode;
      readonly capacity: AggregateResourceCapacity | null;
    };

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

function validateLimits(limits: AggregateResourceLimits, name: string): void {
  assertNonNegativeInteger(limits.memoryMaxBytes, `${name}.memoryMaxBytes`);
  assertNonNegativeInteger(
    limits.memorySwapMaxBytes,
    `${name}.memorySwapMaxBytes`,
  );
  assertNonNegativeInteger(limits.tasksMax, `${name}.tasksMax`);
  if (
    limits.memoryMaxBytes === 0 ||
    limits.tasksMax === 0 ||
    !Number.isFinite(limits.cpuQuotaPercent) ||
    limits.cpuQuotaPercent <= 0
  ) {
    throw new RangeError(`${name} limits must be finite and positive.`);
  }
}

function validateUsage(usage: AggregateResourceUsage, name: string): void {
  assertNonNegativeInteger(usage.memoryBytes, `${name}.memoryBytes`);
  assertNonNegativeInteger(usage.memorySwapBytes, `${name}.memorySwapBytes`);
  assertNonNegativeInteger(usage.tasks, `${name}.tasks`);
}

function limitsEqual(
  left: AggregateResourceLimits,
  right: AggregateResourceLimits,
): boolean {
  return (
    left.memoryMaxBytes === right.memoryMaxBytes &&
    left.memorySwapMaxBytes === right.memorySwapMaxBytes &&
    left.cpuQuotaPercent === right.cpuQuotaPercent &&
    left.tasksMax === right.tasksMax
  );
}

function remaining(limit: number, used: number): number {
  return Math.max(0, limit - used);
}

/**
 * Fail-closed launch gate for the kernel-enforced aggregate sandbox slice.
 *
 * The trusted launcher must call this with a fresh host measurement while
 * holding its host-wide launch fence. The hard slice limits remain the actual
 * race-safe boundary. This function neither examines nor reserves disk space.
 */
export function admitSandboxLaunchResources(
  policy: AggregateResourcePolicy,
  facts: AggregateResourceBoundaryFacts,
): AggregateResourceAdmissionResult {
  validateLimits(policy.limits, "policy.limits");
  validateUsage(policy.minimumLaunchHeadroom, "minimumLaunchHeadroom");

  if (!facts.measured || facts.limits === null || facts.usage === null) {
    return {
      allowed: false,
      code: "aggregate_resource_boundary_unmeasured",
      capacity: null,
    };
  }
  if (!facts.active) {
    return {
      allowed: false,
      code: "aggregate_resource_boundary_inactive",
      capacity: null,
    };
  }
  validateLimits(facts.limits, "facts.limits");
  validateUsage(facts.usage, "facts.usage");
  if (
    facts.sliceName !== policy.sliceName ||
    !limitsEqual(facts.limits, policy.limits)
  ) {
    return {
      allowed: false,
      code: "aggregate_resource_policy_mismatch",
      capacity: null,
    };
  }

  const capacity = {
    memoryBytes: remaining(
      facts.limits.memoryMaxBytes,
      facts.usage.memoryBytes,
    ),
    memorySwapBytes: remaining(
      facts.limits.memorySwapMaxBytes,
      facts.usage.memorySwapBytes,
    ),
    tasks: remaining(facts.limits.tasksMax, facts.usage.tasks),
  };
  if (
    facts.usage.memoryBytes > facts.limits.memoryMaxBytes ||
    policy.minimumLaunchHeadroom.memoryBytes > capacity.memoryBytes
  ) {
    return {
      allowed: false,
      code: "aggregate_memory_capacity_exhausted",
      capacity,
    };
  }
  if (
    facts.usage.memorySwapBytes > facts.limits.memorySwapMaxBytes ||
    policy.minimumLaunchHeadroom.memorySwapBytes > capacity.memorySwapBytes
  ) {
    return {
      allowed: false,
      code: "aggregate_swap_capacity_exhausted",
      capacity,
    };
  }
  if (
    facts.usage.tasks > facts.limits.tasksMax ||
    policy.minimumLaunchHeadroom.tasks > capacity.tasks
  ) {
    return {
      allowed: false,
      code: "aggregate_tasks_capacity_exhausted",
      capacity,
    };
  }
  return { allowed: true, capacity };
}
