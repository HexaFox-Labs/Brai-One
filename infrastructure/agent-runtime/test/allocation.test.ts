import { describe, expect, it } from "vitest";
import {
  allocateEnvironment,
  auditEnvironmentAllocations,
  DEFAULT_USER_QUOTA,
  IMAGE_BRAI_ID,
  INNER_SUBORDINATE_OFFSET,
  INNER_SUBORDINATE_RANGE_SIZE,
  OUTER_ID_RANGE_SIZE,
  type EnvironmentAllocationPolicy,
} from "../src/allocation.js";

const policy: EnvironmentAllocationPolicy = {
  storageRoot: "/srv/brai-user-data",
  outerIdRangeBase: 1_879_048_192,
  xfsProjectIdBase: 10_000,
};

describe("environment allocation", () => {
  it("is stable and maps the exact outer and nested ID ranges", () => {
    const request = { userId: "user-42", slot: 3, policy } as const;
    const first = allocateEnvironment(request);
    const second = allocateEnvironment(request);

    expect(first).toEqual(second);
    expect(first.outerUidRange).toEqual({
      start: 1_879_048_192 + 3 * OUTER_ID_RANGE_SIZE,
      count: OUTER_ID_RANGE_SIZE,
    });
    expect(first.outerGidRange).toEqual(first.outerUidRange);
    expect(first.imageBraiUid).toBe(first.outerUidRange.start + IMAGE_BRAI_ID);
    expect(first.imageBraiGid).toBe(first.outerGidRange.start + IMAGE_BRAI_ID);
    expect(first.innerSubuidRange).toEqual({
      start: first.outerUidRange.start + INNER_SUBORDINATE_OFFSET,
      count: INNER_SUBORDINATE_RANGE_SIZE,
    });
    expect(first.innerSubgidRange).toEqual(first.innerSubuidRange);
    expect(first.environmentName).toBe("brai-u-3");
    expect(first.xfsProjectId).toBe(10_003);
    expect(first.dataPath).toBe("/srv/brai-user-data/brai-u-3");
    expect(first.quotaHardLimit).toEqual(DEFAULT_USER_QUOTA);
  });

  it("accepts non-overlapping allocations", () => {
    const allocations = [
      allocateEnvironment({ userId: "user-a", slot: 0, policy }),
      allocateEnvironment({ userId: "user-b", slot: 1, policy }),
    ];
    expect(auditEnvironmentAllocations(allocations, policy)).toEqual([]);
  });

  it("accepts different persisted hard limits for different users", () => {
    const allocations = [
      allocateEnvironment({
        userId: "user-a",
        slot: 0,
        policy,
        quotaHardLimit: { bytes: 2_000_000, inodes: 20_000 },
      }),
      allocateEnvironment({
        userId: "user-b",
        slot: 1,
        policy,
        quotaHardLimit: { bytes: 9_000_000, inodes: 90_000 },
      }),
    ];
    expect(auditEnvironmentAllocations(allocations, policy)).toEqual([]);
    expect(allocations.map(({ quotaHardLimit }) => quotaHardLimit)).toEqual([
      { bytes: 2_000_000, inodes: 20_000 },
      { bytes: 9_000_000, inodes: 90_000 },
    ]);
  });

  it("detects overlapping ranges, duplicate account and project IDs", () => {
    const first = allocateEnvironment({ userId: "user-a", slot: 0, policy });
    const originalSecond = allocateEnvironment({
      userId: "user-b",
      slot: 1,
      policy,
    });
    const second = {
      ...originalSecond,
      environmentName: first.environmentName,
      outerUidRange: first.outerUidRange,
      outerGidRange: first.outerGidRange,
      xfsProjectId: first.xfsProjectId,
    };
    const codes = auditEnvironmentAllocations([first, second], policy).map(
      ({ code }) => code,
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "ALLOCATION_DUPLICATE_ENVIRONMENT_NAME",
        "ALLOCATION_DUPLICATE_PROJECT_ID",
        "ALLOCATION_UID_RANGE_OVERLAP",
        "ALLOCATION_GID_RANGE_OVERLAP",
      ]),
    );
  });

  it("detects path escape and quota-default drift", () => {
    const allocation = allocateEnvironment({
      userId: "user-a",
      slot: 0,
      policy,
    });
    const invalid = {
      ...allocation,
      dataPath: "/tmp/escaped-user-data",
      quotaHardLimit: { bytes: 0, inodes: 0 },
    };
    const codes = auditEnvironmentAllocations([invalid], policy).map(
      ({ code }) => code,
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "ALLOCATION_DATA_PATH_INVALID",
        "ALLOCATION_DATA_PATH_ESCAPE",
        "ALLOCATION_QUOTA_INVALID",
      ]),
    );
  });

  it("rejects any non-canonical outer range base", () => {
    expect(() =>
      allocateEnvironment({
        userId: "user-a",
        slot: 0,
        policy: { ...policy, outerIdRangeBase: 1_000_000 },
      }),
    ).toThrow("canonical host pool start");
  });

  it("bounds one v1 host pool to 2047 persistent user environments", () => {
    expect(
      allocateEnvironment({ userId: "last-user", slot: 2_046, policy })
        .outerUidRange,
    ).toEqual({ start: 2_147_221_504, count: OUTER_ID_RANGE_SIZE });
    expect(() =>
      allocateEnvironment({ userId: "overflow", slot: 2_047, policy }),
    ).toThrow("between 0 and 2046");
  });
});
