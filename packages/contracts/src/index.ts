import { z } from "zod";

import {
  INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
  LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
  USER_ACCESS_STATE_SCHEMA_VERSION,
} from "./agent-access.js";

export * from "./access-api.js";
export * from "./agent-access.js";
export * from "./environment-provisioning.js";
export * from "./runtime-host.js";

export const ACTIVITY_CREATE_SUBJECT = "brai.factory.activity.create.v1";
export const ACTIVITY_LIST_SUBJECT = "brai.factory.activity.list.v1";

export const CREATE_ACTIVITY_REQUEST_SCHEMA_VERSION =
  "brai.factory.activity.create.request.v1";
export const CREATE_ACTIVITY_RESPONSE_SCHEMA_VERSION =
  "brai.factory.activity.create.response.v1";
export const LIST_ACTIVITIES_REQUEST_SCHEMA_VERSION =
  "brai.factory.activity.list.request.v1";
export const LIST_ACTIVITIES_RESPONSE_SCHEMA_VERSION =
  "brai.factory.activity.list.response.v1";
export const CREATE_ACTIVITY_HTTP_RESPONSE_SCHEMA_VERSION =
  "brai.http.activity.create.response.v1";
export const LIST_ACTIVITIES_HTTP_RESPONSE_SCHEMA_VERSION =
  "brai.http.activity.list.response.v1";
export const HTTP_ERROR_SCHEMA_VERSION = "brai.http.error.v1";

export const SCHEMA_VERSIONS = {
  userAccessState: USER_ACCESS_STATE_SCHEMA_VERSION,
  launchAccessSnapshot: LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
  internalAgentLaunchContract: INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
  createActivityRequest: CREATE_ACTIVITY_REQUEST_SCHEMA_VERSION,
  createActivityResponse: CREATE_ACTIVITY_RESPONSE_SCHEMA_VERSION,
  listActivitiesRequest: LIST_ACTIVITIES_REQUEST_SCHEMA_VERSION,
  listActivitiesResponse: LIST_ACTIVITIES_RESPONSE_SCHEMA_VERSION,
  createActivityHttpResponse: CREATE_ACTIVITY_HTTP_RESPONSE_SCHEMA_VERSION,
  listActivitiesHttpResponse: LIST_ACTIVITIES_HTTP_RESPONSE_SCHEMA_VERSION,
  httpError: HTTP_ERROR_SCHEMA_VERSION,
} as const;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const uuidV4Schema = z
  .string()
  .regex(UUID_V4_PATTERN, "Ожидается UUID v4");

export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: false, message: "Ожидается дата и время UTC ISO 8601" });

export const activityTitleSchema = z
  .string()
  .trim()
  .min(1, "Заголовок обязателен")
  .max(250, "Заголовок не должен превышать 250 символов");

export const activityDescriptionSchema = z
  .string()
  .trim()
  .max(10_000, "Описание не должно превышать 10 000 символов");

export const activitySchema = z
  .object({
    id: uuidV4Schema,
    title: activityTitleSchema,
    description: activityDescriptionSchema,
    created_at: isoDateTimeSchema,
  })
  .strict();

export const createActivityInputSchema = z
  .object({
    title: activityTitleSchema,
    description: activityDescriptionSchema.optional().default(""),
  })
  .strict();

export const createActivityPayloadSchema = createActivityInputSchema.extend({
  idempotency_key: uuidV4Schema,
});

const cursorSchema = z
  .string()
  .min(1, "Курсор не должен быть пустым")
  .max(1_024, "Курсор слишком длинный");

export const listActivitiesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional().default(50),
    cursor: cursorSchema.nullable().optional().default(null),
  })
  .strict();

export const listActivitiesPayloadSchema = z
  .object({
    limit: z.number().int().min(1).max(50),
    cursor: cursorSchema.nullable(),
  })
  .strict();

const envelopeMetadata = {
  request_id: uuidV4Schema,
  sent_at: isoDateTimeSchema,
} as const;

export const createActivityRequestSchema = z
  .object({
    schema_version: z.literal(CREATE_ACTIVITY_REQUEST_SCHEMA_VERSION),
    ...envelopeMetadata,
    payload: createActivityPayloadSchema,
  })
  .strict();

export const listActivityRequestSchema = z
  .object({
    schema_version: z.literal(LIST_ACTIVITIES_REQUEST_SCHEMA_VERSION),
    ...envelopeMetadata,
    payload: listActivitiesPayloadSchema,
  })
  .strict();

