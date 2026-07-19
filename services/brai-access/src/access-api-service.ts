import { randomUUID } from "node:crypto";

import { AgentAccessError } from "@brai/agent-access";
import {
  ACCESS_AGENT_RUN_CREATE_RESPONSE_SCHEMA_VERSION,
  ACCESS_DEVELOPER_MODE_SET_RESPONSE_SCHEMA_VERSION,
  accessAgentRunCreateRequestSchema,
  accessAgentRunCreateResponseSchema,
  accessDeveloperModeSetRequestSchema,
  accessDeveloperModeSetResponseSchema,
  uuidV4Schema,
  type AccessAgentRunCreateResponse,
  type AccessApiErrorPayload,
  type AccessDeveloperModeSetResponse,
} from "@brai/contracts";
import type { Logger } from "@brai/runtime";

import type { AccessService } from "./access-service.js";
import type {
  DeveloperModeCoordinator,
  DeveloperModeSetResult,
} from "./developer-mode-coordinator.js";
import {
  EnvironmentProvisioningError,
  type EnvironmentProvisioner,
} from "./environment-provisioning-coordinator.js";
import { AccessServiceError } from "./errors.js";
import type { LaunchContractIssuer } from "./launch-contract-issuer.js";
import {
  RuntimeDispatchError,
  type RuntimeDispatcher,
} from "./runtime-dispatcher.js";
import {
  trustedAccessContextFromServerIdentity,
  trustedPlatformAdminContextFromServerIdentity,
} from "./trusted-context.js";
import {
  WEB_AGENT_COMMAND_SHA256,
  webAgentJobReference,
} from "./web-agent-job-policy.js";

export type AccessApiCommands = Pick<AccessService, "createPendingLaunch">;

export type DeveloperModeHandler = Pick<DeveloperModeCoordinator, "setMode">;

function requestIdFrom(input: unknown): string {
  if (typeof input === "object" && input !== null && "request_id" in input) {
    const parsed = uuidV4Schema.safeParse(input.request_id);
    if (parsed.success) return parsed.data;
  }
  return randomUUID();
}

function errorPayload(error: unknown): AccessApiErrorPayload {
  if (error instanceof RuntimeDispatchError) {
    return {
      ok: false,
      code: "service_unavailable",
      message: "Runtime-контроллер временно недоступен.",
    };
  }

  if (error instanceof EnvironmentProvisioningError) {
    return {
      ok: false,
      code: "service_unavailable",
      message:
        error.code === "storage_pool_full"
          ? "Общий пользовательский storage pool заполнен."
          : "Изолированное окружение временно не удалось подготовить.",
    };
  }

  if (error instanceof AgentAccessError) {
    switch (error.code) {
      case "access_membership_not_found":
        return {
          ok: false,
          code: "membership_not_found",
          message: "Пользователь не состоит в этом проекте.",
        };
      case "access_transition_in_progress":
      case "access_generation_stale":
        return {
          ok: false,
          code: "transition_in_progress",
          message: "Смена режима доступа ещё не завершена.",
        };
      default:
        return {
          ok: false,
          code: "internal_error",
          message: "Не удалось применить политику доступа.",
        };
    }
  }

  if (error instanceof AccessServiceError) {
    switch (error.code) {
      case "access_input_invalid":
        return {
          ok: false,
          code: "invalid_request",
          message: "Некорректный запрос к сервису доступа.",
        };
      case "access_environment_unavailable":
        return {
          ok: false,
          code: "environment_unavailable",
          message: "Изолированное окружение пользователя ещё не готово.",
        };
      case "access_admin_required":
      case "access_trusted_context_required":
        return {
          ok: false,
          code: "service_unavailable",
          message: "Доверенный контекст запроса недоступен.",
        };
      default:
        return {
          ok: false,
          code: "internal_error",
          message: "Сервис доступа не смог выполнить запрос.",
        };
    }
  }

  return {
    ok: false,
    code: "internal_error",
    message: "Сервис доступа не смог выполнить запрос.",
  };
}

export class AccessApiService {
  public constructor(
    private readonly access: AccessApiCommands,
    private readonly contractIssuer: LaunchContractIssuer,
    private readonly runtimeDispatcher: RuntimeDispatcher,
    private readonly environmentProvisioner: EnvironmentProvisioner,
    private readonly developerMode: DeveloperModeHandler,
    private readonly logger: Logger,
  ) {}

