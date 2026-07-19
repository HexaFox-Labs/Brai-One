import { describe, expect, it, vi } from "vitest";
import {
  BRAI_SINGLE_RUNTIME_HOST_ID,
  INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
  LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
  type InternalAgentLaunchContract,
} from "@brai/contracts";
import { launchFromSignedSnapshot } from "../src/launcher.js";
import type {
  AtomicLaunchClaim,
  LauncherDependencies,
  LaunchRejectedError,
  SelectedLaunchExecutor,
} from "../src/launcher.js";

function contract(
  profile: "developer" | "user-sandbox" = "developer",
  runId = "4f88bde1-2b49-46cb-914d-7500afdf82d6",
): InternalAgentLaunchContract {
  return {
    schema_version: INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
    run_id: runId,
    project_id: "dbb46c2e-bef0-4c9f-96f6-8a020fe20846",
    environment_id:
      profile === "user-sandbox"
        ? "d9bdc807-0df2-4d48-b38c-119bc8a3456b"
        : null,
    runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
    job: {
      reference: "jobs/launcher-test@1",
      command_sha256: "a".repeat(64),
    },
    access: {
      schema_version: LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
      user_id: "3f88bde1-2b49-46cb-914d-7500afdf82d6",
      profile,
      access_generation: 7,
      quota: { bytes: 5_368_709_120, inodes: 500_000 },
    },
    issued_at: "2026-07-17T02:00:00.000Z",
    expires_at: "2026-07-17T02:05:00.000Z",
    key_id: "launch-key:2026-07",
    signature: "A".repeat(86),
  };
}

interface TestFence<Result> {
  readonly claim: (
    verified: InternalAgentLaunchContract,
    executor: SelectedLaunchExecutor<Result>,
  ) => Promise<AtomicLaunchClaim<Result>>;
  readonly requestTransition: () => void;
  readonly generation: () => number;
  readonly registeredRuns: ReadonlySet<string>;
}

function createFence<Result>(initialGeneration: number): TestFence<Result> {
  let currentGeneration = initialGeneration;
  let fenceHeld = false;
  let transitionPending = false;
  const claimedRuns = new Set<string>();
  const registeredRuns = new Set<string>();

  return {
    claim: async (verified, executor) => {
      if (claimedRuns.has(verified.run_id)) {
        return { claimed: false, reason: "run_id_already_claimed" };
      }
      if (verified.access.access_generation !== currentGeneration) {
        return { claimed: false, reason: "generation_not_current" };
      }

      fenceHeld = true;
      claimedRuns.add(verified.run_id);
      try {
        const result = await executor(verified);
        registeredRuns.add(verified.run_id);
        return { claimed: true, result };
      } finally {
        fenceHeld = false;
        if (transitionPending) {
          currentGeneration += 1;
          transitionPending = false;
        }
      }
    },
    requestTransition: () => {
      if (fenceHeld) transitionPending = true;
      else currentGeneration += 1;
    },
    generation: () => currentGeneration,
    registeredRuns,
  };
}

function dependencies(
  verified: InternalAgentLaunchContract,
  fence = createFence<string>(7),
): LauncherDependencies<string> & {
  readonly verifyContract: ReturnType<typeof vi.fn>;
  readonly developerExecutor: ReturnType<typeof vi.fn>;
  readonly userSandboxExecutor: ReturnType<typeof vi.fn>;
} {
  return {
    verifyContract: vi.fn().mockResolvedValue(verified),
    claimLaunchAndRegisterUnderFence: fence.claim,
    developerExecutor: vi.fn().mockResolvedValue("developer"),
    userSandboxExecutor: vi.fn().mockResolvedValue("user-sandbox"),
  };
}

describe("atomic signed snapshot launcher", () => {
  it.each([
    ["developer", "developer"],
    ["user-sandbox", "user-sandbox"],
  ] as const)(
    "routes verified %s contract inside one fence",
    async (profile, expected) => {
      const deps = dependencies(contract(profile));
      await expect(launchFromSignedSnapshot({}, deps)).resolves.toBe(expected);
      expect(deps.developerExecutor).toHaveBeenCalledTimes(
        profile === "developer" ? 1 : 0,
      );
      expect(deps.userSandboxExecutor).toHaveBeenCalledTimes(
        profile === "user-sandbox" ? 1 : 0,
      );
    },
  );

  it("rejects replay of the same run_id and invokes the executor once", async () => {
    const verified = contract();
    const deps = dependencies(verified);
    await expect(launchFromSignedSnapshot({}, deps)).resolves.toBe("developer");
    await expect(launchFromSignedSnapshot({}, deps)).rejects.toMatchObject({
      code: "ACCESS_RUN_REPLAYED",
    } satisfies Partial<LaunchRejectedError>);
    expect(deps.developerExecutor).toHaveBeenCalledOnce();
  });

  it("rejects a generation transition completed before the atomic claim", async () => {
    const verified = contract();
    const fence = createFence<string>(7);
    const deps = dependencies(verified, fence);
    deps.verifyContract.mockImplementation(async () => {
      fence.requestTransition();
      return verified;
    });

    await expect(launchFromSignedSnapshot({}, deps)).rejects.toMatchObject({
      code: "ACCESS_SNAPSHOT_STALE",
    } satisfies Partial<LaunchRejectedError>);
    expect(deps.developerExecutor).not.toHaveBeenCalled();
  });

  it("propagates fail-closed aggregate resource admission codes", async () => {
    const deps = dependencies(contract("user-sandbox"));
    const deniedDeps = {
      ...deps,
      claimLaunchAndRegisterUnderFence: vi.fn().mockResolvedValue({
        claimed: false,
        reason: "aggregate_resource_denied",
        denialCode: "aggregate_resource_boundary_unmeasured",
      }),
    } satisfies LauncherDependencies<string>;

    await expect(
      launchFromSignedSnapshot({}, deniedDeps),
    ).rejects.toMatchObject({
      code: "aggregate_resource_boundary_unmeasured",
    } satisfies Partial<LaunchRejectedError>);
    expect(deps.userSandboxExecutor).not.toHaveBeenCalled();
  });

  it("holds the generation fence through claim, launch and registration", async () => {
    const verified = contract();
    const fence = createFence<string>(7);
    const deps = dependencies(verified, fence);
    deps.developerExecutor.mockImplementation(async () => {
      fence.requestTransition();
      expect(fence.generation()).toBe(7);
      expect(fence.registeredRuns.has(verified.run_id)).toBe(false);
      return "developer";
    });

    await expect(launchFromSignedSnapshot({}, deps)).resolves.toBe("developer");
    expect(fence.registeredRuns.has(verified.run_id)).toBe(true);
    expect(fence.generation()).toBe(8);
  });

  it("does not claim a forged contract", async () => {
    const deps = dependencies(contract());
    deps.verifyContract.mockResolvedValue(null);
    const claim = vi.fn(deps.claimLaunchAndRegisterUnderFence);
    const forgedDeps = { ...deps, claimLaunchAndRegisterUnderFence: claim };
    await expect(
      launchFromSignedSnapshot({}, forgedDeps),
    ).rejects.toMatchObject({
      code: "ACCESS_SNAPSHOT_INVALID",
    } satisfies Partial<LaunchRejectedError>);
    expect(claim).not.toHaveBeenCalled();
  });
});
