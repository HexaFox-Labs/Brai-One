import type {
  AccessProfile,
  RuntimeIdentity,
  LaunchAccessSnapshot,
  RuntimeAccessReference,
  StorageQuota,
} from "@brai/contracts";

export const PROJECT_MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

export type ActiveProjectMembership = Readonly<{
  role: ProjectMemberRole;
  membershipGeneration: number;
}>;

export type StoredAccessState = Readonly<{
  userId: string;
  status: "active" | "transitioning";
  developerMode: boolean;
  accessGeneration: number;
  previousDeveloperMode: boolean | null;
  requestedDeveloperMode: boolean | null;
  previousAccessGeneration: number | null;
  quota: StorageQuota;
}>;

export type UserEnvironment = Readonly<{
  userId: string;
  environmentId: string;
  status: "unprovisioned" | "provisioning" | "ready" | "failed";
  provisionGeneration: number;
  provisionAccessGeneration: number | null;
  quota: StorageQuota;
  enforcedQuota: StorageQuota | null;
  allocationSlot: number | null;
  environmentName: string | null;
  outerIdRangeStart: number | null;
  outerIdRangeCount: number | null;
  unixUid: number | null;
  unixGid: number | null;
  subuidStart: number | null;
  subgidStart: number | null;
  subidCount: number | null;
  quotaProjectId: number | null;
  storagePath: string | null;
  storageMountPoint: string | null;
  storageDevice: string | null;
  projectInheritance: boolean | null;
  quotaEnforcementActive: boolean | null;
  imagePath: string | null;
  imageSha256: string | null;
  hostProvisionedAt: string | null;
}>;

export type ProvisioningUserEnvironment = UserEnvironment &
  Readonly<{
    status: "provisioning";
    provisionAccessGeneration: number;
    allocationSlot: number;
    environmentName: string;
    outerIdRangeStart: number;
    outerIdRangeCount: number;
    unixUid: number;
    unixGid: number;
    subuidStart: number;
    subgidStart: number;
    subidCount: number;
    quotaProjectId: number;
    storagePath: string;
    storageMountPoint: string;
  }>;

export type EnvironmentProvisioning = Readonly<{
  environment: ProvisioningUserEnvironment;
  access_generation: number;
}>;

export type PendingAgentRun = Readonly<{
  runId: string;
  projectId: string;
  userId: string;
  environmentId: string | null;
  profile: AccessProfile;
  runtimeHostId: string;
  jobReference: string;
  commandSha256: string;
  accessGeneration: number;
  membershipGeneration: number;
  quota: StorageQuota;
  status: "pending";
}>;

export type PendingLaunch = Readonly<{
  run_id: string;
  project_id: string;
  environment_id: string | null;
  runtime_host_id: string;
  job: Readonly<{
    reference: string;
    command_sha256: string;
  }>;
  status: "pending";
  access: LaunchAccessSnapshot;
}>;

export type DeveloperModeTransition = Readonly<{
  changed: boolean;
  user_id: string;
  access_generation: number;
  runs_to_terminate: readonly RuntimeAccessReference[];
  /**
   * Server-only immutable OS bindings used by the deterministic runtime
   * controller. Access API responses must never serialize this field.
   */
  runtime_bindings_to_terminate: readonly CapturedRuntime[];
}>;

export type CapturedRuntime = Readonly<{
  projectId: string;
  runId: string;
  profile: AccessProfile;
  environmentId: string | null;
  accessGeneration: number;
  runtimeIdentity: RuntimeIdentity | null;
}>;
