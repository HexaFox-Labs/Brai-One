import { z } from "zod";

export const USER_ACCESS_STATE_SCHEMA_VERSION = "brai.agent.access.state.v1";
export const LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION =
  "brai.agent.access.launch-snapshot.v1";
export const INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION =
  "brai.agent.launch.contract.v2";
export const RUNTIME_IDENTITY_SCHEMA_VERSION = "brai.agent.runtime.identity.v1";
export const BRAI_SINGLE_RUNTIME_HOST_ID = "brai-runtime-host-1";

export const USER_SANDBOX_ACCESS_PROFILE = "user-sandbox";
export const DEVELOPER_ACCESS_PROFILE = "developer";
export const ACCESS_PROFILES = [
  USER_SANDBOX_ACCESS_PROFILE,
  DEVELOPER_ACCESS_PROFILE,
] as const;

export const DEFAULT_USER_QUOTA_BYTES = 5 * 1_024 * 1_024 * 1_024;
export const DEFAULT_USER_QUOTA_INODES = 500_000;
export const INITIAL_ACCESS_GENERATION = 1;
export const MAX_ACCESS_GENERATION = Number.MAX_SAFE_INTEGER;
export const MAX_AGENT_LAUNCH_CONTRACT_LIFETIME_MS = 5 * 60 * 1_000;

/**
 * Host-wide v1 user-namespace allocation contract.
 *
 * The pool is the complete systemd "unused" gap 0x70000000..0x7FFDFFFF:
 * it is above systemd-nspawn's automatic container range, below the foreign
 * image range, and entirely below the signed 32-bit boundary. One persistent
 * user environment consumes one 0x20000 range; agents inside it consume no
 * additional host allocation slots.
 */
export const BRAI_SANDBOX_ID_POOL_PRINCIPAL = "brai-sandbox-map";
export const BRAI_SANDBOX_ID_POOL_START = 0x7000_0000;
export const BRAI_SANDBOX_ID_RANGE_SIZE = 0x0002_0000;
export const BRAI_SANDBOX_ID_POOL_SLOT_COUNT = 2_047;
export const BRAI_SANDBOX_ID_POOL_MAX_SLOT =
  BRAI_SANDBOX_ID_POOL_SLOT_COUNT - 1;
export const BRAI_SANDBOX_ID_POOL_COUNT =
  BRAI_SANDBOX_ID_RANGE_SIZE * BRAI_SANDBOX_ID_POOL_SLOT_COUNT;
export const BRAI_SANDBOX_ID_POOL_END =
  BRAI_SANDBOX_ID_POOL_START + BRAI_SANDBOX_ID_POOL_COUNT - 1;
export const LINUX_SIGNED_ID_BOUNDARY = 0x8000_0000;
export const SYSTEMD_NSPAWN_AUTO_ID_POOL_START = 0x0008_0000;
export const SYSTEMD_NSPAWN_AUTO_ID_POOL_END = 0x6fff_ffff;
export const SYSTEMD_FOREIGN_ID_POOL_START = 0x7ffe_0000;
export const SYSTEMD_FOREIGN_ID_POOL_END = 0x7ffe_ffff;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const accessIdentifierSchema = z
  .string()
  .regex(UUID_V4_PATTERN, "Ожидается UUID v4");

const LINUX_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const linuxUuidSchema = z
  .string()
  .regex(LINUX_UUID_PATTERN, "Ожидается Linux UUID");
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u, "Ожидается lowercase SHA-256");
const jobReferenceSchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/u,
    "Некорректная immutable job reference",
  );

export const accessProfileSchema = z.enum(ACCESS_PROFILES);

export const accessGenerationSchema = z
  .number()
  .int()
  .min(INITIAL_ACCESS_GENERATION)
  .max(MAX_ACCESS_GENERATION);

export const storageQuotaSchema = z
  .object({
    bytes: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .default(DEFAULT_USER_QUOTA_BYTES),
    inodes: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .default(DEFAULT_USER_QUOTA_INODES),
  })
  .strict()
  .readonly();

export const runtimeAccessReferenceSchema = z
  .object({
    run_id: accessIdentifierSchema,
    access_generation: accessGenerationSchema,
  })
  .strict()
  .readonly();

