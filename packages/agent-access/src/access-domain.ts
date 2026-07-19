import {
  DEVELOPER_ACCESS_PROFILE,
  INITIAL_ACCESS_GENERATION,
  LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
  MAX_ACCESS_GENERATION,
  USER_ACCESS_STATE_SCHEMA_VERSION,
  USER_SANDBOX_ACCESS_PROFILE,
  activeUserAccessStateSchema,
  launchAccessSnapshotSchema,
  runtimeAccessReferenceSchema,
  storageQuotaSchema,
  transitioningUserAccessStateSchema,
  userAccessStateSchema,
  type ActiveUserAccessState,
  type LaunchAccessSnapshot,
  type RuntimeAccessReference,
  type StorageQuota,
  type TransitioningUserAccessState,
} from "@brai/contracts";

import { AgentAccessError } from "./errors.js";

export interface InitialUserAccessInput {
  readonly userId: string;
  readonly developerMode?: boolean;
  readonly quota?: Readonly<Partial<StorageQuota>>;
}

export type BeginDeveloperModeTransitionResult =
  | Readonly<{
      changed: false;
      state: ActiveUserAccessState;
    }>
  | Readonly<{
      changed: true;
      state: TransitioningUserAccessState;
    }>;

function invalidState(message: string): AgentAccessError {
  return new AgentAccessError("access_state_invalid", message);
}

function parseActiveState(state: unknown): ActiveUserAccessState {
  const parsed = activeUserAccessStateSchema.safeParse(state);
  if (!parsed.success) {
    throw invalidState("Некорректное активное состояние доступа");
  }
  return parsed.data;
}

function parseTransitionState(state: unknown): TransitioningUserAccessState {
  const parsed = transitioningUserAccessStateSchema.safeParse(state);
  if (!parsed.success) {
    throw invalidState("Некорректное состояние переключения доступа");
  }
  return parsed.data;
}

function parseRuntimeReferences(
  references: readonly RuntimeAccessReference[],
): readonly RuntimeAccessReference[] {
  const parsed = runtimeAccessReferenceSchema
    .array()
    .readonly()
    .safeParse(references);
  if (!parsed.success) {
    throw invalidState("Некорректный список активных runs");
  }

  const uniqueRunIds = new Set(parsed.data.map((run) => run.run_id));
  if (uniqueRunIds.size !== parsed.data.length) {
    throw invalidState("Один run указан более одного раза");
  }
  return parsed.data;
}

function runtimeReferenceKey(reference: RuntimeAccessReference): string {
  return `${reference.run_id}:${reference.access_generation}`;
}

export function createInitialUserAccessState(
  input: InitialUserAccessInput,
): ActiveUserAccessState {
  const quota = storageQuotaSchema.safeParse(input.quota ?? {});
  if (!quota.success) {
    throw invalidState("Некорректная дисковая квота пользователя");
  }

  return parseActiveState({
    schema_version: USER_ACCESS_STATE_SCHEMA_VERSION,
    status: "active",
    user_id: input.userId,
    developer_mode: input.developerMode ?? false,
    access_generation: INITIAL_ACCESS_GENERATION,
    quota: quota.data,
  });
}

/**
 * Selects a launch profile exclusively from the persisted developer_mode flag.
 * There is deliberately no profile argument that a client or model could set.
 */
export function selectLaunchAccess(state: unknown): LaunchAccessSnapshot {
  const parsed = userAccessStateSchema.safeParse(state);
  if (!parsed.success) {
    throw invalidState("Некорректное состояние доступа пользователя");
  }
  if (parsed.data.status === "transitioning") {
    throw new AgentAccessError(
      "access_transition_in_progress",
      "Новый run запрещён до завершения переключения режима",
    );
  }

  return launchAccessSnapshotSchema.parse({
    schema_version: LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
    user_id: parsed.data.user_id,
    profile: parsed.data.developer_mode
      ? DEVELOPER_ACCESS_PROFILE
      : USER_SANDBOX_ACCESS_PROFILE,
    access_generation: parsed.data.access_generation,
    quota: parsed.data.quota,
  });
}

/**
 * Starts a fail-closed transition. The returned state must be persisted before
 * process termination begins: it bumps access_generation and blocks new runs.
 */
