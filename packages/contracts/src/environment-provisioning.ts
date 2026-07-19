import { z } from "zod";

import {
  BRAI_SANDBOX_ID_POOL_MAX_SLOT,
  BRAI_SANDBOX_ID_POOL_START,
  BRAI_SANDBOX_ID_RANGE_SIZE,
  BRAI_SINGLE_RUNTIME_HOST_ID,
} from "./agent-access.js";
import { signedTrustedReceiptEnvelopeSchema } from "./runtime-host.js";

export const RUNTIME_USER_ENVIRONMENT_PROVISION_SUBJECT =
  "brai.runtime.user-environment.provision.v1";
export const ENVIRONMENT_PROVISION_CONTRACT_SCHEMA_VERSION =
  "brai.user-environment.reservation.v1";
export const RUNTIME_USER_ENVIRONMENT_PROVISION_REQUEST_SCHEMA_VERSION =
  "brai.runtime.user-environment.provision.request.v1";
export const RUNTIME_USER_ENVIRONMENT_PROVISION_RESPONSE_SCHEMA_VERSION =
  "brai.runtime.user-environment.provision.response.v1";
export const MAX_ENVIRONMENT_PROVISION_CONTRACT_LIFETIME_MS = 5 * 60 * 1_000;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const uuidV4Schema = z.string().regex(UUID_V4_PATTERN);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const safePositiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const timestampSchema = z.string().refine((value) => {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}, "Expected a canonical ISO-8601 timestamp");
const keyIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u);
const signatureSchema = z
  .string()
  .length(86)
  .regex(/^[A-Za-z0-9_-]+$/u);

function environmentName(slot: number): string {
  return `brai-u-${slot.toString(36)}`;
}

export const environmentProvisionReservationSchema = z
  .object({
    schema_version: z.literal(ENVIRONMENT_PROVISION_CONTRACT_SCHEMA_VERSION),
    reservation_id: uuidV4Schema,
    user_id: uuidV4Schema,
    environment_id: uuidV4Schema,
    runtime_host_id: z.literal(BRAI_SINGLE_RUNTIME_HOST_ID),
    provision_generation: safePositiveIntegerSchema,
    access_generation: safePositiveIntegerSchema,
    allocation_slot: z.number().int().min(0).max(BRAI_SANDBOX_ID_POOL_MAX_SLOT),
    environment_name: z.string().min(8).max(32),
    outer_id_range_start: safePositiveIntegerSchema,
    outer_id_range_count: z.literal(BRAI_SANDBOX_ID_RANGE_SIZE),
    image_brai_uid: safePositiveIntegerSchema,
    image_brai_gid: safePositiveIntegerSchema,
    inner_subuid_start: safePositiveIntegerSchema,
    inner_subgid_start: safePositiveIntegerSchema,
    inner_subid_count: z.literal(65_536),
    xfs_project_id: safePositiveIntegerSchema,
    storage_path: z.string().min(1).max(4_096),
    storage_mount_point: z.literal("/srv/brai-user-data"),
    quota_bytes: safePositiveIntegerSchema.refine(
      (value) => value % 4_096 === 0,
      "Quota bytes must be 4096-byte aligned",
    ),
    quota_inodes: safePositiveIntegerSchema,
  })
  .strict()
  .superRefine((reservation, context) => {
    const start =
      BRAI_SANDBOX_ID_POOL_START +
      reservation.allocation_slot * BRAI_SANDBOX_ID_RANGE_SIZE;
    const expectedName = environmentName(reservation.allocation_slot);
    const expected = {
      environment_name: expectedName,
      outer_id_range_start: start,
      image_brai_uid: start + 1_000,
      image_brai_gid: start + 1_000,
      inner_subuid_start: start + 65_536,
      inner_subgid_start: start + 65_536,
      xfs_project_id: 10_000 + reservation.allocation_slot,
      storage_path: `/srv/brai-user-data/${expectedName}`,
    } as const;
    for (const [field, value] of Object.entries(expected)) {
      if (reservation[field as keyof typeof expected] !== value) {
        context.addIssue({
          code: "custom",
          message: `${field} differs from the deterministic slot allocation`,
          path: [field],
        });
      }
    }
  })
  .readonly();

export const environmentProvisionContractSchema =
  environmentProvisionReservationSchema
    .unwrap()
    .extend({
      issued_at: timestampSchema,
      expires_at: timestampSchema,
      key_id: keyIdSchema,
      signature: signatureSchema,
    })
    .strict()
    .superRefine((contract, context) => {
      const issuedAt = Date.parse(contract.issued_at);
      const expiresAt = Date.parse(contract.expires_at);
      const lifetime = expiresAt - issuedAt;
      if (
        lifetime <= 0 ||
        lifetime > MAX_ENVIRONMENT_PROVISION_CONTRACT_LIFETIME_MS
      ) {
        context.addIssue({
          code: "custom",
          message: "Provision contract lifetime is invalid",
          path: ["expires_at"],
        });
      }
    })
    .readonly();

