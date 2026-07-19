import { generateKeyPairSync, randomBytes } from "node:crypto";
import { join } from "node:path";

import {
  devGatewayPort,
  devWebPort,
  previewGatewayPort,
  previewHostname,
  previewWebPort,
} from "./constants.mjs";

const postgresImage =
  "postgres:16.10-alpine3.21@sha256:2381f2a900af6afac8db4688e412cb798d463a81d9e0e7d08dde1a80da7a544c";

/** @returns {Record<string, string>} */
export function createRuntimeSecrets() {
  const accessLaunch = generateKeyPairSync("ed25519");
  const runtimeReceipt = generateKeyPairSync("ed25519");
  return {
    accessLaunchKeyId: `preview-launch:${randomToken(8)}`,
    accessLaunchPrivateKeyBase64: toBase64Pem(accessLaunch.privateKey, "pkcs8"),
    accessMigratorPassword: randomToken(32),
    accessRuntimePassword: randomToken(32),
    factoryRuntimePassword: randomToken(32),
    natsAccessPassword: randomToken(32),
    natsFactoryPassword: randomToken(32),
    natsGatewayPassword: randomToken(32),
    natsRuntimePassword: randomToken(32),
    postgresPassword: randomToken(32),
    runtimeReceiptKeyId: `preview-receipt:${randomToken(8)}`,
    runtimeReceiptPublicKeyBase64: toBase64Pem(
      runtimeReceipt.publicKey,
      "spki",
    ),
  };
}

/**
 * Renders the private per-environment config files. The only variables that
 * enter Compose are values generated here or immutable image references from a
 * verified manifest; no host production credential is reused in previews.
 *
 * @param {{ prefix: string; slot?: number; images: Record<string, string>; secrets: Record<string, string>; configDirectory?: string }} input
 */
