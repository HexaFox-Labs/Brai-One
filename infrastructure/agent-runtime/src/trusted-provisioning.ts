import { lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { BRAI_SINGLE_RUNTIME_HOST_ID } from "@brai/contracts";

import {
  allocateEnvironment,
  OUTER_ID_RANGE_BASE,
  type EnvironmentAllocation,
} from "./allocation.js";

export const TRUSTED_RESERVATION_VERSION =
  "brai.user-environment.reservation.v1";
export const TRUSTED_PROVISIONING_RECEIPT_VERSION =
  "brai.user-environment.provisioned.v1";
export const CANONICAL_ENVIRONMENT_DIRECTORY =
  "/etc/brai-agent-runtime/environments";
export const CANONICAL_IMAGE_PATH =
  "/srv/opt/brai-agent-runtime/images/user-sandbox-v1.raw";
export const CANONICAL_STORAGE_ROOT = "/srv/brai-user-data";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const EXPECTED_KEYS = [
  "access_generation",
  "allocation_slot",
  "environment_id",
  "environment_name",
  "image_brai_gid",
  "image_brai_uid",
  "inner_subgid_start",
  "inner_subid_count",
  "inner_subuid_start",
  "outer_id_range_count",
  "outer_id_range_start",
  "provision_generation",
  "quota_bytes",
  "quota_inodes",
  "reservation_id",
  "runtime_host_id",
  "schema_version",
  "storage_mount_point",
  "storage_path",
  "user_id",
  "xfs_project_id",
] as const;

export interface TrustedEnvironmentReservation {
  readonly schema_version: typeof TRUSTED_RESERVATION_VERSION;
  readonly reservation_id: string;
  readonly user_id: string;
  readonly environment_id: string;
  readonly runtime_host_id: typeof BRAI_SINGLE_RUNTIME_HOST_ID;
  readonly provision_generation: number;
  readonly access_generation: number;
  readonly allocation_slot: number;
  readonly environment_name: string;
  readonly outer_id_range_start: number;
  readonly outer_id_range_count: number;
  readonly image_brai_uid: number;
  readonly image_brai_gid: number;
  readonly inner_subuid_start: number;
  readonly inner_subgid_start: number;
  readonly inner_subid_count: number;
  readonly xfs_project_id: number;
  readonly storage_path: string;
  readonly storage_mount_point: typeof CANONICAL_STORAGE_ROOT;
  readonly quota_bytes: number;
  readonly quota_inodes: number;
}

export interface MeasuredQuota {
  readonly dataPath: string;
  readonly storageDevice: string;
  readonly configuredProjectId: number;
  readonly treeProjectId: number;
  readonly projectInheritance: true;
  readonly enforcementActive: true;
  readonly byteHardLimit: number;
  readonly inodeHardLimit: number;
}

export interface MeasuredBindPath {
  readonly path: string;
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly mode: number;
  readonly directory: boolean;
  readonly symbolicLink: boolean;
}

export interface VerifiedImage {
  readonly path: string;
  readonly sha256: string;
  readonly descriptorVerified: true;
}

export interface TrustedProvisioningReceipt {
  readonly schema_version: typeof TRUSTED_PROVISIONING_RECEIPT_VERSION;
  readonly reservation_id: string;
  readonly user_id: string;
  readonly environment_id: string;
  readonly runtime_host_id: typeof BRAI_SINGLE_RUNTIME_HOST_ID;
  readonly access_generation: number;
  readonly provisioned_at: string;
  readonly allocation: {
    readonly slot: number;
    readonly environment_name: string;
    readonly outer_id_range_start: number;
    readonly outer_id_range_count: number;
    readonly image_brai_uid: number;
    readonly image_brai_gid: number;
    readonly inner_subuid_start: number;
    readonly inner_subgid_start: number;
    readonly inner_subid_count: number;
  };
  readonly image: VerifiedImage;
  readonly storage: {
    readonly mount_point: typeof CANONICAL_STORAGE_ROOT;
    readonly path: string;
    readonly device: string;
    readonly owner_uid: number;
    readonly owner_gid: number;
    readonly mode: number;
    readonly xfs_project_id: number;
    readonly hard_limit_bytes: number;
    readonly hard_limit_inodes: number;
    readonly project_inheritance: true;
    readonly quota_enforcement_active: true;
  };
}

export class TrustedProvisioningError extends Error {
  public constructor(
    public readonly code:
      | "RESERVATION_SCHEMA_INVALID"
      | "RESERVATION_ALLOCATION_MISMATCH"
      | "PROVISIONING_PREFLIGHT_FAILED"
      | "PROVISIONING_MEASUREMENT_MISMATCH"
      | "PROVISIONING_ENVIRONMENT_FILE_CONFLICT"
      | "PROVISIONING_TIMESTAMP_INVALID",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "TrustedProvisioningError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string") {
    throw new TrustedProvisioningError(
      "RESERVATION_SCHEMA_INVALID",
      `${field} must be a string.`,
    );
  }
  return value;
}

function integerField(input: Record<string, unknown>, field: string): number {
  const value = input[field];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TrustedProvisioningError(
      "RESERVATION_SCHEMA_INVALID",
      `${field} must be a positive safe integer.`,
    );
  }
  return value as number;
}

