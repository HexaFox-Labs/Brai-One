import { z } from "zod";

import { internalAgentLaunchContractSchema } from "./agent-access.js";

export const ACCESS_AGENT_RUN_CREATE_SUBJECT =
  "brai.access.agent-run.create.v1";
export const ACCESS_DEVELOPER_MODE_SET_SUBJECT =
  "brai.access.developer-mode.set.v1";
export const ACCESS_RUNTIME_AGENT_RUN_LAUNCH_SUBJECT =
  "brai.runtime.agent-run.launch.v1";

export const ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION =
  "brai.access.agent-run.create.request.v1";
export const ACCESS_AGENT_RUN_CREATE_RESPONSE_SCHEMA_VERSION =
  "brai.access.agent-run.create.response.v1";
export const ACCESS_DEVELOPER_MODE_SET_REQUEST_SCHEMA_VERSION =
  "brai.access.developer-mode.set.request.v1";
export const ACCESS_DEVELOPER_MODE_SET_RESPONSE_SCHEMA_VERSION =
  "brai.access.developer-mode.set.response.v1";
export const ACCESS_RUNTIME_AGENT_RUN_LAUNCH_REQUEST_SCHEMA_VERSION =
  "brai.runtime.agent-run.launch.request.v1";
export const ACCESS_RUNTIME_AGENT_RUN_LAUNCH_RESPONSE_SCHEMA_VERSION =
  "brai.runtime.agent-run.launch.response.v1";
export const ACCESS_AGENT_RUN_HTTP_RESPONSE_SCHEMA_VERSION =
  "brai.http.access.agent-run.response.v1";
export const ACCESS_DEVELOPER_MODE_HTTP_RESPONSE_SCHEMA_VERSION =
  "brai.http.access.developer-mode.response.v1";
export const MAX_WEB_AGENT_PROMPT_BYTES = 24 * 1_024;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accessApiUuidV4Schema = z
  .string()
  .regex(UUID_V4_PATTERN, "Ожидается UUID v4");
const accessApiTimestampSchema = z.string().datetime({
  offset: false,
  message: "Ожидается дата и время UTC ISO 8601",
});
const accessGenerationSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const promptSchema = z
  .string()
  .min(1)
  .max(MAX_WEB_AGENT_PROMPT_BYTES)
  .refine(
    (value) => value.trim().length > 0,
    "Задача агента не должна быть пустой",
  )
  .refine(
    (value) =>
      new TextEncoder().encode(value).byteLength <= MAX_WEB_AGENT_PROMPT_BYTES,
    "Задача агента слишком большая",
  );

/**
 * Public input intentionally contains no user identity, access profile,
 * generation, job command, filesystem path, Linux ID, runtime or cgroup data.
 */
export const createAgentRunInputSchema = z
  .object({
    project_id: accessApiUuidV4Schema,
    prompt: promptSchema,
  })
  .strict();

/**
 * The target user is bound by the URL and the platform-admin identity is
 * supplied by the trusted Gateway, never by this public body.
 */
export const setDeveloperModeInputSchema = z
  .object({
    developer_mode: z.boolean(),
  })
  .strict();

const requestMetadata = {
  request_id: accessApiUuidV4Schema,
  sent_at: accessApiTimestampSchema,
} as const;

const responseMetadata = {
  request_id: accessApiUuidV4Schema,
  sent_at: accessApiTimestampSchema,
} as const;

export const accessAgentRunCreateRequestSchema = z
  .object({
    schema_version: z.literal(ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION),
    ...requestMetadata,
    payload: z
      .object({
        // Derived from a verified Supabase JWT by API Gateway.
        authenticated_user_id: accessApiUuidV4Schema,
        project_id: accessApiUuidV4Schema,
        prompt: promptSchema,
      })
      .strict(),
  })
  .strict();

