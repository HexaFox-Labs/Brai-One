import type { IncomingMessage } from "node:http";

import rateLimit from "@fastify/rate-limit";
import {
  ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION,
  ACCESS_AGENT_RUN_CREATE_SUBJECT,
  ACCESS_AGENT_RUN_HTTP_RESPONSE_SCHEMA_VERSION,
  ACCESS_DEVELOPER_MODE_HTTP_RESPONSE_SCHEMA_VERSION,
  ACCESS_DEVELOPER_MODE_SET_REQUEST_SCHEMA_VERSION,
  ACCESS_DEVELOPER_MODE_SET_SUBJECT,
  ACTIVITY_CREATE_SUBJECT,
  ACTIVITY_LIST_SUBJECT,
  CREATE_ACTIVITY_HTTP_RESPONSE_SCHEMA_VERSION,
  CREATE_ACTIVITY_REQUEST_SCHEMA_VERSION,
  LIST_ACTIVITIES_HTTP_RESPONSE_SCHEMA_VERSION,
  LIST_ACTIVITIES_REQUEST_SCHEMA_VERSION,
  accessAgentRunCreateResponseSchema,
  accessDeveloperModeSetResponseSchema,
  createAgentRunInputSchema,
  createActivityInputSchema,
  createActivityResponseSchema,
  listActivitiesQuerySchema,
  listActivityResponseSchema,
  setDeveloperModeInputSchema,
  uuidV4Schema,
  type AccessApiErrorPayload,
  type FactoryErrorPayload,
  type HttpErrorCode,
} from "@brai/contracts";
import { generateUuid, isUuid, type Logger } from "@brai/runtime";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

import type { GatewayMessageBus } from "./bus.js";
import type { GatewayConfig } from "./config.js";
import {
  GatewayAuthenticationError,
  PLATFORM_ADMIN_HEADER,
  createGatewayAuthenticator,
  type GatewayAuthenticator,
} from "./auth.js";
import { createHttpError } from "./http.js";

const MAX_HTTP_BODY_BYTES = 64 * 1_024;
const ONE_MINUTE = "1 minute";

class GatewayRateLimitError extends Error {
  public readonly code = "BRAI_RATE_LIMITED";
  public readonly statusCode = 429;

  public constructor() {
    super("Rate limit exceeded");
    this.name = "GatewayRateLimitError";
  }
}

export interface CreateGatewayAppOptions {
  config: GatewayConfig;
  bus: GatewayMessageBus;
  logger: Logger;
  authenticator?: GatewayAuthenticator;
}

function isLoopback(value: string): boolean {
  const address = value.toLowerCase();
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address === "localhost"
  );
}