function nonNegativeIntegerField(
  input: Record<string, unknown>,
  field: string,
): number {
  const value = input[field];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TrustedProvisioningError(
      "RESERVATION_SCHEMA_INVALID",
      `${field} must be a non-negative safe integer.`,
    );
  }
  return value as number;
}

export function validateTrustedReservation(input: unknown): {
  readonly reservation: TrustedEnvironmentReservation;
  readonly allocation: EnvironmentAllocation;
} {
  if (!isRecord(input)) {
    throw new TrustedProvisioningError(
      "RESERVATION_SCHEMA_INVALID",
      "Reservation must be a JSON object.",
    );
  }
  const actualKeys = Object.keys(input).sort();
  if (
    actualKeys.length !== EXPECTED_KEYS.length ||
    actualKeys.some((key, index) => key !== [...EXPECTED_KEYS].sort()[index])
  ) {
    throw new TrustedProvisioningError(
      "RESERVATION_SCHEMA_INVALID",
      "Reservation contains missing or unknown fields.",
    );
  }

  const schemaVersion = stringField(input, "schema_version");
  const reservationId = stringField(input, "reservation_id");
  const userId = stringField(input, "user_id");
  const environmentId = stringField(input, "environment_id");
  const runtimeHostId = stringField(input, "runtime_host_id");
  const environmentName = stringField(input, "environment_name");
  const storagePath = stringField(input, "storage_path");
  const storageMountPoint = stringField(input, "storage_mount_point");
  if (
    schemaVersion !== TRUSTED_RESERVATION_VERSION ||
    !UUID_PATTERN.test(reservationId) ||
    !UUID_PATTERN.test(userId) ||
    !UUID_PATTERN.test(environmentId) ||
    runtimeHostId !== BRAI_SINGLE_RUNTIME_HOST_ID ||
    storageMountPoint !== CANONICAL_STORAGE_ROOT
  ) {
    throw new TrustedProvisioningError(
      "RESERVATION_SCHEMA_INVALID",
      "Reservation identity, host, image, or storage constants are invalid.",
    );
  }

  const accessGeneration = integerField(input, "access_generation");
  const provisionGeneration = integerField(input, "provision_generation");
  const allocationSlot = nonNegativeIntegerField(input, "allocation_slot");
  const quotaBytes = integerField(input, "quota_bytes");
  const quotaInodes = integerField(input, "quota_inodes");
  const allocation = allocateEnvironment({
    userId,
    slot: allocationSlot,
    policy: {
      storageRoot: CANONICAL_STORAGE_ROOT,
      outerIdRangeBase: OUTER_ID_RANGE_BASE,
      xfsProjectIdBase: 10_000,
    },
    quotaHardLimit: { bytes: quotaBytes, inodes: quotaInodes },
  });

  const reservation: TrustedEnvironmentReservation = {
    schema_version: TRUSTED_RESERVATION_VERSION,
    reservation_id: reservationId,
    user_id: userId,
    environment_id: environmentId,
    runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
    provision_generation: provisionGeneration,
    access_generation: accessGeneration,
    allocation_slot: allocationSlot,
    environment_name: environmentName,
    outer_id_range_start: integerField(input, "outer_id_range_start"),
    outer_id_range_count: integerField(input, "outer_id_range_count"),
    image_brai_uid: integerField(input, "image_brai_uid"),
    image_brai_gid: integerField(input, "image_brai_gid"),
    inner_subuid_start: integerField(input, "inner_subuid_start"),
    inner_subgid_start: integerField(input, "inner_subgid_start"),
    inner_subid_count: integerField(input, "inner_subid_count"),
    xfs_project_id: integerField(input, "xfs_project_id"),
    storage_path: storagePath,
    storage_mount_point: CANONICAL_STORAGE_ROOT,
    quota_bytes: quotaBytes,
    quota_inodes: quotaInodes,
  };
  if (
    reservation.environment_name !== allocation.environmentName ||
    reservation.outer_id_range_start !== allocation.outerUidRange.start ||
    reservation.outer_id_range_count !== allocation.outerUidRange.count ||
    reservation.image_brai_uid !== allocation.imageBraiUid ||
    reservation.image_brai_gid !== allocation.imageBraiGid ||
    reservation.inner_subuid_start !== allocation.innerSubuidRange.start ||
    reservation.inner_subgid_start !== allocation.innerSubgidRange.start ||
    reservation.inner_subid_count !== allocation.innerSubuidRange.count ||
    reservation.xfs_project_id !== allocation.xfsProjectId ||
    resolve(reservation.storage_path) !== allocation.dataPath
  ) {
    throw new TrustedProvisioningError(
      "RESERVATION_ALLOCATION_MISMATCH",
      "Signed reservation differs from the deterministic persisted slot allocation.",
    );
  }
  return { reservation, allocation };
}

