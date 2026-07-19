import type { InternalAgentLaunchContract } from "@brai/contracts";
import type { AggregateResourceDenialCode } from "./resource-admission.js";

export type SelectedLaunchExecutor<Result> = (
  contract: InternalAgentLaunchContract,
) => Promise<Result>;

export type AtomicLaunchClaim<Result> =
  | { readonly claimed: true; readonly result: Result }
  | {
      readonly claimed: false;
      readonly reason: "run_id_already_claimed";
    }
  | {
      readonly claimed: false;
      readonly reason: "generation_not_current";
    }
  | {
      readonly claimed: false;
      readonly reason: "aggregate_resource_denied";
      readonly denialCode: AggregateResourceDenialCode;
    };

export interface LauncherDependencies<Result> {
  readonly verifyContract: (
    envelope: unknown,
  ) => Promise<InternalAgentLaunchContract | null>;
  /**
   * The implementation must claim run_id, compare access_generation, invoke
   * the selected executor and register the runtime while holding one atomic
   * per-user generation fence. None of those steps may escape the primitive.
   * Production requires cross-process/durable coordination (for example a
   * transactional row lock plus a unique run_id claim); an in-memory mutex is
   * valid only for a deliberately single-process test adapter.
   *
   * For user-sandbox, this same primitive must also hold a host-wide launch
   * fence, freshly measure the active brai-users.slice and run aggregate
   * resource admission before executor invocation. The kernel slice remains
   * the hard race-safe boundary.
   */
  readonly claimLaunchAndRegisterUnderFence: (
    contract: InternalAgentLaunchContract,
    executor: SelectedLaunchExecutor<Result>,
  ) => Promise<AtomicLaunchClaim<Result>>;
  readonly developerExecutor: SelectedLaunchExecutor<Result>;
  readonly userSandboxExecutor: SelectedLaunchExecutor<Result>;
}

export type LaunchRejectionCode =
  | "ACCESS_SNAPSHOT_INVALID"
  | "ACCESS_SNAPSHOT_STALE"
  | "ACCESS_SNAPSHOT_PROFILE_INVALID"
  | "ACCESS_RUN_REPLAYED"
  | AggregateResourceDenialCode;

export class LaunchRejectedError extends Error {
  public constructor(public readonly code: LaunchRejectionCode) {
    super(code);
    this.name = "LaunchRejectedError";
  }
}

/**
 * Verifies an internal launch contract and hands the full verified contract
 * plus one statically selected executor to a single atomic fence primitive.
 * There is deliberately no client/profile/current-generation argument.
 */
export async function launchFromSignedSnapshot<Result>(
  envelope: unknown,
  dependencies: LauncherDependencies<Result>,
): Promise<Result> {
  const contract = await dependencies.verifyContract(envelope);
  if (contract === null) {
    throw new LaunchRejectedError("ACCESS_SNAPSHOT_INVALID");
  }

  const executor = (() => {
    switch (contract.access.profile) {
      case "developer":
        return dependencies.developerExecutor;
      case "user-sandbox":
        return dependencies.userSandboxExecutor;
      default:
        throw new LaunchRejectedError("ACCESS_SNAPSHOT_PROFILE_INVALID");
    }
  })();

  const claim = await dependencies.claimLaunchAndRegisterUnderFence(
    contract,
    executor,
  );
  if (!claim.claimed) {
    const code =
      claim.reason === "run_id_already_claimed"
        ? "ACCESS_RUN_REPLAYED"
        : claim.reason === "generation_not_current"
          ? "ACCESS_SNAPSHOT_STALE"
          : claim.denialCode;
    throw new LaunchRejectedError(code);
  }
  return claim.result;
}