  public async handleCreateAgentRun(
    input: unknown,
  ): Promise<AccessAgentRunCreateResponse> {
    const requestId = requestIdFrom(input);
    const sentAt = new Date().toISOString();
    const parsed = accessAgentRunCreateRequestSchema.safeParse(input);

    if (!parsed.success) {
      return accessAgentRunCreateResponseSchema.parse({
        schema_version: ACCESS_AGENT_RUN_CREATE_RESPONSE_SCHEMA_VERSION,
        request_id: requestId,
        sent_at: sentAt,
        payload: {
          ok: false,
          code: "invalid_request",
          message: "Некорректный запрос запуска агента.",
        },
      });
    }

    try {
      const context = trustedAccessContextFromServerIdentity(
        parsed.data.payload.authenticated_user_id,
      );
      const jobReference = webAgentJobReference(parsed.data.payload.prompt);
      const launchCommand = {
        project_id: parsed.data.payload.project_id,
        job_reference: jobReference,
        command_sha256: WEB_AGENT_COMMAND_SHA256,
      } as const;
      let launch;
      try {
        launch = await this.access.createPendingLaunch(context, launchCommand);
      } catch (error) {
        if (
          !(error instanceof AccessServiceError) ||
          error.code !== "access_environment_unavailable"
        ) {
          throw error;
        }
        await this.environmentProvisioner.ensureReady(
          parsed.data.payload.authenticated_user_id,
        );
        launch = await this.access.createPendingLaunch(context, launchCommand);
      }
      const launchContract = await this.contractIssuer.issue({
        launch,
        prompt: parsed.data.payload.prompt,
      });
      await this.runtimeDispatcher.dispatch({
        launchContract,
        prompt: parsed.data.payload.prompt,
      });

      return accessAgentRunCreateResponseSchema.parse({
        schema_version: ACCESS_AGENT_RUN_CREATE_RESPONSE_SCHEMA_VERSION,
        request_id: parsed.data.request_id,
        sent_at: new Date().toISOString(),
        payload: {
          ok: true,
          run_id: launch.run_id,
          project_id: launch.project_id,
          status: launch.status,
        },
      });
    } catch (error) {
      this.logger.error(
        {
          err: error,
          request_id: parsed.data.request_id,
          subject_user_id: parsed.data.payload.authenticated_user_id,
          project_id: parsed.data.payload.project_id,
        },
        "Не удалось создать pending agent run",
      );
      return accessAgentRunCreateResponseSchema.parse({
        schema_version: ACCESS_AGENT_RUN_CREATE_RESPONSE_SCHEMA_VERSION,
        request_id: parsed.data.request_id,
        sent_at: new Date().toISOString(),
        payload: errorPayload(error),
      });
    }
  }

  public async handleSetDeveloperMode(
    input: unknown,
  ): Promise<AccessDeveloperModeSetResponse> {
    const requestId = requestIdFrom(input);
    const sentAt = new Date().toISOString();
    const parsed = accessDeveloperModeSetRequestSchema.safeParse(input);

    if (!parsed.success) {
      return accessDeveloperModeSetResponseSchema.parse({
        schema_version: ACCESS_DEVELOPER_MODE_SET_RESPONSE_SCHEMA_VERSION,
        request_id: requestId,
        sent_at: sentAt,
        payload: {
          ok: false,
          code: "invalid_request",
          message: "Некорректный запрос смены режима разработчика.",
        },
      });
    }

    try {
      const context = trustedPlatformAdminContextFromServerIdentity(
        parsed.data.payload.platform_admin_user_id,
      );
      const transition: DeveloperModeSetResult =
        await this.developerMode.setMode(context, {
          target_user_id: parsed.data.payload.target_user_id,
          requested_developer_mode: parsed.data.payload.developer_mode,
        });

      return accessDeveloperModeSetResponseSchema.parse({
        schema_version: ACCESS_DEVELOPER_MODE_SET_RESPONSE_SCHEMA_VERSION,
        request_id: parsed.data.request_id,
        sent_at: new Date().toISOString(),
        payload: {
          ok: true,
          changed: transition.changed,
          user_id: transition.user_id,
          access_generation: transition.access_generation,
          runs_to_terminate: transition.runs_to_terminate,
        },
      });
    } catch (error) {
      this.logger.error(
        {
          err: error,
          request_id: parsed.data.request_id,
          target_user_id: parsed.data.payload.target_user_id,
        },
        "Не удалось начать смену режима разработчика",
      );
      return accessDeveloperModeSetResponseSchema.parse({
        schema_version: ACCESS_DEVELOPER_MODE_SET_RESPONSE_SCHEMA_VERSION,
        request_id: parsed.data.request_id,
        sent_at: new Date().toISOString(),
        payload: errorPayload(error),
      });
    }
  }
}
