import {
  ACCESS_AGENT_RUN_CREATE_RESPONSE_SCHEMA_VERSION,
  ACCESS_AGENT_RUN_CREATE_SUBJECT,
  ACCESS_DEVELOPER_MODE_SET_RESPONSE_SCHEMA_VERSION,
  ACCESS_DEVELOPER_MODE_SET_SUBJECT,
  type AccessAgentRunCreateRequest,
  type AccessDeveloperModeSetRequest,
} from "@brai/contracts";
import { createLogger } from "@brai/runtime";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createGatewayApp } from "../src/app.js";
import {
  GatewayAuthenticationError,
  type GatewayAuthenticator,
} from "../src/auth.js";
import type { GatewayMessageBus } from "../src/bus.js";
import type { GatewayConfig } from "../src/config.js";

const REQUEST_ID = "1f88bde1-2b49-46cb-914d-7500afdf82d6";
const PROJECT_ID = "2f88bde1-2b49-46cb-914d-7500afdf82d6";
const USER_ID = "3f88bde1-2b49-46cb-914d-7500afdf82d6";
const ADMIN_ID = "4f88bde1-2b49-46cb-914d-7500afdf82d6";
const TARGET_USER_ID = "5f88bde1-2b49-46cb-914d-7500afdf82d6";
const RUN_ID = "6f88bde1-2b49-46cb-914d-7500afdf82d6";
const PROMPT = "Собери страницу проекта";

const accessConfig: GatewayConfig = {
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
  accessAuth: {
    issuer: "https://auth.example.test",
    jwksUrl: "https://auth.example.test/.well-known/jwks.json",
    audience: "authenticated",
    platformAdminHeaderSecret: "x".repeat(32),
    platformAdminActorId: ADMIN_ID,
  },
};

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function mockBus(
  requestImplementation: (
    subject: string,
    request: unknown,
  ) => Promise<unknown>,
): GatewayMessageBus {
  return {
    request: requestImplementation as GatewayMessageBus["request"],
    isReady: async () => true,
    drain: vi.fn().mockResolvedValue(undefined),
  };
}

function authenticator(): GatewayAuthenticator {
  return {
    authenticateUser: vi.fn(async () => ({ userId: USER_ID })),
    authenticatePlatformAdmin: vi.fn(() => ({
      actorUserId: ADMIN_ID,
    })),
  };
}

async function buildApp(
  bus: GatewayMessageBus,
  auth: GatewayAuthenticator = authenticator(),
): Promise<FastifyInstance> {
  const app = await createGatewayApp({
    config: accessConfig,
    bus,
    logger: createLogger({
      name: "api-gateway-access-test",
      level: "silent",
    }),
    authenticator: auth,
  });
  openApps.push(app);
  return app;
}

function postHeaders() {
  return {
    host: "factory.brai.one",
    origin: "https://factory.brai.one",
    "content-type": "application/json",
    "x-request-id": REQUEST_ID,
  };
}

describe("API Gateway access boundary", () => {
  it("derives the launch user from JWT auth and sends only allowed task data", async () => {
    const request = vi.fn(
      async (subject: string, message: unknown): Promise<unknown> => {
        expect(subject).toBe(ACCESS_AGENT_RUN_CREATE_SUBJECT);
        const envelope = message as AccessAgentRunCreateRequest;
        expect(envelope.payload).toEqual({
          authenticated_user_id: USER_ID,
          project_id: PROJECT_ID,
          prompt: PROMPT,
        });
        return {
          schema_version: ACCESS_AGENT_RUN_CREATE_RESPONSE_SCHEMA_VERSION,
          request_id: envelope.request_id,
          sent_at: "2026-07-17T12:00:01.000Z",
          payload: {
            ok: true,
            run_id: RUN_ID,
            project_id: PROJECT_ID,
            status: "pending",
          },
        };
      },
    );
    const auth = authenticator();
    const app = await buildApp(mockBus(request), auth);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/agent-runs",
      headers: {
        ...postHeaders(),
        authorization: "Bearer verified-upstream-token",
      },
      payload: {
        project_id: PROJECT_ID,
        prompt: PROMPT,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      request_id: REQUEST_ID,
      run_id: RUN_ID,
      project_id: PROJECT_ID,
      status: "pending",
    });
    expect(auth.authenticateUser).toHaveBeenCalledWith(
      "Bearer verified-upstream-token",
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("rejects client-selected authority fields before NATS", async () => {
    const request = vi.fn();
    const app = await buildApp(mockBus(request));

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/agent-runs",
      headers: postHeaders(),
      payload: {
        project_id: PROJECT_ID,
        prompt: PROMPT,
        authenticated_user_id: TARGET_USER_ID,
        profile: "developer",
        access_generation: 99,
        uid: 0,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "invalid_request" });
    expect(request).not.toHaveBeenCalled();
  });

  it("returns 401 when the Supabase JWT is not authenticated", async () => {
    const request = vi.fn();
    const auth = authenticator();
    auth.authenticateUser = vi.fn(async () => {
      throw new GatewayAuthenticationError();
    });
    const app = await buildApp(mockBus(request), auth);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/agent-runs",
      headers: postHeaders(),
      payload: {
        project_id: PROJECT_ID,
        prompt: PROMPT,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "authentication_required",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("derives the platform-admin actor and target user outside the body", async () => {
    const request = vi.fn(
      async (subject: string, message: unknown): Promise<unknown> => {
        expect(subject).toBe(ACCESS_DEVELOPER_MODE_SET_SUBJECT);
        const envelope = message as AccessDeveloperModeSetRequest;
        expect(envelope.payload).toEqual({
          platform_admin_user_id: ADMIN_ID,
          target_user_id: TARGET_USER_ID,
          developer_mode: true,
        });
        return {
          schema_version: ACCESS_DEVELOPER_MODE_SET_RESPONSE_SCHEMA_VERSION,
          request_id: envelope.request_id,
          sent_at: "2026-07-17T12:00:01.000Z",
          payload: {
            ok: true,
            changed: true,
            user_id: TARGET_USER_ID,
            access_generation: 2,
            runs_to_terminate: [],
          },
        };
      },
    );
    const auth = authenticator();
    const app = await buildApp(mockBus(request), auth);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${TARGET_USER_ID}/developer-mode`,
      headers: {
        ...postHeaders(),
        "x-brai-platform-admin": "proxy-injected-secret",
      },
      payload: {
        developer_mode: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      changed: true,
      user_id: TARGET_USER_ID,
      access_generation: 2,
    });
    expect(auth.authenticatePlatformAdmin).toHaveBeenCalledWith(
      "proxy-injected-secret",
    );
    expect(request).toHaveBeenCalledOnce();
  });
});
