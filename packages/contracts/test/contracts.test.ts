import { describe, expect, it } from "vitest";

import {
  ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION,
  ACCESS_DEVELOPER_MODE_SET_REQUEST_SCHEMA_VERSION,
  ACCESS_RUNTIME_AGENT_RUN_LAUNCH_REQUEST_SCHEMA_VERSION,
  ACCESS_RUNTIME_AGENT_RUN_LAUNCH_SUBJECT,
  BRAI_SINGLE_RUNTIME_HOST_ID,
  CREATE_ACTIVITY_REQUEST_SCHEMA_VERSION,
  DEFAULT_USER_QUOTA_BYTES,
  DEFAULT_USER_QUOTA_INODES,
  INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
  LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
  RUNTIME_IDENTITY_SCHEMA_VERSION,
  USER_ACCESS_STATE_SCHEMA_VERSION,
  accessProfileSchema,
  accessAgentRunCreateRequestSchema,
  accessAgentRunCreateSuccessPayloadSchema,
  accessDeveloperModeSetRequestSchema,
  accessRuntimeAgentRunLaunchRequestSchema,
  activeUserAccessStateSchema,
  activitySchema,
  createAgentRunInputSchema,
  createActivityInputSchema,
  createActivityRequestSchema,
  internalAgentLaunchContractSchema,
  emptyCgroupProofSchema,
  launchAccessSnapshotSchema,
  runtimeIdentitySchema,
  setDeveloperModeInputSchema,
  listActivitiesQuerySchema,
  storageQuotaSchema,
  transitioningUserAccessStateSchema,
} from "../src/index.js";

const UUID = "3f88bde1-2b49-46cb-914d-7500afdf82d6";

describe("Activity contracts", () => {
  it("normalizes the create input", () => {
    expect(
      createActivityInputSchema.parse({
        title: "  Заголовок  ",
        description: "  Описание  ",
      }),
    ).toEqual({
      title: "Заголовок",
      description: "Описание",
    });
  });

  it("rejects extra fields and non-v4 identifiers", () => {
    expect(() =>
      activitySchema.parse({
        id: "3f88bde1-2b49-16cb-914d-7500afdf82d6",
        title: "Activity",
        description: "",
        created_at: "2026-07-16T12:00:00.000Z",
      }),
    ).toThrow();

    expect(() =>
      createActivityInputSchema.parse({
        title: "Activity",
        description: "",
        status: "new",
      }),
    ).toThrow();
  });

  it("accepts only UTC timestamps", () => {
    expect(() =>
      activitySchema.parse({
        id: UUID,
        title: "Activity",
        description: "",
        created_at: "2026-07-16T15:00:00+03:00",
      }),
    ).toThrow();
  });

  it("validates a versioned create envelope", () => {
    expect(
      createActivityRequestSchema.parse({
        schema_version: CREATE_ACTIVITY_REQUEST_SCHEMA_VERSION,
        request_id: UUID,
        sent_at: "2026-07-16T12:00:00.000Z",
        payload: {
          idempotency_key: UUID,
          title: "Activity",
          description: "",
        },
      }),
    ).toMatchObject({
      request_id: UUID,
      payload: {
        title: "Activity",
      },
    });
  });

  it("applies safe list defaults and limits", () => {
    expect(listActivitiesQuerySchema.parse({})).toEqual({
      limit: 50,
      cursor: null,
    });
    expect(() => listActivitiesQuerySchema.parse({ limit: "51" })).toThrow();
  });
});

