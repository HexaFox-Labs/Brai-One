import {
  CREATE_ACTIVITY_RESPONSE_SCHEMA_VERSION,
  LIST_ACTIVITIES_RESPONSE_SCHEMA_VERSION,
  type CreateActivityRequest,
  type ListActivityRequest,
} from "@brai/contracts";
import { createLogger, isUuid } from "@brai/runtime";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createGatewayApp } from "../src/app.js";
import type { GatewayMessageBus } from "../src/bus.js";
import type { GatewayConfig } from "../src/config.js";

const ACTIVITY_ID = "2d4e83b4-4ad0-4aa1-a63e-cee1d6a1d1d4";
const IDEMPOTENCY_KEY = "3f88bde1-2b49-46cb-914d-7500afdf82d6";
const REQUEST_ID = "503d93dc-5926-4271-98b0-0c6437b46d1f";

const config: GatewayConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3_201,
  logLevel: "silent",
  natsServers: ["nats://brai-nats:4222"],
  natsUser: "gateway",
  natsPassword: "not-used-by-tests",
  natsInboxPrefix: "_INBOX.brai.gateway",
  natsRequestTimeoutMs: 5_000,
  publicOrigins: ["https://factory.brai.one"],
  allowLoopbackHosts: true,
  accessAuth: null,
};

const activity = {
  id: ACTIVITY_ID,
  title: "Activity",
  description: "Описание",
  created_at: "2026-07-16T12:00:00.000Z",
} as const;

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function mockBus(
  requestImplementation: (
    subject: string,
    request: unknown,
  ) => Promise<unknown>,
  ready = true,
): GatewayMessageBus {
  return {
    request: requestImplementation as GatewayMessageBus["request"],
    isReady: async () => ready,
    drain: vi.fn().mockResolvedValue(undefined),
  };
}

async function buildApp(bus: GatewayMessageBus): Promise<FastifyInstance> {
  const app = await createGatewayApp({
    config,
    bus,
    logger: createLogger({
      name: "api-gateway-test",
      level: "silent",
    }),
  });
  openApps.push(app);
  return app;
}

function createResponse(requestId: string, replay = false) {
  return {
    schema_version: CREATE_ACTIVITY_RESPONSE_SCHEMA_VERSION,
    request_id: requestId,
    sent_at: "2026-07-16T12:00:01.000Z",
    payload: {
      ok: true,
      activity,
      idempotent_replay: replay,
    },
  } as const;
}