function environmentFile(
  reservation: TrustedEnvironmentReservation,
  allocation: EnvironmentAllocation,
  image: VerifiedImage,
): string {
  return [
    `BRAI_RESERVATION_ID=${reservation.reservation_id}`,
    `BRAI_USER_ID=${reservation.user_id}`,
    `BRAI_ENVIRONMENT_ID=${reservation.environment_id}`,
    `BRAI_RUNTIME_HOST_ID=${reservation.runtime_host_id}`,
    `BRAI_PROVISION_GENERATION=${reservation.provision_generation}`,
    `BRAI_ACCESS_GENERATION=${reservation.access_generation}`,
    `BRAI_USERNS_START=${allocation.outerUidRange.start}`,
    `BRAI_USER_DATA=${allocation.dataPath}`,
    `BRAI_XFS_PROJECT_ID=${allocation.xfsProjectId}`,
    `BRAI_QUOTA_BYTES=${allocation.quotaHardLimit.bytes}`,
    `BRAI_QUOTA_INODES=${allocation.quotaHardLimit.inodes}`,
    `BRAI_IMAGE_SHA256=${image.sha256}`,
    "",
  ].join("\n");
}

export interface TrustedProvisioningDependencies {
  readonly preflight: (
    reservation: TrustedEnvironmentReservation,
    allocation: EnvironmentAllocation,
  ) => Promise<void>;
  readonly provisionQuota: (allocation: EnvironmentAllocation) => Promise<void>;
  readonly measureQuota: (
    allocation: EnvironmentAllocation,
  ) => Promise<MeasuredQuota>;
  readonly measureBindPath: (
    allocation: EnvironmentAllocation,
  ) => Promise<MeasuredBindPath>;
  readonly verifyImage: () => Promise<VerifiedImage>;
  readonly writeEnvironmentFile: (
    environmentName: string,
    content: string,
  ) => Promise<void>;
  readonly now: () => Date;
}

