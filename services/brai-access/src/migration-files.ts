import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type AccessMigrationFile = Readonly<{
  version: string;
  checksum: string;
  sql: string;
}>;

const ACCESS_MIGRATION_FILE_PATTERN = /^\d{4,14}_[a-z0-9_]+\.sql$/u;

export const defaultAccessMigrationsDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);

export async function readAccessMigrationFiles(
  directory = defaultAccessMigrationsDirectory,
): Promise<readonly AccessMigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const filenames = entries
    .filter(
      (entry) =>
        entry.isFile() && ACCESS_MIGRATION_FILE_PATTERN.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    filenames.map(async (version) => {
      const sql = await readFile(join(directory, version), "utf8");
      return Object.freeze({
        version,
        checksum: createHash("sha256").update(sql).digest("hex"),
        sql,
      });
    }),
  );
}
