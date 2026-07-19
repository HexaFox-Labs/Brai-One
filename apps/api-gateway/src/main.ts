import { connectNats, drainNats, type NatsConnection } from "@brai/nats";
import {
  createLogger,
  installGracefulShutdown,
  type Logger,
} from "@brai/runtime";

import { createGatewayApp } from "./app.js";
import { createGatewayMessageBus } from "./bus.js";
import { loadGatewayConfig } from "./config.js";

async function monitorNats(
  connection: NatsConnection,
  logger: Logger,
): Promise<void> {
  for await (const status of connection.status()) {
    if (
      status.type === "disconnect" ||
      status.type === "reconnect" ||
      status.type === "error"
    ) {
      logger.warn({ nats_status: status }, "Изменилось состояние NATS");
    }
  }
}

async function main(): Promise<void> {
  const config = loadGatewayConfig();
  const logger = createLogger({
    name: "brai-api-gateway",
    level: config.logLevel,
    base: {
      environment: config.nodeEnv,
    },
  });

  const connection = await connectNats({
    servers: config.natsServers,
    user: config.natsUser,
    pass: config.natsPassword,
    name: "brai-api-gateway",
    inboxPrefix: config.natsInboxPrefix,
  });
  const bus = createGatewayMessageBus(connection, config.natsRequestTimeoutMs);

  void monitorNats(connection, logger).catch((error: unknown) => {
    logger.error({ err: error }, "Остановлен мониторинг соединения NATS");
  });

  try {
    const app = await createGatewayApp({
      config,
      bus,
      logger,
    });

    installGracefulShutdown({
      logger,
      shutdown: async () => {
        await app.close();
      },
    });

    await app.listen({
      host: config.host,
      port: config.port,
    });
  } catch (error) {
    await drainNats(connection).catch(() => undefined);
    throw error;
  }
}

main().catch((error: unknown) => {
  const logger = createLogger({
    name: "brai-api-gateway",
    level: process.env.LOG_LEVEL ?? "info",
  });
  logger.fatal({ err: error }, "API Gateway не запустился");
  process.exitCode = 1;
});
