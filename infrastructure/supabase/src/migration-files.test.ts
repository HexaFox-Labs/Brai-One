import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BRAI_FACTORY_MIGRATION_FILE_PATTERN,
  readMigrationFiles,
} from "./migration-files.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("readMigrationFiles", () => {
  it("sorts migration files and calculates stable checksums", async () => {
    const directory = await mkdtemp(join(tmpdir(), "brai-migrations-"));
    temporaryDirectories.push(directory);

    await writeFile(join(directory, "0002_second.sql"), "SELECT 2;\n");
    await writeFile(join(directory, "0001_first.sql"), "SELECT 1;\n");
    await writeFile(
      join(directory, "20260716153000_generated.sql"),
      "SELECT 3;\n",
    );
    await writeFile(join(directory, "README.md"), "ignored");

    const migrations = await readMigrationFiles(directory);

    expect(migrations.map((migration) => migration.version)).toEqual([
      "0001_first.sql",
      "0002_second.sql",
      "20260716153000_generated.sql",
    ]);
    expect(migrations[0]?.checksum).toBe(
      createHash("sha256").update("SELECT 1;\n").digest("hex"),
    );
  });

  it("keeps service-owned access migrations out of the Factory ledger", async () => {
    const directory = await mkdtemp(join(tmpdir(), "brai-migrations-"));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, "0001_brai_factory.sql"), "SELECT 1;\n");
    await writeFile(
      join(directory, "0002_brai_factory_limits.sql"),
      "SELECT 2;\n",
    );
    await writeFile(join(directory, "0003_brai_access.sql"), "SELECT 3;\n");

    const migrations = await readMigrationFiles(
      directory,
      BRAI_FACTORY_MIGRATION_FILE_PATTERN,
    );
    expect(migrations.map((migration) => migration.version)).toEqual([
      "0001_brai_factory.sql",
      "0002_brai_factory_limits.sql",
    ]);
  });

  it("keeps the production Factory set exactly at its two owned migrations", async () => {
    const migrations = await readMigrationFiles(
      undefined,
      BRAI_FACTORY_MIGRATION_FILE_PATTERN,
    );
    expect(migrations.map((migration) => migration.version)).toEqual([
      "0001_brai_factory.sql",
      "0002_brai_factory_runtime_limits.sql",
    ]);
  });

  it("keeps the Factory runtime bounded by database-side limits", async () => {
    const migration = await readFile(
      new URL(
        "../migrations/0002_brai_factory_runtime_limits.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain(
      "ALTER ROLE brai_factory_runtime CONNECTION LIMIT 10",
    );
    expect(migration).toContain("SET statement_timeout TO '4s'");
    expect(migration).toContain("SET lock_timeout TO '2s'");
    expect(migration).toContain(
      "SET idle_in_transaction_session_timeout TO '5s'",
    );
  });
});
