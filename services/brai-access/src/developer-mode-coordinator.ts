import type { RuntimeAccessReference } from "@brai/contracts";

import type { AccessService } from "./access-service.js";
import type { RuntimeTerminator } from "./runtime-terminator.js";
import type { TrustedReceiptPublicKeyResolver } from "./signed-receipts.js";
import {
  trustedRuntimeContextFromEd25519KeyResolver,
  verifiedRuntimeTerminationReceiptFromSignedEnvelope,
  type TrustedPlatformAdminContext,
} from "./trusted-context.js";

export type DeveloperModeCommands = Pick<
  AccessService,
  | "beginDeveloperModeTransition"
  | "completeDeveloperModeTransitionFromTrustedRuntime"
>;

export type DeveloperModeSetResult = Readonly<{
  changed: boolean;
  user_id: string;
  access_generation: number;
  runs_to_terminate: readonly RuntimeAccessReference[];
}>;

const TERMINATION_CONCURRENCY = 16;

/**
 * Deterministic server code: persist the fail-closed transition, terminate
 * every exact captured process tree, verify controller signatures, then and
 * only then activate the requested profile.
 */
export class DeveloperModeCoordinator {
  private readonly runtimeContext;

  public constructor(
    private readonly access: DeveloperModeCommands,
    private readonly terminator: RuntimeTerminator,
    resolveRuntimePublicKey: TrustedReceiptPublicKeyResolver,
  ) {
    this.runtimeContext = trustedRuntimeContextFromEd25519KeyResolver(
      resolveRuntimePublicKey,
    );
  }

  public async setMode(
    context: TrustedPlatformAdminContext,
    command: Readonly<{
      target_user_id: string;
      requested_developer_mode: boolean;
    }>,
  ): Promise<DeveloperModeSetResult> {
    const transition = await this.access.beginDeveloperModeTransition(
      context,
      command,
    );
    if (!transition.changed) {
      return Object.freeze({
        changed: false,
        user_id: transition.user_id,
        access_generation: transition.access_generation,
        runs_to_terminate: Object.freeze([]),
      });
    }

    const receipts = [];
    for (
      let offset = 0;
      offset < transition.runtime_bindings_to_terminate.length;
      offset += TERMINATION_CONCURRENCY
    ) {
      const batch = transition.runtime_bindings_to_terminate.slice(
        offset,
        offset + TERMINATION_CONCURRENCY,
      );
      const signed = await Promise.all(
        batch.map((runtime) =>
          this.terminator.terminate({
            projectId: runtime.projectId,
            userId: transition.user_id,
            runId: runtime.runId,
            profile: runtime.profile,
            environmentId: runtime.environmentId,
            accessGeneration: runtime.accessGeneration,
            runtimeIdentity: runtime.runtimeIdentity,
          }),
        ),
      );
      receipts.push(
        ...signed.map((envelope) =>
          verifiedRuntimeTerminationReceiptFromSignedEnvelope(
            this.runtimeContext,
            envelope,
          ),
        ),
      );
    }

    const active =
      await this.access.completeDeveloperModeTransitionFromTrustedRuntime(
        this.runtimeContext,
        { user_id: transition.user_id },
        receipts,
      );
    return Object.freeze({
      changed: true,
      user_id: active.user_id,
      access_generation: active.access_generation,
      runs_to_terminate: Object.freeze([]),
    });
  }
}
