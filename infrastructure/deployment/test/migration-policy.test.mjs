import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const migrationRoots = [
  resolve(workspaceRoot, "infrastructure/supabase/migrations"),
  resolve(workspaceRoot, "services/brai-access/migrations"),
];
const pinnedFoundationMigrations = new Map([
  [
    "infrastructure/supabase/migrations/0001_brai_factory.sql",
    "d6d18581699951cd5e12406a24e2502442cedb48532e03ba1a8f0775388e085a",
  ],
  [
    "infrastructure/supabase/migrations/0002_brai_factory_runtime_limits.sql",
    "e6fa002993452595da9e61370082dd7baa646f45843cef14954949946bc83f2d",
  ],
  [
    "infrastructure/supabase/migrations/0003_brai_factory_runtime_public_isolation.sql",
    "04d7e76e1f13e74572306ed45d8603fb65e7a965167c20e26dd2fac8f61cf8ea",
  ],
  [
    "services/brai-access/migrations/0001_initial.sql",
    "80e273d8115a9efac693cfc99d6c227a715b3b572068d9c9882bef64c3c45455",
  ],
  [
    "services/brai-access/migrations/0002_typed_runtime_lifecycle.sql",
    "1d379793f568ee3e677a5ff7c4e7371fe803b9552e81a2ca8a40b8ba46792401",
  ],
]);
const destructiveAutomaticMigration =
  /\b(?:ALTER\s+(?:ROLE|TABLE)|CREATE\s+OR\s+REPLACE|DELETE\s+FROM|DROP|GRANT|REVOKE|TRUNCATE|UPDATE\s+[A-Za-z_"])\b/iu;

async function migrationFiles() {
  const results = [];
  for (const root of migrationRoots) {
    for (const name of await readdir(root)) {
      if (/^\d{4}_[a-z0-9_]+\.sql$/u.test(name)) {
        results.push(resolve(root, name));
      }
    }
  }
  return results.sort();
}

describe("expand-contract migration policy", () => {
  it.each([
    "GRANT ALL ON SCHEMA brai_access TO PUBLIC;",
    "GRANT SELECT ON TABLE brai_factory.activities TO brai_factory_runtime;",
  ])("requires review for automatic privilege changes: %s", (statement) => {
    expect(destructiveAutomaticMigration.test(statement)).toBe(true);
  });

  it("pins the immutable foundation migration checksums", async () => {
    for (const [relativePath, expectedDigest] of pinnedFoundationMigrations) {
      const source = await readFile(resolve(workspaceRoot, relativePath));
      const actualDigest = createHash("sha256").update(source).digest("hex");
      expect(actualDigest, relativePath).toBe(expectedDigest);
    }
  });

  it("rejects destructive statements from later automatic migrations", async () => {
    for (const path of await migrationFiles()) {
      const relativePath = path.slice(workspaceRoot.length + 1);
      if (pinnedFoundationMigrations.has(relativePath)) continue;

      const source = await readFile(path, "utf8");
      expect(
        source.startsWith("-- brai-deploy: backward-compatible\n"),
        `${basename(path)} must opt in to the expand-contract policy`,
      ).toBe(true);
      expect(
        destructiveAutomaticMigration.test(source),
        `${basename(path)} requires a reviewed maintenance operation`,
      ).toBe(false);
      expect(source).not.toMatch(/\b(?:BEGIN|COMMIT|ROLLBACK)\b/iu);
    }
  });
});
