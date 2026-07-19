import { generateKeyPairSync } from "node:crypto";

import { verifyInternalAgentLaunchContract } from "@brai/agent-access";
import {
  ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION,
  ACCESS_AGENT_RUN_CREATE_RESPONSE_SCHEMA_VERSION,
  ACCESS_DEVELOPER_MODE_SET_REQUEST_SCHEMA_VERSION,
  ACCESS_DEVELOPER_MODE_SET_RESPONSE_SCHEMA_VERSION,
  BRAI_SINGLE_RUNTIME_HOST_ID,
  LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
} from "@brai/contracts";
import { createLogger } from "@brai/runtime";
import { describe, expect, it, vi } from "vitest";

import {
  AccessApiService,
  type AccessApiCommands,
  type DeveloperModeHandler,
} from "../src/access-api-service.js";
import { AccessServiceError } from "../src/errors.js";
import type { EnvironmentProvisioner } from "../src/environment-provisioning-coordinator.js";
import { Ed25519LaunchContractIssuer } from "../src/launch-contract-issuer.js";
import {
  RuntimeDispatchError,
  type RuntimeDispatchInput,
  type RuntimeDispatcher,
} from "../src/runtime-dispatcher.js";
import {
  actorFromTrustedContext,
  assertTrustedPlatformAdminContext,
} from "../src/trusted-context.js";
import {
  WEB_AGENT_COMMAND_SHA256,
  WEB_AGENT_JOB_REFERENCE_PREFIX,
  webAgentJobReference,
} from "../src/web-agent-job-policy.js";
import type { PendingLaunch } from "../src/types.js";

const REQUEST_ID = "1f88bde1-2b49-46cb-914d-7500afdf82d6";
const PROJECT_ID = "2f88bde1-2b49-46cb-914d-7500afdf82d6";
const USER_ID = "3f88bde1-2b49-46cb-914d-7500afdf82d6";
const ADMIN_ID = "4f88bde1-2b49-46cb-914d-7500afdf82d6";
const RUN_ID = "5f88bde1-2b49-46cb-914d-7500afdf82d6";
const ENVIRONMENT_ID = "6f88bde1-2b49-46cb-914d-7500afdf82d6";
const SENT_AT = "2026-07-17T12:00:00.000Z";
const PROMPT = "Собери страницу проекта";
const SIGNING_KEY_ID = "brai-access-test-key";
const SIGNING_KEYS = generateKeyPairSync("ed25519");

function logger() {
  return createLogger({
    name: "brai-access-api-test",
    level: "silent",
  });
}

function pendingLaunch(): PendingLaunch {
  return {
    run_id: RUN_ID,
    project_id: PROJECT_ID,
    environment_id: ENVIRONMENT_ID,
    runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
    job: {
      reference: webAgentJobReference(PROMPT),
      command_sha256: WEB_AGENT_COMMAND_SHA256,
    },
    status: "pending",
    access: {
      schema_version: LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
      user_id: USER_ID,
      profile: "user-sandbox",
      access_generation: 1,
      quota: {
        bytes: 5_368_709_120,
        inodes: 500_000,
      },
    },
  };
}

function service(
  overrides: Partial<AccessApiCommands> = {},
  runtimeDispatcher: RuntimeDispatcher = {
    dispatch: vi.fn(async () => undefined),
  },
  developerMode: DeveloperModeHandler = {
    setMode: vi.fn(async () => ({
      changed: true,
      user_id: USER_ID,
      access_generation: 2,
      runs_to_terminate: [],
    })),
  },
  environmentProvisioner: EnvironmentProvisioner = {
    ensureReady: vi.fn(async () => undefined),
  },
): AccessApiService {
  const commands: AccessApiCommands = {
    createPendingLaunch: vi.fn(async () => pendingLaunch()),
    ...overrides,
  };
  return new AccessApiService(
    commands,
    new Ed25519LaunchContractIssuer({
      keyId: SIGNING_KEY_ID,
      privateKey: SIGNING_KEYS.privateKey,
      now: () => new Date(SENT_AT),
    }),
    runtimeDispatcher,
    environmentProvisioner,
    developerMode,
    logger(),
  );
}

