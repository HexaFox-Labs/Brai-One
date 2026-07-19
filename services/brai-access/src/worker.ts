import {
  ACCESS_RUNTIME_RECEIPT_CLAIM_SUBJECT,
  ACCESS_RUNTIME_RECEIPT_EXIT_SUBJECT,
  ACCESS_RUNTIME_RECEIPT_STARTED_SUBJECT,
  ACCESS_AGENT_RUN_CREATE_SUBJECT,
  ACCESS_DEVELOPER_MODE_SET_SUBJECT,
} from "@brai/contracts";
import {
  decodeJson,
  respondJson,
  type Msg,
  type NatsConnection,
  type Subscription,
} from "@brai/nats";
import type { Logger } from "@brai/runtime";

import type { AccessApiService } from "./access-api-service.js";
import type { RuntimeReceiptApiService } from "./runtime-receipt-api-service.js";

export const ACCESS_QUEUE_GROUP = "brai-access-v1";
export const ACCESS_MAX_CONCURRENT_AGENT_RUNS = 32;
export const ACCESS_MAX_CONCURRENT_MODE_CHANGES = 16;
export const ACCESS_MAX_CONCURRENT_RECEIPTS = 64;

function decodeOrUndefined(data: Uint8Array): unknown {
  try {
    return decodeJson<unknown>(data);
  } catch {
    return undefined;
  }
}

async function runBounded(
  subscription: Subscription,
  concurrency: number,
  handler: (message: Msg) => Promise<void>,
  logger: Logger,
  operation: string,
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
          "brai-access NATS handler завершился с ошибкой",
        );
      })
      .finally(() => {
        inFlight.delete(task);
      });
    inFlight.add(task);
  }
  await Promise.all(inFlight);
}

async function handleCreateAgentRun(
  message: Msg,
  service: AccessApiService,
  logger: Logger,
): Promise<void> {
  const response = await service.handleCreateAgentRun(
    decodeOrUndefined(message.data),
  );
  if (!respondJson(message, response)) {
    logger.warn(
      { request_id: response.request_id },
      "Create agent run request не содержит reply subject",
    );
  }
}

async function handleSetDeveloperMode(
  message: Msg,
  service: AccessApiService,
  logger: Logger,
): Promise<void> {
  const response = await service.handleSetDeveloperMode(
    decodeOrUndefined(message.data),
  );
  if (!respondJson(message, response)) {
    logger.warn(
      { request_id: response.request_id },
      "Set developer mode request не содержит reply subject",
    );
  }
}

async function handleRuntimeReceipt(
  message: Msg,
  handler: (input: unknown) => Promise<{ readonly request_id: string }>,
  logger: Logger,
): Promise<void> {
  const response = await handler(decodeOrUndefined(message.data));
  if (!respondJson(message, response)) {
    logger.warn(
      { request_id: response.request_id },
      "Runtime receipt request не содержит reply subject",
    );
  }
}

export function startAccessWorker(
  connection: NatsConnection,
  service: AccessApiService,
  receipts: RuntimeReceiptApiService,
  logger: Logger,
): Promise<void>[] {
  const createAgentRun = connection.subscribe(ACCESS_AGENT_RUN_CREATE_SUBJECT, {
    queue: ACCESS_QUEUE_GROUP,
  });
  const setDeveloperMode = connection.subscribe(
    ACCESS_DEVELOPER_MODE_SET_SUBJECT,
    { queue: ACCESS_QUEUE_GROUP },
  );
  const runtimeClaim = connection.subscribe(
    ACCESS_RUNTIME_RECEIPT_CLAIM_SUBJECT,
    { queue: ACCESS_QUEUE_GROUP },
  );
  const runtimeStarted = connection.subscribe(
    ACCESS_RUNTIME_RECEIPT_STARTED_SUBJECT,
    { queue: ACCESS_QUEUE_GROUP },
  );
  const runtimeExit = connection.subscribe(
    ACCESS_RUNTIME_RECEIPT_EXIT_SUBJECT,
    { queue: ACCESS_QUEUE_GROUP },
  );

  logger.info(
    {
      queue_group: ACCESS_QUEUE_GROUP,
      subjects: [
        ACCESS_AGENT_RUN_CREATE_SUBJECT,
        ACCESS_DEVELOPER_MODE_SET_SUBJECT,
        ACCESS_RUNTIME_RECEIPT_CLAIM_SUBJECT,
        ACCESS_RUNTIME_RECEIPT_STARTED_SUBJECT,
        ACCESS_RUNTIME_RECEIPT_EXIT_SUBJECT,
      ],
      max_concurrent_agent_runs: ACCESS_MAX_CONCURRENT_AGENT_RUNS,
      max_concurrent_mode_changes: ACCESS_MAX_CONCURRENT_MODE_CHANGES,
      max_concurrent_receipts: ACCESS_MAX_CONCURRENT_RECEIPTS,
    },
    "brai-access слушает доверенные NATS-команды",
  );

  return [
    runBounded(
      createAgentRun,
      ACCESS_MAX_CONCURRENT_AGENT_RUNS,
      (message) => handleCreateAgentRun(message, service, logger),
      logger,
      "create-agent-run",
    ),
    runBounded(
      setDeveloperMode,
      ACCESS_MAX_CONCURRENT_MODE_CHANGES,
      (message) => handleSetDeveloperMode(message, service, logger),
      logger,
      "set-developer-mode",
    ),
    runBounded(
      runtimeClaim,
      ACCESS_MAX_CONCURRENT_RECEIPTS,
      (message) =>
        handleRuntimeReceipt(
          message,
          receipts.handleClaim.bind(receipts),
          logger,
        ),
      logger,
      "runtime-claim",
    ),
    runBounded(
      runtimeStarted,
      ACCESS_MAX_CONCURRENT_RECEIPTS,
      (message) =>
        handleRuntimeReceipt(
          message,
          receipts.handleStarted.bind(receipts),
          logger,
        ),
      logger,
      "runtime-started",
    ),
    runBounded(
      runtimeExit,
      ACCESS_MAX_CONCURRENT_RECEIPTS,
      (message) =>
        handleRuntimeReceipt(
          message,
          receipts.handleExit.bind(receipts),
          logger,
        ),
      logger,
      "runtime-exit",
    ),
  ];
}
