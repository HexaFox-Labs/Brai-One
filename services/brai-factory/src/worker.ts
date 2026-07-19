import {
  ACTIVITY_CREATE_SUBJECT,
  ACTIVITY_LIST_SUBJECT,
} from "@brai/contracts";
import {
  decodeJson,
  respondJson,
  type NatsConnection,
  type Subscription,
} from "@brai/nats";
import type { Logger } from "@brai/runtime";

import type { FactoryService } from "./factory-service.js";

export const FACTORY_QUEUE_GROUP = "brai-factory-v1";

function decodeOrUndefined(data: Uint8Array): unknown {
  try {
    return decodeJson<unknown>(data);
  } catch {
    return undefined;
  }
}

async function runCreateSubscription(
  subscription: Subscription,
  service: FactoryService,
  logger: Logger,
): Promise<void> {
  for await (const message of subscription) {
    const response = await service.handleCreate(
      decodeOrUndefined(message.data),
    );

    if (!respondJson(message, response)) {
      logger.warn(
        { request_id: response.request_id },
        "Create request не содержит reply subject",
      );
    }
  }
}

async function runListSubscription(
  subscription: Subscription,
  service: FactoryService,
  logger: Logger,
): Promise<void> {
  for await (const message of subscription) {
    const response = await service.handleList(decodeOrUndefined(message.data));

    if (!respondJson(message, response)) {
      logger.warn(
        { request_id: response.request_id },
        "List request не содержит reply subject",
      );
    }
  }
}

export function startWorker(
  connection: NatsConnection,
  service: FactoryService,
  logger: Logger,
): Promise<void>[] {
  const createSubscription = connection.subscribe(ACTIVITY_CREATE_SUBJECT, {
    queue: FACTORY_QUEUE_GROUP,
  });
  const listSubscription = connection.subscribe(ACTIVITY_LIST_SUBJECT, {
    queue: FACTORY_QUEUE_GROUP,
  });

  logger.info(
    {
      queue_group: FACTORY_QUEUE_GROUP,
      subjects: [ACTIVITY_CREATE_SUBJECT, ACTIVITY_LIST_SUBJECT],
    },
    "brai-factory слушает NATS",
  );

  return [
    runCreateSubscription(createSubscription, service, logger),
    runListSubscription(listSubscription, service, logger),
  ];
}
