import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("database PUBLIC hardening", () => {
  it("keeps every generated Brai runtime role out of TEMP and public", async () => {
    const source = await readFile(
      new URL(
        "../hardening/0001_restrict_database_public_defaults.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toContain("rolname !~ '^brai_[a-z0-9_]+_runtime$'");
    expect(source).not.toContain("rolname <> 'brai_factory_runtime'");
    expect(source).toContain("has_database_privilege(");
    expect(source).toContain("has_schema_privilege(");
    expect(source).toContain("IF existing_role.had_temporary THEN");
    expect(source).toContain("IF existing_role.had_public_usage THEN");
    expect(source).toContain("rolname ~ '^brai_[a-z0-9_]+_runtime$'");
    expect(source).toContain("REVOKE ALL ON SCHEMA public FROM %I");
    expect(source).toContain("REVOKE TEMPORARY");
    expect(source).toContain("REVOKE USAGE ON SCHEMA public FROM PUBLIC");
  });
});
