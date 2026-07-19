import {
  accessRuntimeAgentRunLaunchRequestSchema,
  runtimeAgentRunTerminateRequestSchema,
  type AccessRuntimeAgentRunLaunchResponse,
  type RuntimeAgentRunTerminateResponse,
} from "@brai/contracts";

type LaunchResponse = AccessRuntimeAgentRunLaunchResponse;

export interface RuntimeProfileHostService {
  handleLaunch(input: unknown): Promise<AccessRuntimeAgentRunLaunchResponse>;
  handleTerminate(input: unknown): Promise<RuntimeAgentRunTerminateResponse>;
  recover(): Promise<void>;
}

export class RuntimeHostRouterService {
  public constructor(
    private readonly developer: RuntimeProfileHostService,
    private readonly userSandbox: RuntimeProfileHostService,
  ) {}

  public async handleLaunch(input: unknown): Promise<LaunchResponse> {
    const parsed = accessRuntimeAgentRunLaunchRequestSchema.safeParse(input);
    if (!parsed.success) return await this.developer.handleLaunch(input);
    return parsed.data.payload.launch_contract.access.profile === "developer"
      ? await this.developer.handleLaunch(input)
      : await this.userSandbox.handleLaunch(input);
  }

  public async handleTerminate(
    input: unknown,
  ): Promise<RuntimeAgentRunTerminateResponse> {
    const parsed = runtimeAgentRunTerminateRequestSchema.safeParse(input);
    if (!parsed.success) return await this.developer.handleTerminate(input);
    return parsed.data.payload.profile === "developer"
      ? await this.developer.handleTerminate(input)
      : await this.userSandbox.handleTerminate(input);
  }

  public async recover(): Promise<void> {
    await Promise.all([this.developer.recover(), this.userSandbox.recover()]);
  }
}
