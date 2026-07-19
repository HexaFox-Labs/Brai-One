import { z } from "zod";

import { accessProfileSchema, runtimeIdentitySchema } from "./agent-access.js";

export const RUNTIME_AGENT_RUN_TERMINATE_SUBJECT =
  "brai.runtime.agent-run.terminate.v1";
export const ACCESS_RUNTIME_RECEIPT_CLAIM_SUBJECT =
  "brai.access.runtime-receipt.claim.v1";
export const ACCESS_RUNTIME_RECEIPT_STARTED_SUBJECT =
  "brai.access.runtime-receipt.started.v1";
export const ACCESS_RUNTIME_RECEIPT_EXIT_SUBJECT =
  "brai.access.runtime-receipt.exit.v1";

export const RUNTIME_AGENT_RUN_TERMINATE_REQUEST_SCHEMA_VERSION =
  "brai.runtime.agent-run.terminate.request.v1";
export const RUNTIME_AGENT_RUN_TERMINATE_RESPONSE_SCHEMA_VERSION =
  "brai.runtime.agent-run.terminate.response.v1";
export const ACCESS_RUNTIME_RECEIPT_REQUEST_SCHEMA_VERSION =
  "brai.access.runtime-receipt.request.v1";
export const ACCESS_RUNTIME_RECEIPT_RESPONSE_SCHEMA_VERSION =
  "brai.access.runtime-receipt.response.v1";

export const TRUSTED_RECEIPT_PURPOSES = [
  "environment-provision-v1",
  "runtime-claim-v2",
  "runtime-started-v2",
  "runtime-exit-v2",
  "runtime-termination-v2",
] as const;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4Schema = z.string().regex(UUID_V4_PATTERN);
const timestampSchema = z.string().refine((value) => {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}, "Expected a canonical ISO-8601 timestamp");
const safePositiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const trustedReceiptPurposeSchema = z.enum(TRUSTED_RECEIPT_PURPOSES);

export const unsignedTrustedReceiptEnvelopeSchema = z
  .object({
    version: z.literal(1),
    purpose: trustedReceiptPurposeSchema,
    key_id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u),
    payload: z.string().min(2).max(65_536),
  })
  .strict()
  .readonly();

export const signedTrustedReceiptEnvelopeSchema = z
  .object({
    version: z.literal(1),
    purpose: trustedReceiptPurposeSchema,
    key_id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u),
    payload: z.string().min(2).max(65_536),
    signature: z
      .string()
      .length(86)
      .regex(/^[A-Za-z0-9_-]+$/u),
  })
  .strict()
  .readonly();

const requestMetadata = {
  request_id: uuidV4Schema,
  sent_at: timestampSchema,
} as const;

export const accessRuntimeReceiptRequestSchema = z
  .object({
    schema_version: z.literal(ACCESS_RUNTIME_RECEIPT_REQUEST_SCHEMA_VERSION),
    ...requestMetadata,
    payload: z
      .object({
        receipt: signedTrustedReceiptEnvelopeSchema,
      })
      .strict(),
  })
  .strict()
  .readonly();

export const accessRuntimeReceiptResponseSchema = z
  .object({
    schema_version: z.literal(ACCESS_RUNTIME_RECEIPT_RESPONSE_SCHEMA_VERSION),
    ...requestMetadata,
    payload: z.discriminatedUnion("accepted", [
      z
        .object({
          accepted: z.literal(true),
          disposition: z.enum(["applied", "replayed"]),
        })
        .strict(),
      z
        .object({
          accepted: z.literal(false),
          code: z.enum(["invalid_receipt", "stale_binding", "internal_error"]),
          message: z.string().min(1).max(500),
        })
        .strict(),
    ]),
  })
  .strict()
  .readonly();

export const runtimeAgentRunTerminateRequestSchema = z
  .object({
    schema_version: z.literal(
      RUNTIME_AGENT_RUN_TERMINATE_REQUEST_SCHEMA_VERSION,
    ),
    ...requestMetadata,
    payload: z
      .object({
        project_id: uuidV4Schema,
        user_id: uuidV4Schema,
        run_id: uuidV4Schema,
        access_generation: safePositiveIntegerSchema,
        profile: accessProfileSchema,
        environment_id: uuidV4Schema.nullable(),
        runtime_identity: runtimeIdentitySchema.nullable(),
      })
      .strict()
      .superRefine((payload, context) => {
        const sandbox = payload.profile === "user-sandbox";
        if (sandbox !== (payload.environment_id !== null)) {
          context.addIssue({
            code: "custom",
            path: ["environment_id"],
            message:
              "environment_id обязателен только для user-sandbox termination",
          });
        }
        if (
          payload.runtime_identity !== null &&
          payload.runtime_identity.profile !== payload.profile
        ) {
          context.addIssue({
            code: "custom",
            path: ["runtime_identity", "profile"],
            message:
              "runtime identity profile должен совпадать с termination binding",
          });
        }
      }),
  })
  .strict()
  .readonly();

export const runtimeAgentRunTerminateResponseSchema = z
  .object({
    schema_version: z.literal(
      RUNTIME_AGENT_RUN_TERMINATE_RESPONSE_SCHEMA_VERSION,
    ),
    ...requestMetadata,
    payload: z.discriminatedUnion("accepted", [
      z
        .object({
          accepted: z.literal(true),
          run_id: uuidV4Schema,
          termination_receipt: signedTrustedReceiptEnvelopeSchema.refine(
            (receipt) => receipt.purpose === "runtime-termination-v2",
            "Expected a runtime termination receipt",
          ),
        })
        .strict(),
      z
        .object({
          accepted: z.literal(false),
          code: z.enum([
            "invalid_request",
            "runtime_not_found",
            "identity_mismatch",
            "runtime_unavailable",
            "internal_error",
          ]),
          message: z.string().min(1).max(500),
        })
        .strict(),
    ]),
  })
  .strict()
  .readonly();

export type TrustedReceiptPurpose = z.infer<typeof trustedReceiptPurposeSchema>;
export type UnsignedTrustedReceiptEnvelope = z.infer<
  typeof unsignedTrustedReceiptEnvelopeSchema
>;
export type SignedTrustedReceiptEnvelope = z.infer<
  typeof signedTrustedReceiptEnvelopeSchema
>;
export type AccessRuntimeReceiptRequest = z.infer<
  typeof accessRuntimeReceiptRequestSchema
>;
export type AccessRuntimeReceiptResponse = z.infer<
  typeof accessRuntimeReceiptResponseSchema
>;
export type RuntimeAgentRunTerminateRequest = z.infer<
  typeof runtimeAgentRunTerminateRequestSchema
>;
export type RuntimeAgentRunTerminateResponse = z.infer<
  typeof runtimeAgentRunTerminateResponseSchema
>;
