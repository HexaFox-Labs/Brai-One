import {
  ACTIVITY_PAGE_SIZE,
  type Activity,
  type ActivityDraft,
} from "@/lib/activity";
import { createUuid } from "@/lib/idempotency";

export type ActivityListResult = {
  activities: Activity[];
  nextCursor: string | null;
};

export type CreateActivityResult = {
  activity: Activity;
  idempotentReplay: boolean;
};

type JsonRecord = Record<string, unknown>;

const LIST_RESPONSE_SCHEMA_VERSION = "brai.http.activity.list.response.v1";
const CREATE_RESPONSE_SCHEMA_VERSION = "brai.http.activity.create.response.v1";
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Preserves the server request identifier so support can trace a failed action.
 */
export class ActivityApiError extends Error {
  readonly code: string;
  readonly requestId: string;
  readonly status: number;

  constructor(options: {
    message: string;
    code: string;
    requestId: string;
    status: number;
  }) {
    super(options.message);
    this.name = "ActivityApiError";
    this.code = options.code;
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isActivity(value: unknown): value is Activity {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    UUID_V4_PATTERN.test(value.id) &&
    typeof value.title === "string" &&
    value.title.trim().length >= 1 &&
    value.title.length <= 250 &&
    typeof value.description === "string" &&
    value.description.length <= 10_000 &&
    typeof value.created_at === "string" &&
    !Number.isNaN(Date.parse(value.created_at))
  );
}

function requireRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw new Error("Ответ API не является объектом.");
  }

  return value;
}

export function parseActivityListResponse(value: unknown): ActivityListResult {
  const body = requireRecord(value);

  if (
    body.schema_version !== LIST_RESPONSE_SCHEMA_VERSION ||
    typeof body.request_id !== "string" ||
    !UUID_V4_PATTERN.test(body.request_id) ||
    !Array.isArray(body.activities) ||
    !body.activities.every(isActivity) ||
    !(
      body.next_cursor === null ||
      (typeof body.next_cursor === "string" &&
        body.next_cursor.length >= 1 &&
        body.next_cursor.length <= 1_024)
    )
  ) {
    throw new Error("API вернул некорректный список активностей.");
  }

  return {
    activities: body.activities,
    nextCursor: typeof body.next_cursor === "string" ? body.next_cursor : null,
  };
}

export function parseCreateActivityResponse(
  value: unknown,
): CreateActivityResult {
  const body = requireRecord(value);

  if (
    body.schema_version !== CREATE_RESPONSE_SCHEMA_VERSION ||
    typeof body.request_id !== "string" ||
    !UUID_V4_PATTERN.test(body.request_id) ||
    !isActivity(body.activity) ||
    typeof body.idempotent_replay !== "boolean"
  ) {
    throw new Error("API вернул некорректную активность.");
  }

  return {
    activity: body.activity,
    idempotentReplay: body.idempotent_replay,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function apiErrorFromResponse(
  response: Response,
  value: unknown,
  fallbackRequestId: string,
): ActivityApiError {
  const body = isRecord(value) ? value : {};
  const responseRequestId =
    typeof body.request_id === "string" && UUID_V4_PATTERN.test(body.request_id)
      ? body.request_id
      : null;
  const headerRequestId = response.headers.get("x-request-id");
  const requestId =
    responseRequestId ??
    (headerRequestId && UUID_V4_PATTERN.test(headerRequestId)
      ? headerRequestId
      : fallbackRequestId);

  return new ActivityApiError({
    status: response.status,
    code:
      typeof body.code === "string" && body.code.length <= 100
        ? body.code
        : "request_failed",
    requestId,
    message:
      typeof body.message === "string" &&
      body.message.length >= 1 &&
      body.message.length <= 500
        ? body.message
        : "Не удалось выполнить запрос. Повторите попытку.",
  });
}

function protocolError(requestId: string): ActivityApiError {
  return new ActivityApiError({
    status: 502,
    code: "invalid_gateway_response",
    requestId,
    message: "Сервис вернул неожиданный ответ. Повторите попытку.",
  });
}

export async function listActivities(options?: {
  cursor?: string | null;
  signal?: AbortSignal;
}): Promise<ActivityListResult> {
  const requestId = createUuid();
  const search = new URLSearchParams({
    limit: String(ACTIVITY_PAGE_SIZE),
  });

  if (options?.cursor) {
    search.set("cursor", options.cursor);
  }

  let response: Response;

  try {
    response = await fetch(`/api/v1/activities?${search.toString()}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: options?.signal,
      headers: {
        Accept: "application/json",
        "X-Request-ID": requestId,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    throw new ActivityApiError({
      status: 0,
      code: "network_error",
      requestId,
      message:
        "Нет связи с сервисом. Проверьте подключение и повторите попытку.",
    });
  }

  const value = await readJson(response);

  if (!response.ok) {
    throw apiErrorFromResponse(response, value, requestId);
  }

  try {
    return parseActivityListResponse(value);
  } catch {
    throw protocolError(requestId);
  }
}

export async function createActivity(options: {
  draft: ActivityDraft;
  idempotencyKey: string;
}): Promise<CreateActivityResult> {
  const requestId = createUuid();
  let response: Response;

  try {
    response = await fetch("/api/v1/activities", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": options.idempotencyKey,
        "X-Request-ID": requestId,
      },
      body: JSON.stringify(options.draft),
    });
  } catch {
    throw new ActivityApiError({
      status: 0,
      code: "network_error",
      requestId,
      message:
        "Не удалось связаться с сервисом. Данные формы сохранены, попробуйте ещё раз.",
    });
  }

  const value = await readJson(response);

  if (!response.ok) {
    throw apiErrorFromResponse(response, value, requestId);
  }

  try {
    return parseCreateActivityResponse(value);
  } catch {
    throw protocolError(requestId);
  }
}
