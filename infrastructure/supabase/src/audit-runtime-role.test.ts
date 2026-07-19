import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { assertRuntimeRoleIsolation } from "./audit-runtime-role.js";

type AuditState = {
  attributes?: boolean;
  timeouts?: boolean;
};

function auditClient(state: AuditState = {}): PoolClient {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("rolconnlimit = 10")) {
      return { rows: [{ allowed: state.attributes ?? true }] };
    }

    if (sql.includes("pg_catalog.pg_db_role_setting")) {
      return { rows: [{ allowed: state.timeouts ?? true }] };
    }

    if (sql.includes("count(*)::text AS violation_count")) {
      return { rows: [{ violation_count: "0" }] };
    }

    return { rows: [{ allowed: true }] };
  });

  return { query } as unknown as PoolClient;
}

describe("assertRuntimeRoleIsolation", () => {
  it("accepts a bounded role with mandatory server-side timeouts", async () => {
    await expect(
      assertRuntimeRoleIsolation(auditClient()),
    ).resolves.toBeUndefined();
  });

  it("rejects a role without the 10-connection limit", async () => {
    await expect(
      assertRuntimeRoleIsolation(auditClient({ attributes: false })),
    ).rejects.toThrow(/unsafe_role_attributes/);
  });

  it("rejects missing or overridden role timeouts", async () => {
    await expect(
      assertRuntimeRoleIsolation(auditClient({ timeouts: false })),
    ).rejects.toThrow(/invalid_role_timeouts/);
  });
});