export const listActivitiesRequestSchema = listActivityRequestSchema;

export const factoryErrorCodeSchema = z.enum([
  "idempotency_conflict",
  "invalid_request",
  "service_unavailable",
  "internal_error",
]);

export const factoryErrorPayloadSchema = z
  .object({
    ok: z.literal(false),
    code: factoryErrorCodeSchema,
    message: z.string().min(1).max(500),
  })
  .strict();

export const createActivitySuccessPayloadSchema = z
  .object({
    ok: z.literal(true),
    activity: activitySchema,
    idempotent_replay: z.boolean(),
  })
  .strict();

export const listActivitiesSuccessPayloadSchema = z
  .object({
    ok: z.literal(true),
    activities: z.array(activitySchema),
    next_cursor: cursorSchema.nullable(),
  })
  .strict();

export const createActivityResponseSchema = z
  .object({
    schema_version: z.literal(CREATE_ACTIVITY_RESPONSE_SCHEMA_VERSION),
    ...envelopeMetadata,
    payload: z.union([
      createActivitySuccessPayloadSchema,
      factoryErrorPayloadSchema,
    ]),
  })
  .strict();

export const listActivityResponseSchema = z
  .object({
    schema_version: z.literal(LIST_ACTIVITIES_RESPONSE_SCHEMA_VERSION),
    ...envelopeMetadata,
    payload: z.union([
      listActivitiesSuccessPayloadSchema,
      factoryErrorPayloadSchema,
    ]),
  })
  .strict();

export const listActivitiesResponseSchema = listActivityResponseSchema;

export const factoryResponseSchema = z.union([
  createActivityResponseSchema,
  listActivityResponseSchema,
]);

export const createActivityHttpResponseSchema = z
  .object({
    schema_version: z.literal(CREATE_ACTIVITY_HTTP_RESPONSE_SCHEMA_VERSION),
    request_id: uuidV4Schema,
    activity: activitySchema,
    idempotent_replay: z.boolean(),
  })
  .strict();

export const listActivitiesHttpResponseSchema = z
  .object({
    schema_version: z.literal(LIST_ACTIVITIES_HTTP_RESPONSE_SCHEMA_VERSION),
    request_id: uuidV4Schema,
    activities: z.array(activitySchema),
    next_cursor: cursorSchema.nullable(),
  })
  .strict();

export const httpErrorCodeSchema = z.enum([
  "invalid_request",
  "authentication_required",
  "forbidden",
  "conflict",
  "unsupported_media_type",
  "host_not_allowed",
  "origin_not_allowed",
  "idempotency_conflict",
  "rate_limited",
  "service_unavailable",
  "internal_error",
  "not_found",
]);

export const httpErrorSchema = z
  .object({
    schema_version: z.literal(HTTP_ERROR_SCHEMA_VERSION),
    request_id: uuidV4Schema,
    code: httpErrorCodeSchema,
    message: z.string().min(1).max(500),
  })
  .strict();

export type Activity = z.infer<typeof activitySchema>;
export type CreateActivityInput = z.infer<typeof createActivityInputSchema>;
export type CreateActivityPayload = z.infer<typeof createActivityPayloadSchema>;
export type ListActivitiesQuery = z.infer<typeof listActivitiesQuerySchema>;
export type ListActivitiesPayload = z.infer<typeof listActivitiesPayloadSchema>;
export type CreateActivityRequest = z.infer<typeof createActivityRequestSchema>;
export type ListActivityRequest = z.infer<typeof listActivityRequestSchema>;
export type ListActivitiesRequest = ListActivityRequest;
export type FactoryErrorCode = z.infer<typeof factoryErrorCodeSchema>;
export type FactoryErrorPayload = z.infer<typeof factoryErrorPayloadSchema>;
export type CreateActivityResponse = z.infer<
  typeof createActivityResponseSchema
>;
export type ListActivityResponse = z.infer<typeof listActivityResponseSchema>;
export type ListActivitiesResponse = ListActivityResponse;
export type FactoryResponse = z.infer<typeof factoryResponseSchema>;
export type CreateActivityHttpResponse = z.infer<
  typeof createActivityHttpResponseSchema
>;
export type ListActivitiesHttpResponse = z.infer<
  typeof listActivitiesHttpResponseSchema
>;
export type HttpErrorCode = z.infer<typeof httpErrorCodeSchema>;
export type HttpError = z.infer<typeof httpErrorSchema>;