export const environmentProvisionHostReceiptSchema = z
  .object({
    version: z.literal(1),
    profile: z.literal("user-sandbox"),
    userId: uuidV4Schema,
    accessGeneration: safePositiveIntegerSchema,
    provisionedAt: timestampSchema,
    runtime: z
      .object({
        environmentName: z.string().min(8).max(32),
        outerIdRangeStart: safePositiveIntegerSchema,
        outerIdRangeCount: z.literal(BRAI_SANDBOX_ID_RANGE_SIZE),
        imageBraiUid: safePositiveIntegerSchema,
        imageBraiGid: safePositiveIntegerSchema,
        guestInnerSubuidStart: z.literal(65_536),
        guestInnerSubgidStart: z.literal(65_536),
        effectiveHostInnerSubuidStart: safePositiveIntegerSchema,
        effectiveHostInnerSubgidStart: safePositiveIntegerSchema,
        innerSubidCount: z.literal(65_536),
      })
      .strict(),
    image: z
      .object({
        path: z.literal(
          "/srv/opt/brai-agent-runtime/images/user-sandbox-v1.raw",
        ),
        sha256: sha256Schema,
      })
      .strict(),
    storage: z
      .object({
        mountPoint: z.literal("/srv/brai-user-data"),
        device: z.string().min(1).max(4_096),
        dataPath: z.string().min(1).max(4_096),
        xfsProjectId: safePositiveIntegerSchema,
        hardLimitBytes: safePositiveIntegerSchema,
        hardLimitInodes: safePositiveIntegerSchema,
        projectInheritance: z.literal(true),
        quotaEnforcementActive: z.literal(true),
      })
      .strict(),
  })
  .strict()
  .readonly();

export const environmentProvisionReceiptPayloadSchema = z
  .object({
    environmentId: uuidV4Schema,
    provisionGeneration: safePositiveIntegerSchema,
    allocationSlot: z.number().int().min(0).max(BRAI_SANDBOX_ID_POOL_MAX_SLOT),
    receipt: environmentProvisionHostReceiptSchema,
  })
  .strict()
  .readonly();

const requestMetadata = {
  request_id: uuidV4Schema,
  sent_at: timestampSchema,
} as const;

export const runtimeUserEnvironmentProvisionRequestSchema = z
  .object({
    schema_version: z.literal(
      RUNTIME_USER_ENVIRONMENT_PROVISION_REQUEST_SCHEMA_VERSION,
    ),
    ...requestMetadata,
    payload: z
      .object({ contract: environmentProvisionContractSchema })
      .strict(),
  })
  .strict()
  .readonly();

export const runtimeUserEnvironmentProvisionResponseSchema = z
  .object({
    schema_version: z.literal(
      RUNTIME_USER_ENVIRONMENT_PROVISION_RESPONSE_SCHEMA_VERSION,
    ),
    ...requestMetadata,
    payload: z.discriminatedUnion("accepted", [
      z
        .object({
          accepted: z.literal(true),
          environment_id: uuidV4Schema,
          provision_receipt: signedTrustedReceiptEnvelopeSchema.refine(
            (receipt) => receipt.purpose === "environment-provision-v1",
            "Expected an environment provisioning receipt",
          ),
        })
        .strict(),
      z
        .object({
          accepted: z.literal(false),
          code: z.enum([
            "invalid_request",
            "invalid_contract",
            "provisioning_failed",
            "storage_pool_full",
            "internal_error",
          ]),
          message: z.string().min(1).max(500),
        })
        .strict(),
    ]),
  })
  .strict()
  .readonly();

export type EnvironmentProvisionReservation = z.infer<
  typeof environmentProvisionReservationSchema
>;
export type EnvironmentProvisionContract = z.infer<
  typeof environmentProvisionContractSchema
>;
export type EnvironmentProvisionHostReceipt = z.infer<
  typeof environmentProvisionHostReceiptSchema
>;
export type EnvironmentProvisionReceiptPayload = z.infer<
  typeof environmentProvisionReceiptPayloadSchema
>;
export type RuntimeUserEnvironmentProvisionRequest = z.infer<
  typeof runtimeUserEnvironmentProvisionRequestSchema
>;
export type RuntimeUserEnvironmentProvisionResponse = z.infer<
  typeof runtimeUserEnvironmentProvisionResponseSchema
>;
