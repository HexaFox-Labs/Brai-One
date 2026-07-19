import { describe, expect, it } from "vitest";
import {
  admitSandboxLaunchResources,
  type AggregateResourceBoundaryFacts,
  type AggregateResourcePolicy,
} from "../src/resource-admission.js";

const policy: AggregateResourcePolicy = {
  sliceName: "brai-users.slice",
  limits: {
    memoryMaxBytes: 1_000,
    memorySwapMaxBytes: 200,
    cpuQuotaPercent: 600,
    tasksMax: 100,
  },
  minimumLaunchHeadroom: {
    memoryBytes: 100,
    memorySwapBytes: 10,
    tasks: 5,
  },
};

function facts(): AggregateResourceBoundaryFacts {
  return {
    measured: true,
    active: true,
    sliceName: "brai-users.slice",
    limits: policy.limits,
    usage: {
      memoryBytes: 500,
      memorySwapBytes: 20,
      tasks: 25,
    },
  };
}

describe("aggregate sandbox resource admission", () => {
  it("allows launch only through the measured active aggregate boundary", () => {
    expect(admitSandboxLaunchResources(policy, facts())).toEqual({
      allowed: true,
      capacity: {
        memoryBytes: 500,
        memorySwapBytes: 180,
        tasks: 75,
      },
    });
  });

  it("fails closed when aggregate facts are unmeasured or inactive", () => {
    expect(
      admitSandboxLaunchResources(policy, {
        ...facts(),
        measured: false,
        limits: null,
        usage: null,
      }),
    ).toMatchObject({
      allowed: false,
      code: "aggregate_resource_boundary_unmeasured",
    });
    expect(
      admitSandboxLaunchResources(policy, { ...facts(), active: false }),
    ).toMatchObject({
      allowed: false,
      code: "aggregate_resource_boundary_inactive",
    });
  });

  it("rejects a slice whose measured kernel caps differ from host policy", () => {
    expect(
      admitSandboxLaunchResources(policy, {
        ...facts(),
        limits: { ...policy.limits, memoryMaxBytes: 2_000 },
      }),
    ).toMatchObject({
      allowed: false,
      code: "aggregate_resource_policy_mismatch",
    });
  });

  it.each([
    [
      "memory",
      { memoryBytes: 950, memorySwapBytes: 20, tasks: 25 },
      "aggregate_memory_capacity_exhausted",
    ],
    [
      "swap",
      { memoryBytes: 500, memorySwapBytes: 195, tasks: 25 },
      "aggregate_swap_capacity_exhausted",
    ],
    [
      "tasks",
      { memoryBytes: 500, memorySwapBytes: 20, tasks: 97 },
      "aggregate_tasks_capacity_exhausted",
    ],
  ] as const)(
    "rejects exhausted aggregate %s headroom",
    (_name, usage, code) => {
      expect(
        admitSandboxLaunchResources(policy, { ...facts(), usage }),
      ).toMatchObject({ allowed: false, code });
    },
  );
});
