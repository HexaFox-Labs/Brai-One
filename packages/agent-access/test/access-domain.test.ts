import { describe, expect, it } from "vitest";

import {
  DEFAULT_USER_QUOTA_BYTES,
  DEFAULT_USER_QUOTA_INODES,
  MAX_ACCESS_GENERATION,
  USER_ACCESS_STATE_SCHEMA_VERSION,
  type RuntimeAccessReference,
} from "@brai/contracts";

import {
  AgentAccessError,
  assertLaunchAccessCurrent,
  beginDeveloperModeTransition,
  completeDeveloperModeTransition,
  createInitialUserAccessState,
  selectLaunchAccess,
} from "../src/index.js";

const USER_ID = "3f88bde1-2b49-46cb-914d-7500afdf82d6";
const OTHER_USER_ID = "4f88bde1-2b49-46cb-914d-7500afdf82d6";
const RUN_ONE = "5f88bde1-2b49-46cb-914d-7500afdf82d6";
const RUN_TWO = "6f88bde1-2b49-46cb-914d-7500afdf82d6";
const RUN_THREE = "7f88bde1-2b49-46cb-914d-7500afdf82d6";

function expectAccessError(
  action: () => unknown,
  code: AgentAccessError["code"],
): AgentAccessError {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AgentAccessError);
  const accessError = caught as AgentAccessError;
  expect(accessError.code).toBe(code);
  return accessError;
}

function runtime(runId: string, accessGeneration = 1): RuntimeAccessReference {
  return { run_id: runId, access_generation: accessGeneration };
}

