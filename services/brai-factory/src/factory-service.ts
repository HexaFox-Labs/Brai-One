import {
  CREATE_ACTIVITY_RESPONSE_SCHEMA_VERSION,
  LIST_ACTIVITIES_RESPONSE_SCHEMA_VERSION,
  createActivityRequestSchema,
  createActivityResponseSchema,
  listActivityRequestSchema,
  listActivityResponseSchema,
  type CreateActivityResponse,
  type FactoryErrorPayload,
  type ListActivityResponse,
} from "@brai/contracts";
import { generateUuid, isUuid, type Logger } from "@brai/runtime";

import {
  IdempotencyConflictError,
  InvalidCursorError,
  PersistenceError,
} from "./errors.js";
import type { ActivityRepository } from "./repository.js";

function requestIdFrom(input: unknown): string {
  if (input && typeof input === "object" && "request_id" in input) {
    const requestId = (input as { request_id?: unknown }).request_id;

    if (isUuid(requestId)) {
      return requestId;
    }
  }

  return generateUuid();
}

function errorPayload(error: unknown): FactoryErrorPayload {
  if (error instanceof IdempotencyConflictError) {
    return {
      ok: false,
      code: "idempotency_conflict",
      message:
        "Этот ключ повторного запроса уже использован для другой активности.",
    };
  }

  if (error instanceof InvalidCursorError) {
    return {
      ok: false,
      code: "invalid_request",
      message: "Курсор списка активностей недействителен.",
    };
  }

  if (error instanceof PersistenceError) {
    return {
      ok: false,
      code: "service_unavailable",
      message: "Хранилище активностей временно недоступно.",
    };
  }

  return {
    ok: false,
    code: "internal_error",
    message: "Не удалось обработать запрос.",
  };
}

function logFailure(
  logger: Logger,
  error: unknown,
  requestId: string,
  message: string,
): void {
  if (
    error instanceof IdempotencyConflictError ||
    error instanceof InvalidCursorError
  ) {
    logger.warn(
      {
        error_type: error.name,
        request_id: requestId,
      },
      message,
    );
    return;
  }

  logger.error({ err: error, request_id: requestId }, message);
}

export class FactoryService {
  public constructor(
    private readonly repository: ActivityRepository,
    private readonly logger: Logger,
  ) {}

  public async handleCreate(input: unknown): Promise<CreateActivityResponse> {
    const requestId = requestIdFrom(input);
    const parsed = createActivityRequestSchema.safeParse(input);

    if (!parsed.success) {
      return createActivityResponseSchema.parse({
        schema_version: CREATE_ACTIVITY_RESPONSE_SCHEMA_VERSION,
        request_id: requestId,
        sent_at: new Date().toISOString(),
        payload: {
          ok: false,
          code: "invalid_request",
          message: "Запрос создания активности имеет неверный формат.",
        },
      });
    }

    try {
      const result = await this.repository.createActivity(
        parsed.data.payload,
        parsed.data.request_id,
      );

      this.logger.info(
        {
          activity_id: result.activity.id,
          idempotent_replay: result.idempotentReplay,
          request_id: parsed.data.request_id,
        },
        "Запрос создания Activity обработан",
      );

      return createActivityResponseSchema.parse({
        schema_version: CREATE_ACTIVITY_RESPONSE_SCHEMA_VERSION,
        request_id: parsed.data.request_id,
        sent_at: new Date().toISOString(),
        payload: {
          ok: true,
          activity: result.activity,
          idempotent_replay: result.idempotentReplay,
        },
      });
    } catch (error) {
      logFailure(
        this.logger,
        error,
        parsed.data.request_id,
        "Не удалось создать Activity",
      );

      return createActivityResponseSchema.parse({
        schema_version: CREATE_ACTIVITY_RESPONSE_SCHEMA_VERSION,
        request_id: parsed.data.request_id,
        sent_at: new Date().toISOString(),
        payload: errorPayload(error),
      });
    }
  }

  public async handleList(input: unknown): Promise<ListActivityResponse> {
    const requestId = requestIdFrom(input);
    const parsed = listActivityRequestSchema.safeParse(input);

    if (!parsed.success) {
      return listActivityResponseSchema.parse({
        schema_version: LIST_ACTIVITIES_RESPONSE_SCHEMA_VERSION,
        request_id: requestId,
        sent_at: new Date().toISOString(),
        payload: {
          ok: false,
          code: "invalid_request",
          message: "Запрос списка активностей имеет неверный формат.",
        },
      });
    }

    try {
      const result = await this.repository.listActivities(parsed.data.payload);

      this.logger.info(
        {
          activity_count: result.activities.length,
          request_id: parsed.data.request_id,
        },
        "Запрос списка Activity обработан",
      );

      return listActivityResponseSchema.parse({
        schema_version: LIST_ACTIVITIES_RESPONSE_SCHEMA_VERSION,
        request_id: parsed.data.request_id,
        sent_at: new Date().toISOString(),
        payload: {
          ok: true,
          activities: result.activities,
          next_cursor: result.nextCursor,
        },
      });
    } catch (error) {
      logFailure(
        this.logger,
        error,
        parsed.data.request_id,
        "Не удалось получить список Activity",
      );

      return listActivityResponseSchema.parse({
        schema_version: LIST_ACTIVITIES_RESPONSE_SCHEMA_VERSION,
        request_id: parsed.data.request_id,
        sent_at: new Date().toISOString(),
        payload: errorPayload(error),
      });
    }
  }
}
