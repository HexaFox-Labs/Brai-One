import {
  connectNats,
  drainNats,
  isNatsReady,
  type NatsConnection,
} from "@brai/nats";
import { createLogger, installGracefulShutdown } from "@brai/runtime";

import { readFactoryConfig } from "./config.js";
import { checkDatabase, createDatabase } from "./database.js";
import { FactoryService } from "./factory-service.js";
import { ActivityRepository } from "./repository.js";
import { startWorker } from "./worker.js";

async function main(): Promise<void> {
  const config = readFactoryConfig();
  const logger = createLogger({
    name: "brai-factory",
    level: config.logLevel,
  });
  const database = createDatabase(config.database, logger);
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

      if (drainError) {
        throw drainError;
      }
    })();

    return stopPromise;
  };

  try {
    await checkDatabase(database);
    nats = await connectNats({
      ...config.nats,
      connectTimeoutMs: 5_000,
      maxReconnectAttempts: -1,
      reconnectTimeWaitMs: 2_000,
    });

    if (!isNatsReady(nats)) {
      throw new Error("NATS connection is not ready");
    }

    const service = new FactoryService(
      new ActivityRepository(database),
      logger,
    );
    workerLoops = startWorker(nats, service, logger);
    const removeShutdownHandlers = installGracefulShutdown({
      logger,
      shutdown: stop,
      timeoutMs: 15_000,
    });

    logger.info("brai-factory готов принимать запросы");

    try {
      const connectionClosed = nats.closed().then((closeError) => {
        if (closeError) {
          throw closeError;
        }
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
  const logger = createLogger({ name: "brai-factory" });
  logger.fatal({ err: error }, "brai-factory остановлен из-за ошибки");
  process.exitCode = 1;
});