describe("Access API contracts", () => {
  it("keeps authority and Linux runtime controls out of public launch input", () => {
    expect(
      createAgentRunInputSchema.parse({
        project_id: UUID,
        prompt: "Собери страницу проекта",
      }),
    ).toEqual({
      project_id: UUID,
      prompt: "Собери страницу проекта",
    });

    for (const forbiddenField of [
      "authenticated_user_id",
      "profile",
      "access_generation",
      "uid",
      "gid",
      "cgroup_path",
      "storage_path",
      "command",
    ]) {
      expect(() =>
        createAgentRunInputSchema.parse({
          project_id: UUID,
          prompt: "Собери страницу проекта",
          [forbiddenField]: "attacker-controlled",
        }),
      ).toThrow();
    }
  });

  it("keeps the admin actor and target user out of the public body", () => {
    expect(
      setDeveloperModeInputSchema.parse({
        developer_mode: true,
      }),
    ).toEqual({ developer_mode: true });

    expect(() =>
      setDeveloperModeInputSchema.parse({
        developer_mode: true,
        platform_admin_user_id: UUID,
      }),
    ).toThrow();
    expect(() =>
      setDeveloperModeInputSchema.parse({
        developer_mode: true,
        target_user_id: UUID,
      }),
    ).toThrow();
  });

  it("accepts only strict versioned server-authenticated NATS envelopes", () => {
    const common = {
      request_id: UUID,
      sent_at: "2026-07-17T12:00:00.000Z",
    };

    expect(
      accessAgentRunCreateRequestSchema.parse({
        schema_version: ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION,
        ...common,
        payload: {
          authenticated_user_id: UUID,
          project_id: UUID,
          prompt: "Собери страницу проекта",
        },
      }),
    ).toMatchObject({ request_id: UUID });

    expect(() =>
      accessAgentRunCreateRequestSchema.parse({
        schema_version: ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION,
        ...common,
        payload: {
          authenticated_user_id: UUID,
          project_id: UUID,
          prompt: "Собери страницу проекта",
          profile: "developer",
        },
      }),
    ).toThrow();

    expect(
      accessDeveloperModeSetRequestSchema.parse({
        schema_version: ACCESS_DEVELOPER_MODE_SET_REQUEST_SCHEMA_VERSION,
        ...common,
        payload: {
          platform_admin_user_id: UUID,
          target_user_id: UUID,
          developer_mode: true,
        },
      }),
    ).toMatchObject({ request_id: UUID });
  });

  it("keeps the signed launch contract on the server-only runtime subject", () => {
    const contract = {
      schema_version: INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
      run_id: "4f88bde1-2b49-46cb-914d-7500afdf82d6",
      project_id: "5f88bde1-2b49-46cb-914d-7500afdf82d6",
      environment_id: null,
      runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
      job: {
        reference: `brai.web-agent.codex-exec.v1:${"a".repeat(64)}`,
        command_sha256: "b".repeat(64),
      },
      access: {
        schema_version: LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
        user_id: UUID,
        profile: "developer",
        access_generation: 2,
        quota: {},
      },
      issued_at: "2026-07-17T12:00:00.000Z",
      expires_at: "2026-07-17T12:02:00.000Z",
      key_id: "brai-access:test",
      signature: "A".repeat(43),
    } as const;

    expect(ACCESS_RUNTIME_AGENT_RUN_LAUNCH_SUBJECT).toBe(
      "brai.runtime.agent-run.launch.v1",
    );
    expect(
      accessRuntimeAgentRunLaunchRequestSchema.parse({
        schema_version: ACCESS_RUNTIME_AGENT_RUN_LAUNCH_REQUEST_SCHEMA_VERSION,
        request_id: UUID,
        sent_at: "2026-07-17T12:00:00.000Z",
        payload: {
          launch_contract: contract,
          prompt: "Собери страницу проекта",
        },
      }),
    ).toMatchObject({
      payload: {
        launch_contract: { run_id: contract.run_id },
      },
    });

    expect(() =>
      accessAgentRunCreateSuccessPayloadSchema.parse({
        ok: true,
        run_id: contract.run_id,
        project_id: contract.project_id,
        status: "pending",
        launch_contract: contract,
      }),
    ).toThrow();
  });
});