export const accessDeveloperModeSetRequestSchema = z
  .object({
    schema_version: z.literal(ACCESS_DEVELOPER_MODE_SET_REQUEST_SCHEMA_VERSION),
    ...requestMetadata,
    payload: z
      .object({
        // Derived from the server-only platform-admin Gateway setting.
        platform_admin_user_id: accessApiUuidV4Schema,
        target_user_id: accessApiUuidV4Schema,
        developer_mode: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const accessApiErrorCodeSchema = z.enum([
  "invalid_request",
  "membership_not_found",
  "transition_in_progress",
  "environment_unavailable",
  "service_unavailable",
  "internal_error",
]);

export const accessApiErrorPayloadSchema = z
  .object({
    ok: z.literal(false),
    code: accessApiErrorCodeSchema,
    message: z.string().min(1).max(500),
  })
  .strict();

export const accessAgentRunCreateSuccessPayloadSchema = z
  .object({
    ok: z.literal(true),
    run_id: accessApiUuidV4Schema,
    project_id: accessApiUuidV4Schema,
    status: z.literal("pending"),
  })
  .strict();

export const accessDeveloperModeSetSuccessPayloadSchema = z
  .object({
    ok: z.literal(true),
    changed: z.boolean(),
    user_id: accessApiUuidV4Schema,
    access_generation: accessGenerationSchema,
    runs_to_terminate: z
      .array(
        z
          .object({
            run_id: accessApiUuidV4Schema,
            access_generation: accessGenerationSchema,
          })
          .strict(),
      )
      .readonly(),
  })
  .strict();

export const accessAgentRunCreateResponseSchema = z
  .object({
    schema_version: z.literal(ACCESS_AGENT_RUN_CREATE_RESPONSE_SCHEMA_VERSION),
    ...responseMetadata,
    payload: z.union([
      accessAgentRunCreateSuccessPayloadSchema,
      accessApiErrorPayloadSchema,
    ]),
  })
  .strict();

/**
 * Server-only access -> runtime transport. Gateway/browser credentials must
 * never receive publish permission for this subject.
 */
export const accessRuntimeAgentRunLaunchRequestSchema = z
  .object({
    schema_version: z.literal(
      ACCESS_RUNTIME_AGENT_RUN_LAUNCH_REQUEST_SCHEMA_VERSION,
    ),
    ...requestMetadata,
    payload: z
      .object({
        launch_contract: internalAgentLaunchContractSchema,
        prompt: promptSchema,
      })
      .strict(),
  })
  .strict();

export const accessRuntimeAgentRunLaunchResponseSchema = z
  .object({
    schema_version: z.literal(
      ACCESS_RUNTIME_AGENT_RUN_LAUNCH_RESPONSE_SCHEMA_VERSION,
    ),
    ...responseMetadata,
    payload: z.discriminatedUnion("accepted", [
      z
        .object({
          accepted: z.literal(true),
          run_id: accessApiUuidV4Schema,
        })
        .strict(),
      z
        .object({
          accepted: z.literal(false),
          code: z.enum([
            "invalid_contract",
            "runtime_unavailable",
            "internal_error",
          ]),
          message: z.string().min(1).max(500),
        })
        .strict(),
    ]),
  })
  .strict();

export const accessDeveloperModeSetResponseSchema = z
  .object({
    schema_version: z.literal(
      ACCESS_DEVELOPER_MODE_SET_RESPONSE_SCHEMA_VERSION,
    ),
    ...responseMetadata,
    payload: z.union([
      accessDeveloperModeSetSuccessPayloadSchema,
      accessApiErrorPayloadSchema,
    ]),
  })
  .strict();

export const accessAgentRunHttpResponseSchema = z
  .object({
    schema_version: z.literal(ACCESS_AGENT_RUN_HTTP_RESPONSE_SCHEMA_VERSION),
    request_id: accessApiUuidV4Schema,
    run_id: accessApiUuidV4Schema,
    project_id: accessApiUuidV4Schema,
    status: z.literal("pending"),
  })
  .strict();

export const accessDeveloperModeHttpResponseSchema = z
  .object({
    schema_version: z.literal(
      ACCESS_DEVELOPER_MODE_HTTP_RESPONSE_SCHEMA_VERSION,
    ),
    request_id: accessApiUuidV4Schema,
    changed: z.boolean(),
    user_id: accessApiUuidV4Schema,
    access_generation: accessGenerationSchema,
    runs_to_terminate: z
      .array(
        z
          .object({
            run_id: accessApiUuidV4Schema,
            access_generation: accessGenerationSchema,
          })
          .strict(),
      )
      .readonly(),
  })
  .strict();

export type CreateAgentRunInput = z.infer<typeof createAgentRunInputSchema>;
export type SetDeveloperModeInput = z.infer<typeof setDeveloperModeInputSchema>;
export type AccessAgentRunCreateRequest = z.infer<
  typeof accessAgentRunCreateRequestSchema
>;
export type AccessDeveloperModeSetRequest = z.infer<
  typeof accessDeveloperModeSetRequestSchema
>;
export type AccessApiErrorCode = z.infer<typeof accessApiErrorCodeSchema>;
export type AccessApiErrorPayload = z.infer<typeof accessApiErrorPayloadSchema>;
export type AccessAgentRunCreateResponse = z.infer<
  typeof accessAgentRunCreateResponseSchema
>;
export type AccessDeveloperModeSetResponse = z.infer<
  typeof accessDeveloperModeSetResponseSchema
>;
export type AccessAgentRunHttpResponse = z.infer<
  typeof accessAgentRunHttpResponseSchema
>;
export type AccessRuntimeAgentRunLaunchRequest = z.infer<
  typeof accessRuntimeAgentRunLaunchRequestSchema
>;
export type AccessRuntimeAgentRunLaunchResponse = z.infer<
  typeof accessRuntimeAgentRunLaunchResponseSchema
>;
export type AccessDeveloperModeHttpResponse = z.infer<
  typeof accessDeveloperModeHttpResponseSchema
>;