export function beginDeveloperModeTransition(
  currentState: unknown,
  requestedDeveloperMode: boolean,
  liveRuns: readonly RuntimeAccessReference[],
): BeginDeveloperModeTransitionResult {
  const current = parseActiveState(currentState);
  const parsedRuns = parseRuntimeReferences(liveRuns);

  if (current.developer_mode === requestedDeveloperMode) {
    return Object.freeze({ changed: false, state: current });
  }
  if (current.access_generation >= MAX_ACCESS_GENERATION) {
    throw new AgentAccessError(
      "access_generation_exhausted",
      "Поколение доступа исчерпано; переключение запрещено",
    );
  }

  const state = parseTransitionState({
    schema_version: USER_ACCESS_STATE_SCHEMA_VERSION,
    status: "transitioning",
    user_id: current.user_id,
    previous_developer_mode: current.developer_mode,
    requested_developer_mode: requestedDeveloperMode,
    previous_access_generation: current.access_generation,
    access_generation: current.access_generation + 1,
    quota: current.quota,
    runs_to_terminate: parsedRuns,
  });

  return Object.freeze({ changed: true, state });
}

/**
 * Completes a transition only after the runtime layer supplies exact receipts
 * for every run captured at transition start. This function does not terminate
 * processes itself and cannot be used as evidence that termination happened.
 */
export function completeDeveloperModeTransition(
  transitionState: unknown,
  terminationReceipts: readonly RuntimeAccessReference[],
): ActiveUserAccessState {
  const transition = parseTransitionState(transitionState);
  const receipts = parseRuntimeReferences(terminationReceipts);
  const required = new Set(
    transition.runs_to_terminate.map(runtimeReferenceKey),
  );
  const received = new Set(receipts.map(runtimeReferenceKey));

  const missing = [...required].filter((key) => !received.has(key));
  if (missing.length > 0) {
    throw new AgentAccessError(
      "runtime_termination_incomplete",
      "Не все runs подтверждены как завершённые",
      { missing_runtime_references: Object.freeze(missing) },
    );
  }

  const unexpected = [...received].filter((key) => !required.has(key));
  if (unexpected.length > 0) {
    throw new AgentAccessError(
      "runtime_termination_mismatch",
      "Получено подтверждение для run вне переключения",
      { unexpected_runtime_references: Object.freeze(unexpected) },
    );
  }

  return parseActiveState({
    schema_version: USER_ACCESS_STATE_SCHEMA_VERSION,
    status: "active",
    user_id: transition.user_id,
    developer_mode: transition.requested_developer_mode,
    access_generation: transition.access_generation,
    quota: transition.quota,
  });
}

export function assertLaunchAccessCurrent(
  snapshot: unknown,
  currentState: unknown,
): LaunchAccessSnapshot {
  const parsedSnapshot = launchAccessSnapshotSchema.safeParse(snapshot);
  if (!parsedSnapshot.success) {
    throw new AgentAccessError(
      "access_profile_invalid",
      "Некорректный snapshot доступа run",
    );
  }

  const parsedState = userAccessStateSchema.safeParse(currentState);
  if (!parsedState.success) {
    throw invalidState("Некорректное текущее состояние доступа");
  }
  if (parsedState.data.status === "transitioning") {
    throw new AgentAccessError(
      "access_transition_in_progress",
      "Snapshot отозван начавшимся переключением режима",
    );
  }
  if (parsedSnapshot.data.user_id !== parsedState.data.user_id) {
    throw new AgentAccessError(
      "access_subject_mismatch",
      "Snapshot принадлежит другому пользователю",
    );
  }
  if (
    parsedSnapshot.data.access_generation !== parsedState.data.access_generation
  ) {
    throw new AgentAccessError(
      "access_generation_stale",
      "Поколение snapshot больше не действует",
    );
  }

  const expectedProfile = parsedState.data.developer_mode
    ? DEVELOPER_ACCESS_PROFILE
    : USER_SANDBOX_ACCESS_PROFILE;
  if (parsedSnapshot.data.profile !== expectedProfile) {
    throw new AgentAccessError(
      "access_profile_invalid",
      "Profile snapshot не соответствует server-side developer mode",
    );
  }

  return parsedSnapshot.data;
}
