import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { readAccessMigrationFiles } from "../src/migration-files.js";
import {
  assertAccessMigrationConnectionRole,
  runAccessMigrations,
} from "../src/migrate.js";

function poolWithClient(client: PoolClient): Pool {
  return {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
}

describe("brai-access owned migration runner", () => {
  it("discovers only the service migration directory", async () => {
    const migrations = await readAccessMigrationFiles();
    expect(migrations.map((migration) => migration.version)).toEqual([
      "0001_initial.sql",
      "0002_typed_runtime_lifecycle.sql",
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(migrations[0]?.sql).toContain(
      "CREATE SCHEMA IF NOT EXISTS brai_access",
    );
  });

  it("uses its own lock and brai_access schema ledger", async () => {
    const query = vi.fn(
      async (sql: string, _parameters?: readonly unknown[]) => {
        if (sql.includes("SELECT version, checksum")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      },
    );
    const client = {
      query,
      release: vi.fn(),
    } as unknown as PoolClient;

    await expect(runAccessMigrations(poolWithClient(client))).resolves.toBe(2);
    const statements = query.mock.calls.map((call) => String(call[0]));
    expect(statements).toContain("BEGIN");
    expect(statements).toContain("COMMIT");
    expect(
      query.mock.calls.some(
        (call) =>
          Array.isArray(call[1]) &&
          call[1].includes("brai-new:brai-access:migrations"),
      ),
    ).toBe(true);
    expect(statements.join("\n")).toContain("brai_access.schema_migrations");
    expect(statements.join("\n")).not.toContain(
      "brai_factory.schema_migrations",
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back without recording a partially applied migration", async () => {
    const query = vi.fn(
      async (sql: string, _parameters?: readonly unknown[]) => {
        if (sql.includes("SELECT version, checksum")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("CREATE ROLE brai_access_runtime")) {
          throw new Error("migration failed");
        }
        return { rows: [], rowCount: 1 };
      },
    );
    const client = {
      query,
      release: vi.fn(),
    } as unknown as PoolClient;

    await expect(runAccessMigrations(poolWithClient(client))).rejects.toThrow(
      "migration failed",
    );
    expect(query.mock.calls.map((call) => call[0])).toContain("ROLLBACK");
    expect(query.mock.calls.map((call) => String(call[0]))).not.toContain(
      expect.stringContaining(
        "INSERT INTO brai_access.schema_migrations (version, checksum)",
      ),
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rejects an administrator connection on the regular migration path", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ current_role: "postgres", session_role: "postgres" }],
      }),
      release: vi.fn(),
    } as unknown as PoolClient;

    await expect(
      assertAccessMigrationConnectionRole(poolWithClient(client)),
    ).rejects.toThrow(/dedicated brai_access_migrator/);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("accepts only the dedicated migrator connection", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            current_role: "brai_access_migrator",
            session_role: "brai_access_migrator",
          },
        ],
      }),
      release: vi.fn(),
    } as unknown as PoolClient;

    await expect(
      assertAccessMigrationConnectionRole(poolWithClient(client)),
    ).resolves.toBeUndefined();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rejects an administrator session that only SET ROLE to migrator", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            current_role: "brai_access_migrator",
            session_role: "postgres",
          },
        ],
      }),
      release: vi.fn(),
    } as unknown as PoolClient;

    await expect(
      assertAccessMigrationConnectionRole(poolWithClient(client)),
    ).rejects.toThrow(/dedicated brai_access_migrator/);
  });
});
