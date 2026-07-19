import { readFile, stat } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const sourceRoot = new URL("../", import.meta.url);

describe("brai-access host database tooling", () => {
  it("installs an access-owned backup wrapper independent of deploy tooling", async () => {
    const installer = await readFile(
      new URL("install-access-database-tooling.sh", sourceRoot),
      "utf8",
    );
    const status = await readFile(
      new URL("status-access-database-tooling.sh", sourceRoot),
      "utf8",
    );

    expect(installer).toContain("/srv/opt/brai-access");
    expect(installer).toContain("zz-brai-access.conf");
    expect(installer).not.toContain("brai-new-deploy");
    expect(status).toContain("cmp --silent");
    expect(status).toContain("brai_access_database_tooling=ready");
  });

  it("requires both service schemas and invokes only the fixed wrapper", async () => {
    const dropin = await readFile(
      new URL("brai-access-backup.conf", sourceRoot),
      "utf8",
    );
    const wrapperUrl = new URL("brai-access-backup", sourceRoot);
    const wrapper = await readFile(wrapperUrl, "utf8");
    const wrapperStat = await stat(wrapperUrl);

    expect(dropin).toContain(
      "BRAI_REQUIRED_BACKUP_SCHEMAS=brai_factory brai_access",
    );
    expect(dropin).toContain(
      "ExecStart=/srv/opt/brai-access/bin/pre-migration-backup",
    );
    expect(wrapper).toContain("unset BRAI_DATABASE_URL");
    expect(wrapper).not.toContain("/srv/projects/");
    expect(wrapperStat.mode & 0o111).not.toBe(0);
  });
});
