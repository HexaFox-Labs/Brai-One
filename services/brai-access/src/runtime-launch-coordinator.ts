import {
  verifiedRuntimeTerminationReceiptFromSignedEnvelope,
  trustedRuntimeContextFromEd25519KeyResolver,
} from "./trusted-context.js";
import type { AccessService } from "./access-service.js";
import {
  RuntimeDispatchError,
  type RuntimeDispatchInput,
  type RuntimeDispatcher,
} from "./runtime-dispatcher.js";
import type { RuntimeTerminator } from "./runtime-terminator.js";
import type { TrustedReceiptPublicKeyResolver } from "./signed-receipts.js";

type CompensationCommands = Pick<
  AccessService,
  | "requestRunTerminationAfterDispatchFailure"
  | "completeRequestedRunTerminationFromTrustedRuntime"
>;

/**
 * A launch acknowledgement is returned only after claim and started CAS.
 * If that handshake fails after the host has created a cgroup, atomically
 * mark the exact run terminating, kill its persisted identity (or install a
 * cancellation tombstone before claim), verify the signed empty-cgroup
 * receipt, and consume it. This prevents a failed public launch request from
 * leaving a live or permanently `starting` process tree behind.
 */
export class CompensatingRuntimeDispatcher implements RuntimeDispatcher {
  private readonly runtimeContext;

  public constructor(
    private readonly access: CompensationCommands,
    private readonly dispatcher: RuntimeDispatcher,
    private readonly terminator: RuntimeTerminator,
    resolveRuntimePublicKey: TrustedReceiptPublicKeyResolver,
  ) {
    this.runtimeContext = trustedRuntimeContextFromEd25519KeyResolver(
      resolveRuntimePublicKey,
    );
  }

  public async dispatch(input: RuntimeDispatchInput): Promise<void> {
    try {
      await this.dispatcher.dispatch(input);
      return;
    } catch (dispatchError) {
      try {
        const target =
          await this.access.requestRunTerminationAfterDispatchFailure(
            input.launchContract.access.user_id,
            input.launchContract.run_id,
          );
        const envelope = await this.terminator.terminate({
          projectId: target.projectId,
          userId: input.launchContract.access.user_id,
          runId: target.runId,
          profile: target.profile,
          environmentId: target.environmentId,
          accessGeneration: target.accessGeneration,
          runtimeIdentity: target.runtimeIdentity,
        });
        const receipt = verifiedRuntimeTerminationReceiptFromSignedEnvelope(
          this.runtimeContext,
          envelope,
        );
        await this.access.completeRequestedRunTerminationFromTrustedRuntime(
          this.runtimeContext,
          receipt,
        );
      } catch (compensationError) {
        throw new RuntimeDispatchError(
          "Runtime launch failed and exact termination remains pending",
          {
            cause: new AggregateError([dispatchError, compensationError]),
          },
        );
      }
      if (dispatchError instanceof Error) throw dispatchError;
      throw new RuntimeDispatchError("Runtime launch failed");
    }
  }
}
