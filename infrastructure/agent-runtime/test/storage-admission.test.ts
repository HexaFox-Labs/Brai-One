import { describe, expect, it } from "vitest";
import {
  admitStorageWrite,
  classifyStorageErrno,
} from "../src/storage-admission.js";

function input() {
  return {
    quota: {
      hardLimit: { bytes: 500, inodes: 500 },
      used: { bytes: 100, inodes: 100 },
    },
    pool: {
      total: { bytes: 1_000, inodes: 1_000 },
      available: { bytes: 300, inodes: 300 },
    },
    requested: { bytes: 10, inodes: 1 },
  } as const;
}

describe("storage admission", () => {
  it("allows a platform-mediated operation through both hard-quota and pool gates", () => {
    expect(admitStorageWrite(input())).toMatchObject({ allowed: true });
  });

  it("reports a per-user hard quota violation distinctly", () => {
    const base = input();
    expect(
      admitStorageWrite({
        ...base,
        quota: { ...base.quota, used: { bytes: 495, inodes: 100 } },
      }),
    ).toMatchObject({ allowed: false, code: "storage_quota_exceeded" });
  });

  it("reports when a platform operation would cross the 10% free-space gate", () => {
    const base = input();
    expect(
      admitStorageWrite({
        ...base,
        pool: { ...base.pool, available: { bytes: 105, inodes: 300 } },
      }),
    ).toMatchObject({ allowed: false, code: "storage_pool_full" });
  });

  it("does not reserve physical capacity when a hard limit is assigned", () => {
    const base = input();
    const smallQuota = admitStorageWrite({
      ...base,
      quota: { ...base.quota, hardLimit: { bytes: 200, inodes: 200 } },
    });
    const largeQuota = admitStorageWrite({
      ...base,
      quota: { ...base.quota, hardLimit: { bytes: 900, inodes: 900 } },
    });
    expect(smallQuota.capacity.poolGateHeadroom).toEqual(
      largeQuota.capacity.poolGateHeadroom,
    );
  });

  it("maps wrapped kernel quota/pool errors without claiming to intercept commands", () => {
    expect(classifyStorageErrno("EDQUOT")).toBe("storage_quota_exceeded");
    expect(
      classifyStorageErrno("ENOSPC", { projectQuotaExhausted: true }),
    ).toBe("storage_quota_exceeded");
    expect(classifyStorageErrno("ENOSPC")).toBe("storage_pool_full");
    expect(classifyStorageErrno("EIO")).toBeNull();
  });
});