describe("Agent access contracts", () => {
  it("accepts exactly the two approved profiles", () => {
    expect(accessProfileSchema.options).toEqual(["user-sandbox", "developer"]);
    expect(accessProfileSchema.parse("user-sandbox")).toBe("user-sandbox");
    expect(accessProfileSchema.parse("developer")).toBe("developer");
    expect(() => accessProfileSchema.parse("root")).toThrow();
  });

  it("applies non-reserving quota defaults", () => {
    expect(storageQuotaSchema.parse({})).toEqual({
      bytes: DEFAULT_USER_QUOTA_BYTES,
      inodes: DEFAULT_USER_QUOTA_INODES,
    });
  });

  it("keeps profile out of the persisted active state", () => {
    expect(() =>
      activeUserAccessStateSchema.parse({
        schema_version: USER_ACCESS_STATE_SCHEMA_VERSION,
        status: "active",
        user_id: UUID,
        developer_mode: false,
        access_generation: 1,
        quota: {},
        profile: "developer",
      }),
    ).toThrow();
  });

  it("validates generation-changing transition invariants", () => {
    const valid = {
      schema_version: USER_ACCESS_STATE_SCHEMA_VERSION,
      status: "transitioning",
      user_id: UUID,
      previous_developer_mode: false,
      requested_developer_mode: true,
      previous_access_generation: 4,
      access_generation: 5,
      quota: {},
      runs_to_terminate: [],
    } as const;

    expect(transitioningUserAccessStateSchema.parse(valid)).toMatchObject({
      previous_access_generation: 4,
      access_generation: 5,
    });
    expect(() =>
      transitioningUserAccessStateSchema.parse({
        ...valid,
        access_generation: 4,
      }),
    ).toThrow();
    expect(() =>
      transitioningUserAccessStateSchema.parse({
        ...valid,
        requested_developer_mode: false,
      }),
    ).toThrow();
  });

  it("returns a deeply frozen launch snapshot", () => {
    const snapshot = launchAccessSnapshotSchema.parse({
      schema_version: LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
      user_id: UUID,
      profile: "user-sandbox",
      access_generation: 1,
      quota: {},
    });

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.quota)).toBe(true);
    expect(Reflect.set(snapshot, "profile", "developer")).toBe(false);
    expect(Reflect.set(snapshot.quota, "bytes", 1)).toBe(false);
  });

  it("validates an immutable internal signed launch envelope", () => {
    const contract = internalAgentLaunchContractSchema.parse({
      schema_version: INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
      run_id: "4f88bde1-2b49-46cb-914d-7500afdf82d6",
      project_id: "5f88bde1-2b49-46cb-914d-7500afdf82d6",
      environment_id: null,
      runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
      job: {
        reference: "brai-job:immutable-1",
        command_sha256: "a".repeat(64),
      },
      access: {
        schema_version: LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
        user_id: UUID,
        profile: "developer",
        access_generation: 7,
        quota: {},
      },
      issued_at: "2026-07-17T02:00:00.000Z",
      expires_at: "2026-07-17T02:05:00.000Z",
      key_id: "agent-launch:2026-07",
      signature: "A".repeat(43),
    });

    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.access)).toBe(true);
    expect(Object.isFrozen(contract.access.quota)).toBe(true);
  });

  it("rejects expired, malformed, or profile-injected launch envelopes", () => {
    const valid = {
      schema_version: INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
      run_id: "4f88bde1-2b49-46cb-914d-7500afdf82d6",
      project_id: "5f88bde1-2b49-46cb-914d-7500afdf82d6",
      environment_id: "6f88bde1-2b49-46cb-914d-7500afdf82d6",
      runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
      job: {
        reference: "brai-job:immutable-1",
        command_sha256: "a".repeat(64),
      },
      access: {
        schema_version: LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
        user_id: UUID,
        profile: "user-sandbox",
        access_generation: 1,
        quota: {},
      },
      issued_at: "2026-07-17T02:00:00.000Z",
      expires_at: "2026-07-17T02:05:00.000Z",
      key_id: "agent-launch:2026-07",
      signature: "A".repeat(43),
    } as const;

    expect(() =>
      internalAgentLaunchContractSchema.parse({
        ...valid,
        expires_at: valid.issued_at,
      }),
    ).toThrow();
    expect(() =>
      internalAgentLaunchContractSchema.parse({
        ...valid,
        signature: "not base64url!",
      }),
    ).toThrow();
    expect(() =>
      internalAgentLaunchContractSchema.parse({
        ...valid,
        profile: "developer",
      }),
    ).toThrow();
  });

  it("requires a complete typed systemd/cgroup identity", () => {
    const identity = runtimeIdentitySchema.parse({
      schema_version: RUNTIME_IDENTITY_SCHEMA_VERSION,
      profile: "developer",
      runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
      boot_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      systemd_invocation_id: "a".repeat(32),
      unit: "brai-agent-run.service",
      cgroup_path: "/brai-agents.slice/brai-agent-run.service",
      cgroup_inode: 42_001,
      leader_pid: 12_345,
      leader_start_time_ticks: 987_654,
      machine: null,
    });
    expect(identity).toMatchObject({
      profile: "developer",
      machine: null,
      cgroup_inode: 42_001,
    });
    expect(() =>
      runtimeIdentitySchema.parse({
        ...identity,
        profile: "user-sandbox",
        machine: null,
      }),
    ).toThrow();
  });

  it("accepts only a positive typed cgroup-empty observation", () => {
    const proof = {
      observed_at: "2026-07-17T03:00:00.000Z",
      boot_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      systemd_invocation_id: "a".repeat(32),
      unit: "brai-agent-run.service",
      cgroup_path: "/brai-agents.slice/brai-agent-run.service",
      cgroup_inode: 42_001,
      populated: false,
      leader_present: false,
    } as const;
    expect(emptyCgroupProofSchema.parse(proof)).toEqual(proof);
    expect(() =>
      emptyCgroupProofSchema.parse({ ...proof, populated: true }),
    ).toThrow();
  });
});
