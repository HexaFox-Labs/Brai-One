import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { bootstrapAccessMigratorRole } from "../src/bootstrap-migration-role.js";
import { readAccessMigrationFiles } from "../src/migration-files.js";

function poolWithClient(client: PoolClient): Pool {
  return {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
}

async function bootstrapClient(checksumDrift = false): Promise<PoolClient> {
  const migrations = await readAccessMigrationFiles();
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("to_regclass('brai_access.schema_migrations')")) {
      return {
        rows: [{ ledger: "brai_access.schema_migrations" }],
      };
    }
    if (sql.includes("SELECT version, checksum")) {
      return {
        rows: migrations.map((migration, index) => ({
          version: migration.version,
          checksum:
            checksumDrift && index === 0 ? "0".repeat(64) : migration.checksum,
        })),
      };
    }
    if (sql.includes("rolcanlogin AS can_login")) {
      return { rows: [] };
    }
    if (sql.includes("SELECT count(*)::text AS count")) {
      return { rows: [{ count: "0" }] };
    }
    if (sql.includes(" AS statement")) {
      return { rows: [] };
    }
    if (sql.includes("count(*)::text AS violation_count")) {
      return { rows: [{ violation_count: "0" }] };
    }
    return { rows: [{ allowed: true }], rowCount: 1 };
  });
  return { query, release: vi.fn() } as unknown as PoolClient;
}

describe("brai-access migrator ownership bootstrap", () => {
  it("checks the complete ledger before creating the bounded role", async () => {
    const client = await bootstrapClient();

    await expect(
      bootstrapAccessMigratorRole(poolWithClient(client)),
    ).resolves.toBeUndefined();

    const statements = vi
      .mocked(client.query)
      .mock.calls.map((call) => String(call[0]));
    expect(statements).toContain("BEGIN");
    expect(statements.join("\n")).toContain("CREATE ROLE brai_access_migrator");
    expect(statements.join("\n")).toContain(
      "REVOKE brai_access_migrator FROM %I",
    );
    expect(statements.join("\n")).toContain(
      "ALTER SCHEMA brai_access OWNER TO brai_access_migrator",
    );
    expect(statements).toContain("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back before ownership handoff on checksum drift", async () => {
    const client = await bootstrapClient(true);

    await expect(
      bootstrapAccessMigratorRole(poolWithClient(client)),
    ).rejects.toThrow(/checksum differs from source/);

    const statements = vi
      .mocked(client.query)
      .mock.calls.map((call) => String(call[0]));
    expect(statements).toContain("ROLLBACK");
    expect(statements.join("\n")).not.toContain(
      "CREATE ROLE brai_access_migrator",
    );
    expect(client.release).toHaveBeenCalledOnce();
  });
});
