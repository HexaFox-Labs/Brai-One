import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { assertAccessMigratorRoleIsolation } from "../src/audit-migration-role.js";

type AuditState = {
  attributes?: boolean;
  roleSettings?: boolean;
  schemaOwner?: boolean;
  violation?: string;
};

function auditClient(state: AuditState = {}): Pick<PoolClient, "query"> {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("pg_catalog.pg_authid")) {
      return { rows: [{ allowed: state.attributes ?? true }] };
    }
    if (sql.includes("pg_catalog.pg_db_role_setting")) {
      return { rows: [{ allowed: state.roleSettings ?? true }] };
    }
    if (
      sql.includes("namespace.nspname = 'brai_access'") &&
      sql.includes("namespace.nspowner")
    ) {
      return { rows: [{ allowed: state.schemaOwner ?? true }] };
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

describe("brai-access migration-role audit", () => {
  it("accepts the one-connection owner of only brai_access", async () => {
    await expect(
      assertAccessMigratorRoleIsolation(auditClient(), true),
    ).resolves.toBeUndefined();
  });

  it("accepts the bounded bootstrap state before LOGIN is enabled", async () => {
    await expect(
      assertAccessMigratorRoleIsolation(auditClient(), false),
    ).resolves.toBeUndefined();
  });

  it("rejects unsafe attributes, settings and schema ownership", async () => {
    await expect(
      assertAccessMigratorRoleIsolation(
        auditClient({
          attributes: false,
          roleSettings: false,
          schemaOwner: false,
        }),
        true,
      ),
    ).rejects.toThrow(
      /unsafe_role_attributes, invalid_role_settings, schema_not_owned/,
    );
  });

  it("rejects memberships and foreign access", async () => {
    await expect(
      assertAccessMigratorRoleIsolation(
        auditClient({ violation: "pg_catalog.pg_auth_members" }),
        true,
      ),
    ).rejects.toThrow(/unexpected_role_membership/);
  });
});