describe("deterministic agent access domain", () => {
  it("creates a sandboxed initial state with the approved quota defaults", () => {
    const state = createInitialUserAccessState({ userId: USER_ID });

    expect(state).toEqual({
      schema_version: USER_ACCESS_STATE_SCHEMA_VERSION,
      status: "active",
      user_id: USER_ID,
      developer_mode: false,
      access_generation: 1,
      quota: {
        bytes: DEFAULT_USER_QUOTA_BYTES,
        inodes: DEFAULT_USER_QUOTA_INODES,
      },
    });
    expect(selectLaunchAccess(state).profile).toBe("user-sandbox");
  });

  it("selects developer only from stored developer_mode", () => {
    const state = createInitialUserAccessState({
      userId: USER_ID,
      developerMode: true,
    });

    expect(selectLaunchAccess(state)).toMatchObject({
      user_id: USER_ID,
      profile: "developer",
      access_generation: 1,
    });
  });

  it("rejects a caller-injected profile instead of honoring it", () => {
    const state = createInitialUserAccessState({ userId: USER_ID });
    expectAccessError(
      () => selectLaunchAccess({ ...state, profile: "developer" }),
      "access_state_invalid",
    );
  });

  it("returns an immutable generation snapshot", () => {
    const snapshot = selectLaunchAccess(
      createInitialUserAccessState({ userId: USER_ID }),
    );

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.quota)).toBe(true);
    expect(Reflect.set(snapshot, "access_generation", 99)).toBe(false);
    expect(Reflect.set(snapshot.quota, "bytes", 1)).toBe(false);
  });

  it("does not bump generation when the admin setting is unchanged", () => {
    const current = createInitialUserAccessState({ userId: USER_ID });
    const result = beginDeveloperModeTransition(current, false, []);

    expect(result).toEqual({ changed: false, state: current });
    expect(result.state.access_generation).toBe(1);
  });

  it("bumps generation and blocks launches before runtime termination", () => {
    const current = createInitialUserAccessState({ userId: USER_ID });
    const result = beginDeveloperModeTransition(current, true, [
      runtime(RUN_ONE),
      runtime(RUN_TWO),
    ]);

    expect(result.changed).toBe(true);
    expect(result.state).toMatchObject({
      status: "transitioning",
      previous_developer_mode: false,
      requested_developer_mode: true,
      previous_access_generation: 1,
      access_generation: 2,
      runs_to_terminate: [runtime(RUN_ONE), runtime(RUN_TWO)],
    });
    expectAccessError(
      () => selectLaunchAccess(result.state),
      "access_transition_in_progress",
    );
  });

  it("refuses to complete while any captured runtime is unconfirmed", () => {
    const current = createInitialUserAccessState({ userId: USER_ID });
    const transition = beginDeveloperModeTransition(current, true, [
      runtime(RUN_ONE),
      runtime(RUN_TWO),
    ]);
    expect(transition.changed).toBe(true);

    const error = expectAccessError(
      () =>
        completeDeveloperModeTransition(transition.state, [runtime(RUN_ONE)]),
      "runtime_termination_incomplete",
    );
    expect(error.details).toEqual({
      missing_runtime_references: [`${RUN_TWO}:1`],
    });
  });

  it("refuses a termination receipt that was not captured by the transition", () => {
    const current = createInitialUserAccessState({ userId: USER_ID });
    const transition = beginDeveloperModeTransition(current, true, [
      runtime(RUN_ONE),
    ]);
    expect(transition.changed).toBe(true);

    expectAccessError(
      () =>
        completeDeveloperModeTransition(transition.state, [
          runtime(RUN_ONE),
          runtime(RUN_THREE),
        ]),
      "runtime_termination_mismatch",
    );
  });

  it("activates the new profile only after exact termination receipts", () => {
    const current = createInitialUserAccessState({ userId: USER_ID });
    const oldSnapshot = selectLaunchAccess(current);
    const transition = beginDeveloperModeTransition(current, true, [
      runtime(RUN_ONE),
      runtime(RUN_TWO, 1),
    ]);
    expect(transition.changed).toBe(true);

    const next = completeDeveloperModeTransition(transition.state, [
      runtime(RUN_TWO, 1),
      runtime(RUN_ONE),
    ]);

    expect(next).toMatchObject({
      status: "active",
      developer_mode: true,
      access_generation: 2,
    });
    expect(selectLaunchAccess(next).profile).toBe("developer");
    expectAccessError(
      () => assertLaunchAccessCurrent(oldSnapshot, next),
      "access_generation_stale",
    );
  });

  it("supports switching back without changing a running process in place", () => {
    const developer = createInitialUserAccessState({
      userId: USER_ID,
      developerMode: true,
    });
    const transition = beginDeveloperModeTransition(developer, false, []);
    expect(transition.changed).toBe(true);

    const sandbox = completeDeveloperModeTransition(transition.state, []);
    expect(sandbox.access_generation).toBe(2);
    expect(selectLaunchAccess(sandbox).profile).toBe("user-sandbox");
  });

  it("fails closed on an exhausted generation counter", () => {
    const current = {
      ...createInitialUserAccessState({ userId: USER_ID }),
      access_generation: MAX_ACCESS_GENERATION,
    };

    expectAccessError(
      () => beginDeveloperModeTransition(current, true, []),
      "access_generation_exhausted",
    );
  });

  it("rejects duplicate or malformed live-run references", () => {
    const current = createInitialUserAccessState({ userId: USER_ID });

    expectAccessError(
      () =>
        beginDeveloperModeTransition(current, true, [
          runtime(RUN_ONE),
          runtime(RUN_ONE),
        ]),
      "access_state_invalid",
    );
    expectAccessError(
      () =>
        beginDeveloperModeTransition(current, true, [
          { run_id: "not-a-uuid", access_generation: 1 },
        ]),
      "access_state_invalid",
    );
  });

  it("rejects snapshots for another user or a forged profile", () => {
    const current = createInitialUserAccessState({ userId: USER_ID });
    const snapshot = selectLaunchAccess(current);

    expectAccessError(
      () =>
        assertLaunchAccessCurrent(
          { ...snapshot, user_id: OTHER_USER_ID },
          current,
        ),
      "access_subject_mismatch",
    );
    expectAccessError(
      () =>
        assertLaunchAccessCurrent(
          { ...snapshot, profile: "developer" },
          current,
        ),
      "access_profile_invalid",
    );
  });
});
