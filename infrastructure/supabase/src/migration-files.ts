import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type MigrationFile = {
  version: string;
  checksum: string;
  sql: string;
};

const MIGRATION_FILE_PATTERN = /^\d{4,14}_[a-z0-9_]+\.sql$/;
export const BRAI_FACTORY_MIGRATION_FILE_PATTERN =
  /^\d{4,14}_brai_factory(?:_[a-z0-9_]+)?\.sql$/;

export const defaultMigrationsDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);

export async function readMigrationFiles(
  directory = defaultMigrationsDirectory,
  pattern = MIGRATION_FILE_PATTERN,
): Promise<MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const migrations = await Promise.all(
    filenames.map(async (version) => {
      const sql = await readFile(join(directory, version), "utf8");

      return {
        version,
        checksum: createHash("sha256").update(sql).digest("hex"),
        sql,
      };
    }),
  );

  return migrations;
}