export async function provisionTrustedReservation(
  reservation: TrustedEnvironmentReservation,
  allocation: EnvironmentAllocation,
  dependencies: TrustedProvisioningDependencies,
): Promise<TrustedProvisioningReceipt> {
  try {
    await dependencies.preflight(reservation, allocation);
  } catch (error) {
    throw new TrustedProvisioningError(
      "PROVISIONING_PREFLIGHT_FAILED",
      "Trusted host preflight rejected this reservation.",
      error,
    );
  }
  await dependencies.provisionQuota(allocation);
  const [quota, bindPath, image] = await Promise.all([
    dependencies.measureQuota(allocation),
    dependencies.measureBindPath(allocation),
    dependencies.verifyImage(),
  ]);
  if (
    resolve(quota.dataPath) !== allocation.dataPath ||
    !/^\/dev\/loop[0-9]+$/u.test(quota.storageDevice) ||
    quota.configuredProjectId !== allocation.xfsProjectId ||
    quota.treeProjectId !== allocation.xfsProjectId ||
    !quota.projectInheritance ||
    !quota.enforcementActive ||
    quota.byteHardLimit !== allocation.quotaHardLimit.bytes ||
    quota.inodeHardLimit !== allocation.quotaHardLimit.inodes ||
    resolve(bindPath.path) !== allocation.dataPath ||
    !bindPath.directory ||
    bindPath.symbolicLink ||
    bindPath.ownerUid !== allocation.imageBraiUid ||
    bindPath.ownerGid !== allocation.imageBraiGid ||
    bindPath.mode !== 0o700 ||
    image.path !== CANONICAL_IMAGE_PATH ||
    !image.descriptorVerified ||
    !SHA256_PATTERN.test(image.sha256)
  ) {
    throw new TrustedProvisioningError(
      "PROVISIONING_MEASUREMENT_MISMATCH",
      "Measured owner, quota, or image differs from the signed reservation.",
    );
  }

  await dependencies.writeEnvironmentFile(
    allocation.environmentName,
    environmentFile(reservation, allocation, image),
  );
  const now = dependencies.now();
  if (!Number.isFinite(now.getTime())) {
    throw new TrustedProvisioningError(
      "PROVISIONING_TIMESTAMP_INVALID",
      "Provisioning timestamp is invalid.",
    );
  }
  return {
    schema_version: TRUSTED_PROVISIONING_RECEIPT_VERSION,
    reservation_id: reservation.reservation_id,
    user_id: reservation.user_id,
    environment_id: reservation.environment_id,
    runtime_host_id: reservation.runtime_host_id,
    access_generation: reservation.access_generation,
    provisioned_at: now.toISOString(),
    allocation: {
      slot: allocation.slot,
      environment_name: allocation.environmentName,
      outer_id_range_start: allocation.outerUidRange.start,
      outer_id_range_count: allocation.outerUidRange.count,
      image_brai_uid: allocation.imageBraiUid,
      image_brai_gid: allocation.imageBraiGid,
      inner_subuid_start: allocation.innerSubuidRange.start,
      inner_subgid_start: allocation.innerSubgidRange.start,
      inner_subid_count: allocation.innerSubuidRange.count,
    },
    image,
    storage: {
      mount_point: CANONICAL_STORAGE_ROOT,
      path: allocation.dataPath,
      device: quota.storageDevice,
      owner_uid: bindPath.ownerUid,
      owner_gid: bindPath.ownerGid,
      mode: bindPath.mode,
      xfs_project_id: quota.treeProjectId,
      hard_limit_bytes: quota.byteHardLimit,
      hard_limit_inodes: quota.inodeHardLimit,
      project_inheritance: true,
      quota_enforcement_active: true,
    },
  };
}

export async function writeEnvironmentFileAtomically(
  environmentDirectory: string,
  environmentName: string,
  content: string,
): Promise<void> {
  const destination = join(environmentDirectory, `${environmentName}.env`);
  try {
    const existing = await readFile(destination, "utf8");
    if (existing === content) return;
    throw new TrustedProvisioningError(
      "PROVISIONING_ENVIRONMENT_FILE_CONFLICT",
      "Existing environment file differs from the immutable reservation.",
    );
  } catch (error: unknown) {
    if (
      error instanceof TrustedProvisioningError ||
      (isRecord(error) && error.code !== "ENOENT")
    ) {
      throw error;
    }
  }

  const temporary = join(
    environmentDirectory,
    `.${environmentName}.env.${process.pid}.new`,
  );
  try {
    await writeFile(temporary, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function measureBindPathFromHost(
  allocation: EnvironmentAllocation,
): Promise<MeasuredBindPath> {
  const metadata = await lstat(allocation.dataPath);
  return {
    path: allocation.dataPath,
    ownerUid: metadata.uid,
    ownerGid: metadata.gid,
    mode: metadata.mode & 0o777,
    directory: metadata.isDirectory(),
    symbolicLink: metadata.isSymbolicLink(),
  };
}
