import {
  ACCESS_RUNTIME_AGENT_RUN_LAUNCH_SUBJECT,
  RUNTIME_AGENT_RUN_TERMINATE_SUBJECT,
} from "@brai/contracts";
import {
  decodeJson,
  respondJson,
  type Msg,
  type NatsConnection,
  type Subscription,
} from "@brai/nats";

import { type RuntimeHostLogger } from "./runtime-host-service.js";
import type { RuntimeProfileHostService } from "./runtime-host-router.js";

export const RUNTIME_HOST_QUEUE_GROUP = "brai-runtime-host-v1";
export const RUNTIME_HOST_MAX_CONCURRENT_LAUNCHES = 32;
export const RUNTIME_HOST_MAX_CONCURRENT_TERMINATIONS = 32;

function decodeOrUndefined(data: Uint8Array): unknown {
  try {
    return decodeJson<unknown>(data);
  } catch {
    return undefined;
  }
}

async function handleLaunch(
  message: Msg,
  service: RuntimeProfileHostService,
  logger: RuntimeHostLogger,
): Promise<void> {
  const response = await service.handleLaunch(decodeOrUndefined(message.data));
  if (!respondJson(message, response)) {
    logger.warn(
      { request_id: response.request_id },
      "Runtime launch request не содержит reply subject",
    );
  }
}

async function handleTermination(
  message: Msg,
  service: RuntimeProfileHostService,
  logger: RuntimeHostLogger,
): Promise<void> {
  const response = await service.handleTerminate(
    decodeOrUndefined(message.data),
  );
  if (!respondJson(message, response)) {
    logger.warn(
      { request_id: response.request_id },
      "Runtime termination request не содержит reply subject",
    );
  }
}

async function runBounded(
  subscription: Subscription,
  concurrency: number,
  handler: (message: Msg) => Promise<void>,
  logger: RuntimeHostLogger,
  operation: "launch" | "termination",
): Promise<void> {
  const inFlight = new Set<Promise<void>>();
  for await (const message of subscription) {
    while (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
    }
    const task = handler(message)
      .catch((error: unknown) => {
        logger.error(
          { err: error, operation },
          "Runtime host request handler завершился с ошибкой",
        );
      })
      .finally(() => {
        inFlight.delete(task);
      });
    inFlight.add(task);
  }
  await Promise.all(inFlight);
}

export async function startRuntimeHostWorker(
  connection: NatsConnection,
  service: RuntimeProfileHostService,
  logger: RuntimeHostLogger,
): Promise<readonly Promise<void>[]> {
  await service.recover();
  const launches = connection.subscribe(
    ACCESS_RUNTIME_AGENT_RUN_LAUNCH_SUBJECT,
    { queue: RUNTIME_HOST_QUEUE_GROUP },
  );
  const terminations = connection.subscribe(
    RUNTIME_AGENT_RUN_TERMINATE_SUBJECT,
    { queue: RUNTIME_HOST_QUEUE_GROUP },
  );
  logger.info(
    {
      queue_group: RUNTIME_HOST_QUEUE_GROUP,
      subjects: [
        ACCESS_RUNTIME_AGENT_RUN_LAUNCH_SUBJECT,
        RUNTIME_AGENT_RUN_TERMINATE_SUBJECT,
      ],
      max_concurrent_launches: RUNTIME_HOST_MAX_CONCURRENT_LAUNCHES,
      max_concurrent_terminations: RUNTIME_HOST_MAX_CONCURRENT_TERMINATIONS,
    },
    "Trusted profile runtime host слушает server-only NATS subjects",
  );
  return Object.freeze([
    runBounded(
      launches,
      RUNTIME_HOST_MAX_CONCURRENT_LAUNCHES,
      (message) => handleLaunch(message, service, logger),
      logger,
      "launch",
    ),
    runBounded(
      terminations,
      RUNTIME_HOST_MAX_CONCURRENT_TERMINATIONS,
      (message) => handleTermination(message, service, logger),
      logger,
      "termination",
    ),
  ]);
}
