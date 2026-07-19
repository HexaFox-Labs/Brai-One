import {
  connectNats,
  drainNats,
  isNatsReady,
  type NatsConnection,
} from "@brai/nats";
import { createLogger } from "@brai/runtime";

import { readFactoryConfig } from "./config.js";
import { checkDatabase, createDatabase } from "./database.js";

async function main(): Promise<void> {
  const config = readFactoryConfig();
  const logger = createLogger({
    name: "brai-factory-healthcheck",
    level: "silent",
  });
  const database = createDatabase(
    {
      ...config.database,
      application_name: "brai-factory-healthcheck",
      connectionTimeoutMillis: 2_000,
      max: 1,
    },
    logger,
  );
  let nats: NatsConnection | undefined;

  try {
    nats = await connectNats({
      ...config.nats,
      name: "brai-factory-healthcheck",
      connectTimeoutMs: 2_000,
      maxReconnectAttempts: 0,
    });
    await Promise.all([nats.flush(), checkDatabase(database)]);

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