describe("API Gateway", () => {
  it("lists activities through a versioned NATS request", async () => {
    const request = vi.fn(
      async (_subject: string, message: unknown): Promise<unknown> => {
        const envelope = message as ListActivityRequest;
        return {
          schema_version: LIST_ACTIVITIES_RESPONSE_SCHEMA_VERSION,
          request_id: envelope.request_id,
          sent_at: "2026-07-16T12:00:01.000Z",
          payload: {
            ok: true,
            activities: [activity],
            next_cursor: null,
          },
        };
      },
    );
    const app = await buildApp(mockBus(request));

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/activities?limit=50",
      headers: {
        host: "factory.brai.one",
        "x-request-id": REQUEST_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      request_id: REQUEST_ID,
      activities: [activity],
      next_cursor: null,
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("creates an activity, trims input and returns 201", async () => {
    const request = vi.fn(
      async (_subject: string, message: unknown): Promise<unknown> => {
        const envelope = message as CreateActivityRequest;
        expect(envelope.payload).toEqual({
          idempotency_key: IDEMPOTENCY_KEY,
          title: "Activity",
          description: "Описание",
        });
        return createResponse(envelope.request_id);
      },
    );
    const app = await buildApp(mockBus(request));

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/activities",
      headers: {
        host: "factory.brai.one",
        origin: "https://factory.brai.one",
        "content-type": "application/json",
        "idempotency-key": IDEMPOTENCY_KEY,
        "x-request-id": REQUEST_ID,
      },
      payload: {
        title: "  Activity  ",
        description: "  Описание  ",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      request_id: REQUEST_ID,
      activity,
      idempotent_replay: false,
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("returns 200 for an idempotent replay", async () => {
    const app = await buildApp(
      mockBus(async (_subject, message) =>
        createResponse((message as CreateActivityRequest).request_id, true),
      ),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/activities",
      headers: {
        host: "factory.brai.one",
        "content-type": "application/json",
        "idempotency-key": IDEMPOTENCY_KEY,
      },
      payload: {
        title: "Activity",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      idempotent_replay: true,
    });
  });

  it("maps an idempotency conflict to 409", async () => {
    const app = await buildApp(
      mockBus(async (_subject, message) => ({
        schema_version: CREATE_ACTIVITY_RESPONSE_SCHEMA_VERSION,
        request_id: (message as CreateActivityRequest).request_id,
        sent_at: "2026-07-16T12:00:01.000Z",
        payload: {
          ok: false,
          code: "idempotency_conflict",
          message: "Этот ключ уже использован с другим содержимым.",
        },
      })),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/activities",
      headers: {
        host: "factory.brai.one",
        "content-type": "application/json",
        "idempotency-key": IDEMPOTENCY_KEY,
      },
      payload: {
        title: "Activity",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "idempotency_conflict",
    });
  });

  it("rejects invalid input before NATS", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp(mockBus(request));

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/activities",
      headers: {
        host: "factory.brai.one",
        "content-type": "application/json",
        "idempotency-key": "not-a-uuid",
      },
      payload: {
        title: "",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it("requires JSON and rejects a foreign origin", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp(mockBus(request));

    const wrongContentType = await app.inject({
      method: "POST",
      url: "/api/v1/activities",
      headers: {
        host: "factory.brai.one",
        "content-type": "text/plain",
        "idempotency-key": IDEMPOTENCY_KEY,
      },
      payload: "{}",
    });
    expect(wrongContentType.statusCode).toBe(415);

    const wrongOrigin = await app.inject({
      method: "GET",
      url: "/api/v1/activities",
      headers: {
        host: "factory.brai.one",
        origin: "https://example.com",
      },
    });
    expect(wrongOrigin.statusCode).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects an untrusted Host before NATS", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp(mockBus(request));

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/activities",
      headers: {
        host: "example.com",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "host_not_allowed",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a body above the Gateway limit", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp(mockBus(request));

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/activities",
      headers: {
        host: "factory.brai.one",
        "content-type": "application/json",
        "idempotency-key": IDEMPOTENCY_KEY,
      },
      payload: JSON.stringify({
        title: "Activity",
        description: "x".repeat(70_000),
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "invalid_request",
      message: "Тело запроса слишком большое.",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON without calling NATS", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp(mockBus(request));

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/activities",
      headers: {
        host: "factory.brai.one",
        "content-type": "application/json",
        "idempotency-key": IDEMPOTENCY_KEY,
      },
      payload: "{",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "invalid_request",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("replaces an invalid request id", async () => {
    const app = await buildApp(
      mockBus(async (_subject, message) =>
        createResponse((message as CreateActivityRequest).request_id),
      ),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/activities",
      headers: {
        host: "factory.brai.one",
        "content-type": "application/json",
        "idempotency-key": IDEMPOTENCY_KEY,
        "x-request-id": "invalid",
      },
      payload: {
        title: "Activity",
      },
    });

    const body = response.json();
    expect(response.statusCode).toBe(201);
    expect(isUuid(body.request_id)).toBe(true);
    expect(response.headers["x-request-id"]).toBe(body.request_id);
  });

  it("reports NATS failures as 503 without retrying", async () => {
    const request = vi.fn().mockRejectedValue(new Error("NATS unavailable"));
    const app = await buildApp(mockBus(request));

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/activities",
      headers: {
        host: "factory.brai.one",
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: "service_unavailable",
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("exposes separate live and ready health states", async () => {
    const app = await buildApp(mockBus(async () => undefined, false));

    const live = await app.inject({
      method: "GET",
      url: "/health/live",
    });
    const ready = await app.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(503);
  });

  it("drains NATS when Fastify closes", async () => {
    const bus = mockBus(async () => undefined);
    const app = await buildApp(bus);

    await app.close();
    openApps.splice(openApps.indexOf(app), 1);

    expect(bus.drain).toHaveBeenCalledOnce();
  });

  it("limits creation to 30 requests per minute per IP", async () => {
    const app = await buildApp(
      mockBus(async (_subject, message) =>
        createResponse((message as CreateActivityRequest).request_id),
      ),
    );

    const responses = [];
    for (let index = 0; index < 31; index += 1) {
      responses.push(
        await app.inject({
          method: "POST",
          url: "/api/v1/activities",
          headers: {
            host: "factory.brai.one",
            "content-type": "application/json",
            "idempotency-key": IDEMPOTENCY_KEY,
            "x-forwarded-for": "198.51.100.10",
          },
          payload: {
            title: "Activity",
          },
        }),
      );
    }

    expect(
      responses.filter((response) => response.statusCode === 201),
    ).toHaveLength(30);
    const limitedResponse = responses.find(
      (response) => response.statusCode === 429,
    );
    expect(limitedResponse).toBeDefined();
    expect(limitedResponse?.json()).toMatchObject({
      code: "rate_limited",
    });

    const otherIp = await app.inject({
      method: "POST",
      url: "/api/v1/activities",
      headers: {
        host: "factory.brai.one",
        "content-type": "application/json",
        "idempotency-key": IDEMPOTENCY_KEY,
        "x-forwarded-for": "198.51.100.11",
      },
      payload: {
        title: "Activity",
      },
    });

    expect(otherIp.statusCode).toBe(201);
  });

  it("limits reads to 120 requests per minute per proxy IP", async () => {
    const app = await buildApp(
      mockBus(async (_subject, message) => ({
        schema_version: LIST_ACTIVITIES_RESPONSE_SCHEMA_VERSION,
        request_id: (message as ListActivityRequest).request_id,
        sent_at: "2026-07-16T12:00:01.000Z",
        payload: {
          ok: true,
          activities: [],
          next_cursor: null,
        },
      })),
    );

    const responses = [];
    for (let index = 0; index < 121; index += 1) {
      responses.push(
        await app.inject({
          method: "GET",
          url: "/api/v1/activities",
          headers: {
            host: "factory.brai.one",
            "x-forwarded-for": "198.51.100.20",
          },
        }),
      );
    }

    expect(
      responses.filter((response) => response.statusCode === 200),
    ).toHaveLength(120);
    expect(
      responses.find((response) => response.statusCode === 429)?.json(),
    ).toMatchObject({
      code: "rate_limited",
    });
  });
});