const activeUserAccessStateBaseSchema = z
  .object({
    schema_version: z.literal(USER_ACCESS_STATE_SCHEMA_VERSION),
    status: z.literal("active"),
    user_id: accessIdentifierSchema,
    developer_mode: z.boolean(),
    access_generation: accessGenerationSchema,
    quota: storageQuotaSchema,
  })
  .strict();

export const activeUserAccessStateSchema =
  activeUserAccessStateBaseSchema.readonly();

const transitioningUserAccessStateBaseSchema = z
  .object({
    schema_version: z.literal(USER_ACCESS_STATE_SCHEMA_VERSION),
    status: z.literal("transitioning"),
    user_id: accessIdentifierSchema,
    previous_developer_mode: z.boolean(),
    requested_developer_mode: z.boolean(),
    previous_access_generation: accessGenerationSchema,
    access_generation: accessGenerationSchema,
    quota: storageQuotaSchema,
    runs_to_terminate: z.array(runtimeAccessReferenceSchema).readonly(),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.previous_developer_mode === state.requested_developer_mode) {
      context.addIssue({
        code: "custom",
        message: "Переход должен изменять developer mode",
        path: ["requested_developer_mode"],
      });
    }

    if (
      state.previous_access_generation >= MAX_ACCESS_GENERATION ||
      state.access_generation !== state.previous_access_generation + 1
    ) {
      context.addIssue({
        code: "custom",
        message: "Новое поколение доступа должно быть следующим",
        path: ["access_generation"],
      });
    }

    const runIds = new Set<string>();
    for (const run of state.runs_to_terminate) {
      if (runIds.has(run.run_id)) {
        context.addIssue({
          code: "custom",
          message: "Run не должен повторяться в списке завершения",
          path: ["runs_to_terminate"],
        });
        break;
      }
      runIds.add(run.run_id);
    }
  });

export const transitioningUserAccessStateSchema =
  transitioningUserAccessStateBaseSchema.readonly();

export const userAccessStateSchema = z
  .union([activeUserAccessStateSchema, transitioningUserAccessStateSchema])
  .readonly();

export const launchAccessSnapshotSchema = z
  .object({
    schema_version: z.literal(LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION),
    user_id: accessIdentifierSchema,
    profile: accessProfileSchema,
    access_generation: accessGenerationSchema,
    quota: storageQuotaSchema,
  })
  .strict()
  .readonly();

const launchTimestampSchema = z.string().datetime({
  offset: false,
  message: "Ожидается дата и время UTC ISO 8601",
});

const signingKeyIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    "Некорректный идентификатор signing key",
  );

const detachedSignatureSchema = z
  .string()
  .min(43)
  .max(1_024)
  .regex(/^[A-Za-z0-9_-]+$/, "Ожидается base64url signature");

export const immutableAgentJobSchema = z
  .object({
    reference: jobReferenceSchema,
    command_sha256: sha256Schema,
  })
  .strict()
  .readonly();

const systemdUnitSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_.:@\\-]*\.(?:service|scope)$/u,
    "Ожидается transient systemd service/scope",
  );

const cgroupPathSchema = z
  .string()
  .min(2)
  .max(4_096)
  .startsWith("/")
  .refine(
    (value) =>
      !value.includes("//") &&
      !value.split("/").some((segment) => segment === "." || segment === ".."),
    "Некорректный абсолютный cgroup path",
  );

const machineNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u);

const runtimeIdentityBase = {
  schema_version: z.literal(RUNTIME_IDENTITY_SCHEMA_VERSION),
  runtime_host_id: z.literal(BRAI_SINGLE_RUNTIME_HOST_ID),
  boot_id: linuxUuidSchema,
  systemd_invocation_id: z
    .string()
    .regex(/^[a-f0-9]{32}$/u, "Ожидается systemd invocation ID"),
  unit: systemdUnitSchema,
  cgroup_path: cgroupPathSchema,
  cgroup_inode: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  leader_pid: z.number().int().positive().max(4_194_304),
  leader_start_time_ticks: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER),
} as const;