export function renderRuntimeConfiguration(input) {
  const target = input.slot === undefined ? "dev" : "preview";
  const host =
    target === "dev" ? "dev.brai.one" : previewHostname(requiredSlot(input));
  const webPort =
    target === "dev" ? devWebPort : previewWebPort(requiredSlot(input));
  const gatewayPort =
    target === "dev" ? devGatewayPort : previewGatewayPort(requiredSlot(input));
  const databaseName = "brai_preview";
  const databaseHost = "brai-postgres";
  const adminUrl = databaseUrl(
    "postgres",
    input.secrets.postgresPassword,
    databaseHost,
    databaseName,
  );
  const factoryUrl = databaseUrl(
    "brai_factory_runtime",
    input.secrets.factoryRuntimePassword,
    databaseHost,
    databaseName,
  );
  const accessMigratorUrl = databaseUrl(
    "brai_access_migrator",
    input.secrets.accessMigratorPassword,
    databaseHost,
    databaseName,
  );
  const accessRuntimeUrl = databaseUrl(
    "brai_access_runtime",
    input.secrets.accessRuntimePassword,
    databaseHost,
    databaseName,
  );
  const image = requiredImages(input.images);

  return {
    access: lines({
      BRAI_ACCESS_DATABASE_CONNECTION_TIMEOUT_MS: "3000",
      BRAI_ACCESS_DATABASE_POOL_MAX: "10",
      BRAI_ACCESS_DATABASE_QUERY_TIMEOUT_MS: "4000",
      BRAI_ACCESS_DATABASE_SSL: "disable",
      BRAI_ACCESS_DATABASE_URL: accessRuntimeUrl,
      BRAI_ACCESS_LAUNCH_CONTRACT_LIFETIME_MS: "120000",
      BRAI_ACCESS_LAUNCH_SIGNING_KEY_ID: input.secrets.accessLaunchKeyId,
      BRAI_ACCESS_LAUNCH_SIGNING_PRIVATE_KEY_BASE64:
        input.secrets.accessLaunchPrivateKeyBase64,
      BRAI_RUNTIME_LAUNCH_TIMEOUT_MS: "90000",
      BRAI_RUNTIME_RECEIPT_SIGNING_KEY_ID: input.secrets.runtimeReceiptKeyId,
      BRAI_RUNTIME_RECEIPT_SIGNING_PUBLIC_KEY_BASE64:
        input.secrets.runtimeReceiptPublicKeyBase64,
      LOG_LEVEL: "info",
      NATS_INBOX_PREFIX: "_INBOX.brai.access",
      NATS_PASSWORD: input.secrets.natsAccessPassword,
      NATS_REQUEST_TIMEOUT_MS: "30000",
      NATS_SERVERS: "nats://brai-nats:4222",
      NATS_USER: "brai-access",
      NODE_ENV: "production",
    }),
    accessBootstrap: lines({
      BRAI_ACCESS_BOOTSTRAP_DATABASE_SSL: "disable",
      BRAI_ACCESS_BOOTSTRAP_DATABASE_URL: adminUrl,
      BRAI_ACCESS_MIGRATOR_DATABASE_PASSWORD:
        input.secrets.accessMigratorPassword,
      BRAI_ACCESS_RUNTIME_DATABASE_PASSWORD:
        input.secrets.accessRuntimePassword,
    }),
    accessMigrations: lines({
      BRAI_ACCESS_MIGRATION_DATABASE_SSL: "disable",
      BRAI_ACCESS_MIGRATION_DATABASE_URL: accessMigratorUrl,
    }),
    compose: lines({
      BRAI_ACCESS_ADMIN_IMAGE: image["access-admin"],
      BRAI_ACCESS_BOOTSTRAP_ENV: configPath(input, "access-bootstrap.env"),
      BRAI_ACCESS_ENV: configPath(input, "access.env"),
      BRAI_ACCESS_IMAGE: image.access,
      BRAI_ACCESS_MIGRATIONS_ENV: configPath(input, "access-migrations.env"),
      BRAI_API_GATEWAY_IMAGE: image["api-gateway"],
      BRAI_FACTORY_ADMIN_IMAGE: image["factory-admin"],
      BRAI_FACTORY_ENV: configPath(input, "factory.env"),
      BRAI_FACTORY_IMAGE: image.factory,
      BRAI_FACTORY_MIGRATIONS_ENV: configPath(input, "factory-migrations.env"),
      BRAI_GATEWAY_ENV: configPath(input, "gateway.env"),
      BRAI_GATEWAY_PORT: String(gatewayPort),
      BRAI_NATS_ENV: configPath(input, "nats.env"),
      BRAI_NATS_IMAGE: image.nats,
      BRAI_POSTGRES_IMAGE: postgresImage,
      BRAI_POSTGRES_PASSWORD: input.secrets.postgresPassword,
      BRAI_PREFIX: input.prefix,
      BRAI_WEB_IMAGE: image.web,
      BRAI_WEB_PORT: String(webPort),
    }),
    factory: lines({
      DATABASE_CONNECTION_TIMEOUT_MS: "3000",
      DATABASE_POOL_MAX: "10",
      DATABASE_QUERY_TIMEOUT_MS: "4000",
      DATABASE_SSL: "disable",
      DATABASE_URL: factoryUrl,
      LOG_LEVEL: "info",
      NATS_INBOX_PREFIX: "_INBOX.brai.factory",
      NATS_PASSWORD: input.secrets.natsFactoryPassword,
      NATS_REQUEST_TIMEOUT_MS: "30000",
      NATS_SERVERS: "nats://brai-nats:4222",
      NATS_USER: "brai-factory",
      NODE_ENV: "production",
    }),
    factoryMigrations: lines({
      BRAI_FACTORY_MIGRATION_DATABASE_SSL: "disable",
      BRAI_FACTORY_MIGRATION_DATABASE_URL: adminUrl,
      BRAI_FACTORY_RUNTIME_DATABASE_PASSWORD:
        input.secrets.factoryRuntimePassword,
    }),
    gateway: lines({
      ACCESS_API_ENABLED: "false",
      ALLOW_LOOPBACK_HOSTS: "true",
      GATEWAY_HOST: "0.0.0.0",
      GATEWAY_PORT: "3201",
      LOG_LEVEL: "info",
      NATS_INBOX_PREFIX: "_INBOX.brai.gateway",
      NATS_PASSWORD: input.secrets.natsGatewayPassword,
      NATS_REQUEST_TIMEOUT_MS: "30000",
      NATS_SERVERS: "nats://brai-nats:4222",
      NATS_USER: "brai-gateway",
      NODE_ENV: "production",
      PUBLIC_ORIGINS: `https://${host}`,
    }),
    nats: lines({
      NATS_ACCESS_PASSWORD: input.secrets.natsAccessPassword,
      NATS_ACCESS_USER: "brai-access",
      NATS_FACTORY_PASSWORD: input.secrets.natsFactoryPassword,
      NATS_FACTORY_USER: "brai-factory",
      NATS_GATEWAY_PASSWORD: input.secrets.natsGatewayPassword,
      NATS_GATEWAY_USER: "brai-gateway",
      NATS_RUNTIME_PASSWORD: input.secrets.natsRuntimePassword,
      NATS_RUNTIME_USER: "brai-runtime",
    }),
  };
}

/** @param {string} length */
function randomToken(length) {
  return randomBytes(Number(length)).toString("base64url");
}

/** @param {import("node:crypto").KeyObject} key @param {"pkcs8" | "spki"} type */
function toBase64Pem(key, type) {
  return Buffer.from(key.export({ format: "pem", type })).toString("base64");
}

/** @param {{ slot?: number }} input */
function requiredSlot(input) {
  if (input.slot === undefined)
    throw new Error("Preview configuration needs a slot");
  return input.slot;
}

/** @param {Record<string, string>} images */
function requiredImages(images) {
  const required = [
    "access",
    "access-admin",
    "api-gateway",
    "factory",
    "factory-admin",
    "nats",
    "web",
  ];
  for (const name of required) {
    if (!images[name]) throw new Error(`Missing immutable image ${name}`);
  }
  return images;
}

/** @param {string} username @param {string} password @param {string} hostname @param {string} database */
function databaseUrl(username, password, hostname, database) {
  const url = new URL(`postgresql://${hostname}/${database}`);
  url.username = username;
  url.password = password;
  return url.toString();
}

/** @param {Record<string, string>} values */
function lines(values) {
  return `${Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      if (/\r|\n/u.test(value))
        throw new Error(`Environment value ${key} is invalid`);
      return `${key}=${value}`;
    })
    .join("\n")}\n`;
}

/** @param {{ configDirectory?: string }} input @param {string} file */
function configPath(input, file) {
  return input.configDirectory ? join(input.configDirectory, file) : file;
}
