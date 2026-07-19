import { createPublicKey } from "node:crypto";

import {
  connectNats,
  drainNats,
  isNatsReady,
  type NatsConnection,
} from "@brai/nats";
import { createLogger } from "@brai/runtime";

import { readAccessServiceConfig } from "./config.js";
import { checkAccessDatabase, createAccessDatabase } from "./database.js";
import { Ed25519LaunchContractIssuer } from "./launch-contract-issuer.js";

async function main(): Promise<void> {
  const config = readAccessServiceConfig();
  const logger = createLogger({
    name: "brai-access-healthcheck",
    level: "silent",
  });
  const database = createAccessDatabase(
    {
      ...config.database,
      application_name: "brai-access-healthcheck",
      connectionTimeoutMillis: 2_000,
      max: 1,
    },
    logger,
  );
  let nats: NatsConnection | undefined;

  try {
    // Construction validates that this service has its own private Ed25519
    // launch key. Runtime receipt keys are intentionally not accepted here.
    new Ed25519LaunchContractIssuer({
      keyId: config.launchSigning.keyId,
      privateKey: config.launchSigning.privateKeyPem,
      lifetimeMs: config.launchSigning.lifetimeMs,
    });
    const receiptPublicKey = createPublicKey(
      config.receiptVerification.publicKeyPem,
    );
    if (
      receiptPublicKey.type !== "public" ||
      receiptPublicKey.asymmetricKeyType !== "ed25519"
    ) {
      throw new Error(
        "Runtime receipt verification key must be public Ed25519",
      );
    }
    nats = await connectNats({
      ...config.nats,
      name: "brai-access-healthcheck",
      connectTimeoutMs: 2_000,
      maxReconnectAttempts: 0,
    });
    await Promise.all([nats.flush(), checkAccessDatabase(database)]);
    if (!isNatsReady(nats)) {
      throw new Error("NATS connection is not ready");
    }
    process.stdout.write('{"status":"ok"}\n');
  } finally {
    if (nats && !nats.isClosed()) {
      await drainNats(nats).catch(() => undefined);
    }
    await database.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      status: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    })}\n`,
  );
  process.exitCode = 1;
});