export const developerRuntimeIdentitySchema = z
  .object({
    ...runtimeIdentityBase,
    profile: z.literal(DEVELOPER_ACCESS_PROFILE),
    machine: z.null(),
  })
  .strict()
  .readonly();

export const userSandboxRuntimeIdentitySchema = z
  .object({
    ...runtimeIdentityBase,
    profile: z.literal(USER_SANDBOX_ACCESS_PROFILE),
    machine: machineNameSchema,
  })
  .strict()
  .readonly();

export const runtimeIdentitySchema = z
  .discriminatedUnion("profile", [
    developerRuntimeIdentitySchema,
    userSandboxRuntimeIdentitySchema,
  ])
  .readonly();

export const emptyCgroupProofSchema = z
  .object({
    observed_at: launchTimestampSchema,
    boot_id: linuxUuidSchema,
    systemd_invocation_id: z.string().regex(/^[a-f0-9]{32}$/u),
    unit: systemdUnitSchema,
    cgroup_path: cgroupPathSchema,
    cgroup_inode: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    populated: z.literal(false),
    leader_present: z.literal(false),
  })
  .strict()
  .readonly();

/**
 * Internal-only signed envelope. This schema validates structure and lifetime;
 * it does not verify the signature or define canonical signing bytes.
 */
export const internalAgentLaunchContractSchema = z
  .object({
    schema_version: z.literal(INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION),
    run_id: accessIdentifierSchema,
    project_id: accessIdentifierSchema,
    environment_id: accessIdentifierSchema.nullable(),
    runtime_host_id: z.literal(BRAI_SINGLE_RUNTIME_HOST_ID),
    job: immutableAgentJobSchema,
    access: launchAccessSnapshotSchema,
    issued_at: launchTimestampSchema,
    expires_at: launchTimestampSchema,
    key_id: signingKeyIdSchema,
    signature: detachedSignatureSchema,
  })
  .strict()
  .superRefine((contract, context) => {
    if (Date.parse(contract.expires_at) <= Date.parse(contract.issued_at)) {
      context.addIssue({
        code: "custom",
        message: "Launch contract должен истекать после выдачи",
        path: ["expires_at"],
      });
    }

    const sandbox = contract.access.profile === USER_SANDBOX_ACCESS_PROFILE;
    if (sandbox !== (contract.environment_id !== null)) {
      context.addIssue({
        code: "custom",
        message:
          "environment_id обязателен только для user-sandbox и должен быть null для developer",
        path: ["environment_id"],
      });
    }
  })
  .readonly();

export const agentAccessErrorCodeSchema = z.enum([
  "access_membership_not_found",
  "access_state_invalid",
  "access_profile_invalid",
  "access_subject_mismatch",
  "access_generation_stale",
  "access_generation_exhausted",
  "access_transition_in_progress",
  "runtime_termination_incomplete",
  "runtime_termination_mismatch",
  "launch_contract_invalid",
  "launch_contract_expired",
  "launch_contract_key_unknown",
  "launch_contract_signature_invalid",
  "storage_quota_exceeded",
  "storage_pool_full",
]);

export type AccessProfile = z.infer<typeof accessProfileSchema>;
export type StorageQuota = z.infer<typeof storageQuotaSchema>;
export type RuntimeAccessReference = z.infer<
  typeof runtimeAccessReferenceSchema
>;
export type ActiveUserAccessState = z.infer<typeof activeUserAccessStateSchema>;
export type TransitioningUserAccessState = z.infer<
  typeof transitioningUserAccessStateSchema
>;
export type UserAccessState = z.infer<typeof userAccessStateSchema>;
export type LaunchAccessSnapshot = z.infer<typeof launchAccessSnapshotSchema>;
export type InternalAgentLaunchContract = z.infer<
  typeof internalAgentLaunchContractSchema
>;
export type ImmutableAgentJob = z.infer<typeof immutableAgentJobSchema>;
export type RuntimeIdentity = z.infer<typeof runtimeIdentitySchema>;
export type EmptyCgroupProof = z.infer<typeof emptyCgroupProofSchema>;
export type AgentAccessErrorCode = z.infer<typeof agentAccessErrorCodeSchema>;