describe("AccessApiService", () => {
  it("derives trusted user context and fixes the executable job server-side", async () => {
    const createPendingLaunch = vi.fn(async (context, command: unknown) => {
      expect(actorFromTrustedContext(context)).toBe(USER_ID);
      expect(command).toEqual({
        project_id: PROJECT_ID,
        job_reference: webAgentJobReference(PROMPT),
        command_sha256: WEB_AGENT_COMMAND_SHA256,
      });
      return pendingLaunch();
    }) satisfies AccessApiCommands["createPendingLaunch"];
    const api = service({ createPendingLaunch });

    const response = await api.handleCreateAgentRun({
      schema_version: ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION,
      request_id: REQUEST_ID,
      sent_at: SENT_AT,
      payload: {
        authenticated_user_id: USER_ID,
        project_id: PROJECT_ID,
        prompt: PROMPT,
      },
    });

    expect(response).toMatchObject({
      schema_version: ACCESS_AGENT_RUN_CREATE_RESPONSE_SCHEMA_VERSION,
      request_id: REQUEST_ID,
      payload: {
        ok: true,
        run_id: RUN_ID,
        project_id: PROJECT_ID,
        status: "pending",
      },
    });
    expect(createPendingLaunch).toHaveBeenCalledOnce();
  });

  it("rejects a client-selected profile before calling the domain service", async () => {
    const createPendingLaunch = vi.fn();
    const api = service({
      createPendingLaunch:
        createPendingLaunch as AccessApiCommands["createPendingLaunch"],
    });

    const response = await api.handleCreateAgentRun({
      schema_version: ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION,
      request_id: REQUEST_ID,
      sent_at: SENT_AT,
      payload: {
        authenticated_user_id: USER_ID,
        project_id: PROJECT_ID,
        prompt: PROMPT,
        profile: "developer",
      },
    });

    expect(response.payload).toMatchObject({
      ok: false,
      code: "invalid_request",
    });
    expect(createPendingLaunch).not.toHaveBeenCalled();
  });

  it("maps an unavailable sandbox to a bounded transport error", async () => {
    const api = service({
      createPendingLaunch: vi.fn(async () => {
        throw new AccessServiceError(
          "access_environment_unavailable",
          "host path must not escape",
        );
      }),
    });

    const response = await api.handleCreateAgentRun({
      schema_version: ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION,
      request_id: REQUEST_ID,
      sent_at: SENT_AT,
      payload: {
        authenticated_user_id: USER_ID,
        project_id: PROJECT_ID,
        prompt: PROMPT,
      },
    });

    expect(response.payload).toEqual({
      ok: false,
      code: "environment_unavailable",
      message: "Изолированное окружение пользователя ещё не готово.",
    });
  });

  it("provisions the first sandbox server-side and retries the immutable launch", async () => {
    let attempts = 0;
    const launchCommands: unknown[] = [];
    const createPendingLaunch = vi.fn(async (_context, command: unknown) => {
      launchCommands.push(command);
      attempts += 1;
      if (attempts === 1) {
        throw new AccessServiceError(
          "access_environment_unavailable",
          "not ready",
        );
      }
      return pendingLaunch();
    }) satisfies AccessApiCommands["createPendingLaunch"];
    const ensureReady = vi.fn(async (userId: string) => {
      expect(userId).toBe(USER_ID);
    });
    const api = service({ createPendingLaunch }, undefined, undefined, {
      ensureReady,
    });

    await expect(
      api.handleCreateAgentRun({
        schema_version: ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION,
        request_id: REQUEST_ID,
        sent_at: SENT_AT,
        payload: {
          authenticated_user_id: USER_ID,
          project_id: PROJECT_ID,
          prompt: PROMPT,
        },
      }),
    ).resolves.toMatchObject({
      payload: { ok: true, run_id: RUN_ID },
    });
    expect(ensureReady).toHaveBeenCalledOnce();
    expect(createPendingLaunch).toHaveBeenCalledTimes(2);
    expect(launchCommands[0]).toEqual(launchCommands[1]);
  });

  it("does not report a pending run as accepted when runtime dispatch fails", async () => {
    const api = service(
      {},
      {
        dispatch: vi.fn(async () => {
          throw new RuntimeDispatchError("runtime unavailable");
        }),
      },
    );

    const response = await api.handleCreateAgentRun({
      schema_version: ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION,
      request_id: REQUEST_ID,
      sent_at: SENT_AT,
      payload: {
        authenticated_user_id: USER_ID,
        project_id: PROJECT_ID,
        prompt: PROMPT,
      },
    });

    expect(response.payload).toMatchObject({
      ok: false,
      code: "service_unavailable",
    });
  });

  it("creates the platform-admin context only inside the NATS handler", async () => {
    const setMode = vi.fn(async (context, command: unknown) => {
      assertTrustedPlatformAdminContext(context);
      expect(command).toEqual({
        target_user_id: USER_ID,
        requested_developer_mode: true,
      });
      return {
        changed: true,
        user_id: USER_ID,
        access_generation: 2,
        runs_to_terminate: [],
      };
    }) satisfies DeveloperModeHandler["setMode"];
    const api = service({}, undefined, { setMode });

    const response = await api.handleSetDeveloperMode({
      schema_version: ACCESS_DEVELOPER_MODE_SET_REQUEST_SCHEMA_VERSION,
      request_id: REQUEST_ID,
      sent_at: SENT_AT,
      payload: {
        platform_admin_user_id: ADMIN_ID,
        target_user_id: USER_ID,
        developer_mode: true,
      },
    });

    expect(response).toMatchObject({
      schema_version: ACCESS_DEVELOPER_MODE_SET_RESPONSE_SCHEMA_VERSION,
      request_id: REQUEST_ID,
      payload: {
        ok: true,
        changed: true,
        user_id: USER_ID,
        access_generation: 2,
        runs_to_terminate: [],
      },
    });
    expect(setMode).toHaveBeenCalledOnce();
  });

  it("keeps the exact immutable command digest stable", () => {
    expect(WEB_AGENT_JOB_REFERENCE_PREFIX).toBe("brai.web-agent.codex-exec.v1");
    expect(WEB_AGENT_COMMAND_SHA256).toMatch(/^[a-f0-9]{64}$/u);
    expect(webAgentJobReference(PROMPT)).toMatch(
      /^brai\.web-agent\.codex-exec\.v1:[a-f0-9]{64}$/u,
    );
  });

  it("returns an Ed25519-signed launch contract bound to the task", async () => {
    let dispatched: RuntimeDispatchInput | undefined;
    const api = service(
      {},
      {
        dispatch: vi.fn(async (input) => {
          dispatched = input;
        }),
      },
    );
    const response = await api.handleCreateAgentRun({
      schema_version: ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION,
      request_id: REQUEST_ID,
      sent_at: SENT_AT,
      payload: {
        authenticated_user_id: USER_ID,
        project_id: PROJECT_ID,
        prompt: PROMPT,
      },
    });

    if (!response.payload.ok) {
      throw new Error("Expected a successful launch response");
    }
    expect(dispatched).toBeDefined();
    const contract = verifyInternalAgentLaunchContract(
      dispatched!.launchContract,
      {
        now: new Date(SENT_AT),
        resolvePublicKey: (keyId) =>
          keyId === SIGNING_KEY_ID ? SIGNING_KEYS.publicKey : undefined,
      },
    );
    expect(contract.job.reference).toBe(webAgentJobReference(PROMPT));
    expect(contract.job.command_sha256).toBe(WEB_AGENT_COMMAND_SHA256);
    expect(dispatched!.prompt).toBe(PROMPT);
    expect(response.payload).not.toHaveProperty("launch_contract");
  });
});
