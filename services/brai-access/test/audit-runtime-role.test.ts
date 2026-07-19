import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { assertAccessRuntimeRoleIsolation } from "../src/audit-runtime-role.js";

type AuditState = {
  attributes?: boolean;
  tablePrivileges?: boolean;
  timeouts?: boolean;
  violation?: string;
};

function auditClient(state: AuditState = {}): Pick<PoolClient, "query"> {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("rolconnlimit = 10")) {
      return { rows: [{ allowed: state.attributes ?? true }] };
    }
    if (sql.includes("pg_catalog.pg_db_role_setting")) {
      return { rows: [{ allowed: state.timeouts ?? true }] };
    }
    if (sql.includes("WITH expected(relname")) {
      return { rows: [{ allowed: state.tablePrivileges ?? true }] };
    }
    if (sql.includes("count(*)::text AS violation_count")) {
      return {
        rows: [
          {
            violation_count:
              state.violation && sql.includes(state.violation) ? "1" : "0",
          },
        ],
      };
    }
    return { rows: [{ allowed: true }] };
  });

  return { query } as unknown as Pick<PoolClient, "query">;
}

describe("brai-access runtime-role audit", () => {
  it("accepts only the bounded LOGIN role with exact grants", async () => {
    await expect(
      assertAccessRuntimeRoleIsolation(auditClient()),
    ).resolves.toBeUndefined();
  });

  it("rejects unsafe role attributes and timeout drift", async () => {
    await expect(
      assertAccessRuntimeRoleIsolation(
        auditClient({ attributes: false, timeouts: false }),
      ),
    ).rejects.toThrow(/unsafe_role_attributes, invalid_role_timeouts/);
  });

  it("rejects any table grant outside the exact matrix", async () => {
    await expect(
      assertAccessRuntimeRoleIsolation(auditClient({ tablePrivileges: false })),
    ).rejects.toThrow(/invalid_table_privileges/);
  });

  it("rejects executable brai-access routines", async () => {
    await expect(
      assertAccessRuntimeRoleIsolation(
        auditClient({ violation: "pg_catalog.pg_proc" }),
      ),
    ).rejects.toThrow(/unexpected_routine_execute/);
  });
});
