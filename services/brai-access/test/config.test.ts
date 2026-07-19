import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  readAccessBootstrapConfig,
  readAccessConfig,
  readAccessMigratorPassword,
  readAccessMigrationConfig,
  readAccessRuntimePassword,
  readAccessServiceConfig,
} from "../src/config.js";

const serviceKeys = generateKeyPairSync("ed25519");
const launchPrivateKeyBase64 = Buffer.from(
  serviceKeys.privateKey.export({
    format: "pem",
    type: "pkcs8",
  }),
).toString("base64");
const receiptPublicKeyBase64 = Buffer.from(
  serviceKeys.publicKey.export({
    format: "pem",
    type: "spki",
  }),
).toString("base64");

describe("brai-access configuration", () => {
  it("keeps the client pool and query timeout inside server limits", () => {
    const config = readAccessConfig({
      BRAI_ACCESS_DATABASE_URL: "postgresql://runtime:secret@db/postgres",
      BRAI_ACCESS_DATABASE_SSL: "disable",
    });

    expect(config.database).toMatchObject({
      application_name: "brai-access",
      max: 10,
      query_timeout: 4_000,
      statement_timeout: 4_000,
    });
  });

  it("rejects a pool above the role connection budget", () => {
    expect(() =>
      readAccessConfig({
        BRAI_ACCESS_DATABASE_URL: "postgresql://runtime:secret@db/postgres",
        BRAI_ACCESS_DATABASE_POOL_MAX: "11",
      }),
    ).toThrow();
  });

  it("accepts runtime-role passwords only from the protected env seam", () => {
    expect(
      readAccessRuntimePassword({
        BRAI_ACCESS_RUNTIME_DATABASE_PASSWORD:
          "deployment-only-password-with-24-chars",
      }),
    ).toBe("deployment-only-password-with-24-chars");
    expect(() =>
      readAccessRuntimePassword({
        BRAI_ACCESS_RUNTIME_DATABASE_PASSWORD: "too-short",
      }),
    ).toThrow();
  });

  it("separates bootstrap and least-privilege migration connections", () => {
    const bootstrap = readAccessBootstrapConfig({
      BRAI_ACCESS_BOOTSTRAP_DATABASE_URL:
        "postgresql://postgres:secret@db/postgres",
    });
    const migration = readAccessMigrationConfig({
      BRAI_ACCESS_MIGRATION_DATABASE_URL:
        "postgresql://brai_access_migrator:secret@db/postgres",
    });

    expect(bootstrap.database).toMatchObject({
      application_name: "brai-access-role-bootstrap",
      max: 1,
    });
    expect(migration.database).toMatchObject({
      application_name: "brai-access-role-admin",
      max: 1,
    });
  });

  it("accepts the migrator password only from its protected env seam", () => {
    expect(
      readAccessMigratorPassword({
        BRAI_ACCESS_MIGRATOR_DATABASE_PASSWORD:
          "migration-only-password-with-24-chars",
      }),
    ).toBe("migration-only-password-with-24-chars");
    expect(() =>
      readAccessMigratorPassword({
        BRAI_ACCESS_MIGRATOR_DATABASE_PASSWORD: "too-short",
      }),
    ).toThrow();
  });

  it("loads NATS and the access-only launch signing key for the runtime service", () => {
    const config = readAccessServiceConfig({
      BRAI_ACCESS_DATABASE_URL: "postgresql://runtime:secret@db/postgres",
      BRAI_ACCESS_DATABASE_SSL: "disable",
      NATS_SERVERS: "nats://one:4222,nats://two:4222",
      NATS_USER: "access",
      NATS_PASSWORD: "secret",
      NATS_INBOX_PREFIX: "_INBOX.brai.access",
      NATS_REQUEST_TIMEOUT_MS: "5000",
      BRAI_RUNTIME_LAUNCH_TIMEOUT_MS: "90000",
      BRAI_ACCESS_LAUNCH_SIGNING_KEY_ID: "access-launch:2026-07",
      BRAI_ACCESS_LAUNCH_SIGNING_PRIVATE_KEY_BASE64: launchPrivateKeyBase64,
      BRAI_RUNTIME_RECEIPT_SIGNING_KEY_ID: "runtime-receipt:2026-07",
      BRAI_RUNTIME_RECEIPT_SIGNING_PUBLIC_KEY_BASE64: receiptPublicKeyBase64,
    });

    expect(config.nats).toEqual({
      servers: ["nats://one:4222", "nats://two:4222"],
      user: "access",
      pass: "secret",
      name: "brai-access",
      inboxPrefix: "_INBOX.brai.access",
    });
    expect(config.launchSigning).toMatchObject({
      keyId: "access-launch:2026-07",
      lifetimeMs: 120_000,
    });
    expect(config.runtimeLaunchTimeoutMs).toBe(90_000);
    expect(config.launchSigning.privateKeyPem).toContain("BEGIN PRIVATE KEY");
  });

  it("rejects a malformed launch signing key before service startup", () => {
    expect(() =>
      readAccessServiceConfig({
        BRAI_ACCESS_DATABASE_URL: "postgresql://runtime:secret@db/postgres",
        NATS_SERVERS: "nats://one:4222",
        NATS_USER: "access",
        NATS_PASSWORD: "secret",
        BRAI_ACCESS_LAUNCH_SIGNING_KEY_ID: "access-launch:2026-07",
        BRAI_ACCESS_LAUNCH_SIGNING_PRIVATE_KEY_BASE64:
          Buffer.from("not a PEM").toString("base64"),
        BRAI_RUNTIME_RECEIPT_SIGNING_KEY_ID: "runtime-receipt:2026-07",
        BRAI_RUNTIME_RECEIPT_SIGNING_PUBLIC_KEY_BASE64: receiptPublicKeyBase64,
      }),
    ).toThrow();
  });
});
