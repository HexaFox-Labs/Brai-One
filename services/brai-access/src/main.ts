import { createPublicKey } from "node:crypto";

import {
  connectNats,
  drainNats,
  isNatsReady,
  type NatsConnection,
} from "@brai/nats";
import { createLogger, installGracefulShutdown } from "@brai/runtime";

import { AccessApiService } from "./access-api-service.js";
import { AccessService } from "./access-service.js";
import { readAccessServiceConfig } from "./config.js";
import { checkAccessDatabase, createAccessDatabase } from "./database.js";
import { DeveloperModeCoordinator } from "./developer-mode-coordinator.js";
import {
  Ed25519EnvironmentProvisionContractIssuer,
  EnvironmentProvisioningCoordinator,
  NatsEnvironmentProvisionDispatcher,
} from "./environment-provisioning-coordinator.js";
import { Ed25519LaunchContractIssuer } from "./launch-contract-issuer.js";
import { PostgresAccessStoreRepository } from "./repository.js";
import { NatsRuntimeDispatcher } from "./runtime-dispatcher.js";
import { CompensatingRuntimeDispatcher } from "./runtime-launch-coordinator.js";
import { RuntimeReceiptApiService } from "./runtime-receipt-api-service.js";
import { NatsRuntimeTerminator } from "./runtime-terminator.js";
import { startAccessWorker } from "./worker.js";

async function main(): Promise<void> {
  const config = readAccessServiceConfig();
  const logger = createLogger({
    name: "brai-access",
    level: config.logLevel,
    base: { environment: config.nodeEnv },
  });
  const database = createAccessDatabase(config.database, logger);
  let nats: NatsConnection | undefined;
  let workerLoops: Promise<void>[] = [];
  let stopPromise: Promise<void> | undefined;

  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      let drainError: unknown;
      if (nats && !nats.isClosed()) {
        try {
          await drainNats(nats);
        } catch (error) {
          drainError = error;
        }
      }
      await Promise.allSettled(workerLoops);
      await database.end();
      if (drainError) throw drainError;
    })();
    return stopPromise;
  };

  try {
    const issuer = new Ed25519LaunchContractIssuer({
      keyId: config.launchSigning.keyId,
      privateKey: config.launchSigning.privateKeyPem,
      lifetimeMs: config.launchSigning.lifetimeMs,
    });
    await checkAccessDatabase(database);
    nats = await connectNats({
      ...config.nats,
      connectTimeoutMs: 5_000,
      maxReconnectAttempts: -1,
      reconnectTimeWaitMs: 2_000,
    });
    if (!isNatsReady(nats)) {
      throw new Error("NATS connection is not ready");
    }

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
    const access = new AccessService(
      new PostgresAccessStoreRepository(database),
    );
    const resolveRuntimePublicKey = (keyId: string) =>
      keyId === config.receiptVerification.keyId ? receiptPublicKey : undefined;
    const runtimeTerminator = new NatsRuntimeTerminator(
      nats,
      config.natsRequestTimeoutMs,
    );
    const runtimeDispatcher = new CompensatingRuntimeDispatcher(
      access,
      new NatsRuntimeDispatcher(nats, config.runtimeLaunchTimeoutMs),
      runtimeTerminator,
      resolveRuntimePublicKey,
    );
    const service = new AccessApiService(
      access,
      issuer,
      runtimeDispatcher,
      new EnvironmentProvisioningCoordinator(
        access,
        new Ed25519EnvironmentProvisionContractIssuer({
          keyId: config.launchSigning.keyId,
          privateKey: config.launchSigning.privateKeyPem,
          lifetimeMs: config.launchSigning.lifetimeMs,
        }),
        new NatsEnvironmentProvisionDispatcher(
          nats,
          config.natsRequestTimeoutMs,
        ),
        resolveRuntimePublicKey,
      ),
      new DeveloperModeCoordinator(
        access,
        runtimeTerminator,
        resolveRuntimePublicKey,
      ),
      logger,
    );
    const receipts = new RuntimeReceiptApiService(
      access,
      resolveRuntimePublicKey,
      logger,
    );
    workerLoops = startAccessWorker(nats, service, receipts, logger);
    const removeShutdownHandlers = installGracefulShutdown({
      logger,
      shutdown: stop,
      timeoutMs: 15_000,
    });
    logger.info("brai-access готов принимать доверенные NATS-команды");

    try {
      const connectionClosed = nats.closed().then((closeError) => {
        if (closeError) throw closeError;
      });
      await Promise.race([connectionClosed, ...workerLoops]);
    } finally {
      removeShutdownHandlers();
    }
  } finally {
    await stop();
  }
}

main().catch((error: unknown) => {
  const logger = createLogger({
    name: "brai-access",
    level: process.env.LOG_LEVEL ?? "info",
  });
  logger.fatal({ err: error }, "brai-access остановлен из-за ошибки");
  process.exitCode = 1;
});