function isJsonContentType(contentType: string | undefined): boolean {
  return (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

function sendError(
  reply: FastifyReply,
  requestId: string,
  statusCode: number,
  code: HttpErrorCode,
  message: string,
): FastifyReply {
  return reply
    .code(statusCode)
    .type("application/json")
    .send(createHttpError(requestId, code, message));
}

function sendFactoryError(
  reply: FastifyReply,
  requestId: string,
  error: FactoryErrorPayload,
): FastifyReply {
  switch (error.code) {
    case "idempotency_conflict":
      return sendError(reply, requestId, 409, error.code, error.message);
    case "invalid_request":
      return sendError(reply, requestId, 400, error.code, error.message);
    case "service_unavailable":
    case "internal_error":
      return sendError(
        reply,
        requestId,
        503,
        "service_unavailable",
        error.message,
      );
  }
}

function sendAccessError(
  reply: FastifyReply,
  requestId: string,
  error: AccessApiErrorPayload,
): FastifyReply {
  switch (error.code) {
    case "invalid_request":
      return sendError(reply, requestId, 400, "invalid_request", error.message);
    case "membership_not_found":
      return sendError(reply, requestId, 403, "forbidden", error.message);
    case "transition_in_progress":
      return sendError(reply, requestId, 409, "conflict", error.message);
    case "environment_unavailable":
    case "service_unavailable":
    case "internal_error":
      return sendError(
        reply,
        requestId,
        503,
        "service_unavailable",
        error.message,
      );
  }
}

function singleHeader(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function createOriginGuard(config: GatewayConfig) {
  const allowedOrigins = new Set(config.publicOrigins);
  const allowedHostnames = new Set(
    config.publicOrigins.map((origin) =>
      new URL(origin).hostname.toLowerCase(),
    ),
  );

  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    if (!request.url.startsWith("/api/")) {
      return;
    }

    const hostname = request.hostname.toLowerCase();
    const hostAllowed =
      allowedHostnames.has(hostname) ||
      (config.allowLoopbackHosts && isLoopback(hostname));

    if (!hostAllowed) {
      sendError(
        reply,
        request.id,
        400,
        "host_not_allowed",
        "Этот адрес запроса не разрешён.",
      );
      return;
    }

    const originHeader = request.headers.origin;

    if (originHeader !== undefined) {
      let normalizedOrigin: string;

      try {
        normalizedOrigin = new URL(originHeader).origin;
      } catch {
        sendError(
          reply,
          request.id,
          403,
          "origin_not_allowed",
          "Источник запроса не разрешён.",
        );
        return;
      }

      if (!allowedOrigins.has(normalizedOrigin)) {
        sendError(
          reply,
          request.id,
          403,
          "origin_not_allowed",
          "Источник запроса не разрешён.",
        );
        return;
      }
    }

    if (
      request.method === "POST" &&
      !isJsonContentType(request.headers["content-type"])
    ) {
      sendError(
        reply,
        request.id,
        415,
        "unsupported_media_type",
        "Отправьте данные в формате application/json.",
      );
    }
  };
}

function isFastifyErrorWithCode(
  error: unknown,
): error is Error & { code: string } {
  return (
    error instanceof Error && "code" in error && typeof error.code === "string"
  );
}

function requestIdFromHeader(request: IncomingMessage): string {
  const candidate = request.headers["x-request-id"];
  return isUuid(candidate) ? candidate : generateUuid();
}

export async function createGatewayApp(options: CreateGatewayAppOptions) {
  const app = Fastify({
    bodyLimit: MAX_HTTP_BODY_BYTES,
    loggerInstance: options.logger,
    // Production publishes this port on 127.0.0.1 only, so the single
    // upstream hop is the local Caddy reverse proxy.
    trustProxy: 1,
    genReqId: requestIdFromHeader,
  });

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: () => new GatewayRateLimitError(),
  });

  const originGuard = createOriginGuard(options.config);
  const accessAuthenticator =
    options.config.accessAuth === null
      ? null
      : (options.authenticator ??
        createGatewayAuthenticator(options.config.accessAuth));

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    await originGuard(request, reply);
  });

  app.addHook("onClose", async () => {
    await options.bus.drain();
  });

  app.get("/health/live", async (request) => ({
    status: "ok",
    service: "brai-api-gateway",
    request_id: request.id,
  }));

  app.get("/health/ready", async (request, reply) => {
    if (!(await options.bus.isReady())) {
      return reply.code(503).send({
        status: "not_ready",
        service: "brai-api-gateway",
        request_id: request.id,
        dependencies: {
          nats: "unavailable",
        },
      });
    }

    return {
      status: "ok",
      service: "brai-api-gateway",
      request_id: request.id,
      dependencies: {
        nats: "ok",
      },
    };
  });

  app.get(
    "/api/v1/activities",
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: ONE_MINUTE,
        },
      },
    },
    async (request, reply) => {
      const queryResult = listActivitiesQuerySchema.safeParse(request.query);

      if (!queryResult.success) {
        return sendError(
          reply,
          request.id,
          400,
          "invalid_request",
          "Проверьте параметры списка активностей.",
        );
      }

      const envelope = {
        schema_version: LIST_ACTIVITIES_REQUEST_SCHEMA_VERSION,
        request_id: request.id,
        sent_at: new Date().toISOString(),
        payload: queryResult.data,
      } as const;

      try {
        const rawResponse = await options.bus.request<unknown, unknown>(
          ACTIVITY_LIST_SUBJECT,
          envelope,
        );
        const responseResult =
          listActivityResponseSchema.safeParse(rawResponse);

        if (
          !responseResult.success ||
          responseResult.data.request_id !== request.id
        ) {
          request.log.error(
            {
              request_id: request.id,
              validation_error: responseResult.success
                ? "request_id_mismatch"
                : responseResult.error.flatten(),
            },
            "Некорректный ответ brai-factory",
          );
          return sendError(
            reply,
            request.id,
            503,
            "service_unavailable",
            "Сервис активностей временно недоступен.",
          );
        }

        if (!responseResult.data.payload.ok) {
          return sendFactoryError(
            reply,
            request.id,
            responseResult.data.payload,
          );
        }

        return {
          schema_version: LIST_ACTIVITIES_HTTP_RESPONSE_SCHEMA_VERSION,
          request_id: request.id,
          activities: responseResult.data.payload.activities,
          next_cursor: responseResult.data.payload.next_cursor,
        };
      } catch (error) {
        request.log.error(
          { err: error, request_id: request.id },
          "Не удалось получить Activity через NATS",
        );
        return sendError(
          reply,
          request.id,
          503,
          "service_unavailable",
          "Сервис активностей временно недоступен.",
        );
      }
    },
  );

  app.post(
    "/api/v1/activities",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: ONE_MINUTE,
        },
      },
    },
    async (request, reply) => {
      const idempotencyKey = request.headers["idempotency-key"];
      const idempotencyResult = uuidV4Schema.safeParse(idempotencyKey);

      if (!idempotencyResult.success) {
        return sendError(
          reply,
          request.id,
          400,
          "invalid_request",
          "Заголовок Idempotency-Key должен содержать UUID v4.",
        );
      }

      const inputResult = createActivityInputSchema.safeParse(request.body);

      if (!inputResult.success) {
        return sendError(
          reply,
          request.id,
          400,
          "invalid_request",
          "Проверьте заголовок и описание Activity.",
        );
      }

      const envelope = {
        schema_version: CREATE_ACTIVITY_REQUEST_SCHEMA_VERSION,
        request_id: request.id,
        sent_at: new Date().toISOString(),
        payload: {
          idempotency_key: idempotencyResult.data,
          ...inputResult.data,
        },
      } as const;

      try {
        const rawResponse = await options.bus.request<unknown, unknown>(
          ACTIVITY_CREATE_SUBJECT,
          envelope,
        );
        const responseResult =
          createActivityResponseSchema.safeParse(rawResponse);

        if (
          !responseResult.success ||
          responseResult.data.request_id !== request.id
        ) {
          request.log.error(
            {
              request_id: request.id,
              validation_error: responseResult.success
                ? "request_id_mismatch"
                : responseResult.error.flatten(),
            },
            "Некорректный ответ brai-factory",
          );
          return sendError(
            reply,
            request.id,
            503,
            "service_unavailable",
            "Сервис активностей временно недоступен.",
          );
        }

        if (!responseResult.data.payload.ok) {
          return sendFactoryError(
            reply,
            request.id,
            responseResult.data.payload,
          );
        }

        return reply
          .code(responseResult.data.payload.idempotent_replay ? 200 : 201)
          .send({
            schema_version: CREATE_ACTIVITY_HTTP_RESPONSE_SCHEMA_VERSION,
            request_id: request.id,
            activity: responseResult.data.payload.activity,
            idempotent_replay: responseResult.data.payload.idempotent_replay,
          });
      } catch (error) {
        request.log.error(
          { err: error, request_id: request.id },
          "Не удалось создать Activity через NATS",
        );
        return sendError(
          reply,
          request.id,
          503,
          "service_unavailable",
          "Не удалось сохранить Activity. Повторите попытку.",
        );
      }
    },
  );

  if (accessAuthenticator !== null) {
    app.post(
      "/api/v1/agent-runs",
      {
        config: {
          rateLimit: {
            max: 30,
            timeWindow: ONE_MINUTE,
          },
        },
      },
      async (request, reply) => {
        const user = await accessAuthenticator.authenticateUser(
          singleHeader(request.headers.authorization),
        );
        const input = createAgentRunInputSchema.safeParse(request.body);
        if (!input.success) {
          return sendError(
            reply,
            request.id,
            400,
            "invalid_request",
            "Проверьте проект и задачу агента.",
          );
        }

        const envelope = {
          schema_version: ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION,
          request_id: request.id,
          sent_at: new Date().toISOString(),
          payload: {
            authenticated_user_id: user.userId,
            project_id: input.data.project_id,
            prompt: input.data.prompt,
          },
        } as const;

        try {
          const rawResponse = await options.bus.request<unknown, unknown>(
            ACCESS_AGENT_RUN_CREATE_SUBJECT,
            envelope,
          );
          const response =
            accessAgentRunCreateResponseSchema.safeParse(rawResponse);
          if (!response.success || response.data.request_id !== request.id) {
            request.log.error(
              {
                request_id: request.id,
                validation_error: response.success
                  ? "request_id_mismatch"
                  : response.error.flatten(),
              },
              "Некорректный ответ brai-access на запуск",
            );
            return sendError(
              reply,
              request.id,
              503,
              "service_unavailable",
              "Сервис запуска временно недоступен.",
            );
          }

          if (!response.data.payload.ok) {
            return sendAccessError(reply, request.id, response.data.payload);
          }

          return reply.code(202).send({
            schema_version: ACCESS_AGENT_RUN_HTTP_RESPONSE_SCHEMA_VERSION,
            request_id: request.id,
            run_id: response.data.payload.run_id,
            project_id: response.data.payload.project_id,
            status: response.data.payload.status,
          });
        } catch (error) {
          request.log.error(
            { err: error, request_id: request.id },
            "Не удалось запросить запуск через brai-access",
          );
          return sendError(
            reply,
            request.id,
            503,
            "service_unavailable",
            "Сервис запуска временно недоступен.",
          );
        }
      },
    );

    app.post(
      "/api/v1/admin/users/:user_id/developer-mode",
      {
        config: {
          rateLimit: {
            max: 30,
            timeWindow: ONE_MINUTE,
          },
        },
      },
      async (request, reply) => {
        const admin = accessAuthenticator.authenticatePlatformAdmin(
          singleHeader(request.headers[PLATFORM_ADMIN_HEADER]),
        );
        const params = uuidV4Schema.safeParse(
          (request.params as { user_id?: unknown }).user_id,
        );
        const input = setDeveloperModeInputSchema.safeParse(request.body);
        if (!params.success || !input.success) {
          return sendError(
            reply,
            request.id,
            400,
            "invalid_request",
            "Проверьте пользователя и значение режима разработчика.",
          );
        }

        const envelope = {
          schema_version: ACCESS_DEVELOPER_MODE_SET_REQUEST_SCHEMA_VERSION,
          request_id: request.id,
          sent_at: new Date().toISOString(),
          payload: {
            platform_admin_user_id: admin.actorUserId,
            target_user_id: params.data,
            developer_mode: input.data.developer_mode,
          },
        } as const;

        try {
          const rawResponse = await options.bus.request<unknown, unknown>(
            ACCESS_DEVELOPER_MODE_SET_SUBJECT,
            envelope,
          );
          const response =
            accessDeveloperModeSetResponseSchema.safeParse(rawResponse);
          if (!response.success || response.data.request_id !== request.id) {
            request.log.error(
              {
                request_id: request.id,
                validation_error: response.success
                  ? "request_id_mismatch"
                  : response.error.flatten(),
              },
              "Некорректный ответ brai-access на смену режима",
            );
            return sendError(
              reply,
              request.id,
              503,
              "service_unavailable",
              "Сервис доступа временно недоступен.",
            );
          }

          if (!response.data.payload.ok) {
            return sendAccessError(reply, request.id, response.data.payload);
          }

          return reply.code(200).send({
            schema_version: ACCESS_DEVELOPER_MODE_HTTP_RESPONSE_SCHEMA_VERSION,
            request_id: request.id,
            changed: response.data.payload.changed,
            user_id: response.data.payload.user_id,
            access_generation: response.data.payload.access_generation,
            runs_to_terminate: response.data.payload.runs_to_terminate,
          });
        } catch (error) {
          request.log.error(
            { err: error, request_id: request.id },
            "Не удалось сменить режим через brai-access",
          );
          return sendError(
            reply,
            request.id,
            503,
            "service_unavailable",
            "Сервис доступа временно недоступен.",
          );
        }
      },
    );
  }

  app.setNotFoundHandler((request, reply) =>
    sendError(
      reply,
      request.id,
      404,
      "not_found",
      "Такой адрес API не найден.",
    ),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof GatewayAuthenticationError) {
      return sendError(
        reply,
        request.id,
        401,
        "authentication_required",
        "Требуется действительная серверная аутентификация.",
      );
    }

    if (error instanceof GatewayRateLimitError) {
      return sendError(
        reply,
        request.id,
        429,
        "rate_limited",
        "Слишком много запросов. Попробуйте ещё раз через минуту.",
      );
    }

    if (
      isFastifyErrorWithCode(error) &&
      error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE"
    ) {
      return sendError(
        reply,
        request.id,
        415,
        "unsupported_media_type",
        "Отправьте данные в формате application/json.",
      );
    }

    if (
      isFastifyErrorWithCode(error) &&
      error.code === "FST_ERR_CTP_BODY_TOO_LARGE"
    ) {
      return sendError(
        reply,
        request.id,
        400,
        "invalid_request",
        "Тело запроса слишком большое.",
      );
    }

    if (
      isFastifyErrorWithCode(error) &&
      error.code === "FST_ERR_CTP_INVALID_JSON_BODY"
    ) {
      return sendError(
        reply,
        request.id,
        400,
        "invalid_request",
        "Тело запроса содержит некорректный JSON.",
      );
    }

    request.log.error(
      { err: error, request_id: request.id },
      "Необработанная ошибка API Gateway",
    );
    return sendError(
      reply,
      request.id,
      500,
      "internal_error",
      "Внутренняя ошибка API Gateway.",
    );
  });

  return app;
}
