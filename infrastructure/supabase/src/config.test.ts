import { describe, expect, it } from "vitest";

import { readMigrationConfig, readRuntimeRolePassword } from "./config.js";

describe("readMigrationConfig", () => {
  it("uses a disabled SSL connection by default", () => {
    const config = readMigrationConfig({
      BRAI_FACTORY_MIGRATION_DATABASE_URL:
        "postgresql://admin:secret@database:5432/postgres",
    });

    expect(config.pool.ssl).toBe(false);
    expect(config.pool.max).toBe(1);
  });

  it("rejects unknown SSL modes", () => {
    expect(() =>
      readMigrationConfig({
        BRAI_FACTORY_MIGRATION_DATABASE_URL:
          "postgresql://admin:secret@database:5432/postgres",
        BRAI_FACTORY_MIGRATION_DATABASE_SSL: "maybe",
      }),
    ).toThrow(/must be one of/);
  });
});

describe("readRuntimeRolePassword", () => {
  it("requires a long runtime password", () => {
    expect(() =>
      readRuntimeRolePassword({
        BRAI_FACTORY_RUNTIME_DATABASE_PASSWORD: "short",
      }),
    ).toThrow(/at least 24/);
  });
});
