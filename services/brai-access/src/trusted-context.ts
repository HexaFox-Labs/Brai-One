import { createHash } from "node:crypto";

import { z } from "zod";
import {
  BRAI_SINGLE_RUNTIME_HOST_ID,
  emptyCgroupProofSchema,
  runtimeIdentitySchema,
  type EmptyCgroupProof,
  type RuntimeIdentity,
} from "@brai/contracts";

import {
  allocationReservationForSlot,
  INNER_SUBID_COUNT,
  INNER_SUBID_OFFSET,
  MAX_ALLOCATION_SLOT,
} from "./allocation-policy.js";
import { AccessServiceError } from "./errors.js";
import {
  verifyTrustedReceiptEnvelope,
  type SignedTrustedReceiptEnvelope,
  type TrustedReceiptPublicKeyResolver,
} from "./signed-receipts.js";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4Schema = z.string().regex(UUID_V4_PATTERN);
const safePositiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const allocationSlotSchema = z.number().int().min(0).max(MAX_ALLOCATION_SLOT);
const absolutePathSchema = z.string().min(1).max(4_096).startsWith("/");
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const isoTimestampSchema = z.string().refine((value) => {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}, "Expected a canonical ISO-8601 timestamp");

const hostProvisioningReceiptSchema = z
  .object({
    version: z.literal(1),
    profile: z.literal("user-sandbox"),
    userId: uuidV4Schema,
    accessGeneration: safePositiveIntegerSchema,
    provisionedAt: isoTimestampSchema,
    runtime: z
      .object({
        environmentName: z.string().min(1).max(32),
        outerIdRangeStart: safePositiveIntegerSchema,
        outerIdRangeCount: safePositiveIntegerSchema,
        imageBraiUid: safePositiveIntegerSchema,
        imageBraiGid: safePositiveIntegerSchema,
        guestInnerSubuidStart: safePositiveIntegerSchema,
        guestInnerSubgidStart: safePositiveIntegerSchema,
        effectiveHostInnerSubuidStart: safePositiveIntegerSchema,
        effectiveHostInnerSubgidStart: safePositiveIntegerSchema,
        innerSubidCount: safePositiveIntegerSchema,
      })
      .strict(),
    image: z
      .object({ path: absolutePathSchema, sha256: sha256Schema })
      .strict(),
    storage: z
      .object({
        mountPoint: absolutePathSchema,
        device: z.string().min(1).max(4_096),
        dataPath: absolutePathSchema,
        xfsProjectId: safePositiveIntegerSchema,
        hardLimitBytes: safePositiveIntegerSchema,
        hardLimitInodes: safePositiveIntegerSchema,
        projectInheritance: z.literal(true),
        quotaEnforcementActive: z.literal(true),
      })
      .strict(),
  })
  .strict();

const provisionEnvelopePayloadSchema = z
  .object({
    environmentId: uuidV4Schema,
    provisionGeneration: safePositiveIntegerSchema,
    allocationSlot: allocationSlotSchema,
    receipt: hostProvisioningReceiptSchema,
  })
  .strict();

const runtimeBindingFields = {
  projectId: uuidV4Schema,
  userId: uuidV4Schema,
  environmentId: uuidV4Schema.nullable(),
  runId: uuidV4Schema,
  profile: z.enum(["user-sandbox", "developer"]),
  accessGeneration: safePositiveIntegerSchema,
  runtimeHostId: z.literal(BRAI_SINGLE_RUNTIME_HOST_ID),
  jobReference: z
    .string()
    .min(1)
    .max(1_024)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/u),
  commandSha256: sha256Schema,
} as const;

function validateRuntimeBinding(
  value: Readonly<{
    profile: "user-sandbox" | "developer";
    environmentId: string | null;
    runtimeHostId: string;
    runtimeIdentity: RuntimeIdentity;
  }>,
  context: z.RefinementCtx,
): void {
  const sandbox = value.profile === "user-sandbox";
  if (sandbox !== (value.environmentId !== null)) {
    context.addIssue({
      code: "custom",
      message: "Environment binding does not match the runtime profile",
      path: ["environmentId"],
    });
  }
  if (
    value.runtimeIdentity.profile !== value.profile ||
    value.runtimeIdentity.runtime_host_id !== value.runtimeHostId
  ) {
    context.addIssue({
      code: "custom",
      message: "Runtime identity does not match immutable launch bindings",
      path: ["runtimeIdentity"],
    });
  }
}

function validateEmptyCgroupProof(
  identity: RuntimeIdentity,
  proof: EmptyCgroupProof,
  context: z.RefinementCtx,
): void {
  if (
    proof.boot_id !== identity.boot_id ||
    proof.systemd_invocation_id !== identity.systemd_invocation_id ||
    proof.unit !== identity.unit ||
    proof.cgroup_path !== identity.cgroup_path ||
    proof.cgroup_inode !== identity.cgroup_inode
  ) {
    context.addIssue({
      code: "custom",
      message: "Empty-cgroup proof does not match the claimed process tree",
      path: ["emptyCgroup"],
    });
  }
}

const runtimeClaimPayloadSchema = z
  .object({
    ...runtimeBindingFields,
    runtimeIdentity: runtimeIdentitySchema,
  })
  .strict()
  .superRefine(validateRuntimeBinding);

const runtimeObservationFields = {
  projectId: uuidV4Schema,
  userId: uuidV4Schema,
  runId: uuidV4Schema,
  accessGeneration: safePositiveIntegerSchema,
  runtimeIdentity: runtimeIdentitySchema,
} as const;

const runtimeStartedPayloadSchema = z
  .object({
    ...runtimeObservationFields,
    startedAt: isoTimestampSchema,
  })
  .strict();

const runtimeExitPayloadSchema = z
  .object({
    ...runtimeObservationFields,
    outcome: z.enum(["succeeded", "failed"]),
    exitCode: z.number().int().min(0).max(255).nullable(),
    signal: z
      .string()
      .min(1)
      .max(32)
      .regex(/^SIG[A-Z0-9]+$/u)
      .nullable(),
    exitedAt: isoTimestampSchema,
    emptyCgroup: emptyCgroupProofSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.outcome === "succeeded" &&
      (value.exitCode !== 0 || value.signal !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "A succeeded runtime must report exit code 0 and no signal",
      });
    }
    if (
      value.outcome === "failed" &&
      !(
        (value.exitCode !== null &&
          value.exitCode > 0 &&
          value.signal === null) ||
        (value.exitCode === null && value.signal !== null)
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A failed runtime must report one non-zero exit code or signal",
      });
    }
    validateEmptyCgroupProof(value.runtimeIdentity, value.emptyCgroup, context);
  });

const terminationPayloadSchema = z
  .object({
    projectId: uuidV4Schema,
    userId: uuidV4Schema,
    runId: uuidV4Schema,
    accessGeneration: safePositiveIntegerSchema,
    kind: z.enum(["cancelled_before_start", "process_tree_killed"]),
    runtimeIdentity: runtimeIdentitySchema.nullable(),
    terminatedAt: isoTimestampSchema,
    emptyCgroup: emptyCgroupProofSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.kind === "cancelled_before_start" &&
        value.runtimeIdentity !== null) ||
      (value.kind === "process_tree_killed" && value.runtimeIdentity === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Termination kind does not match process-tree identity",
      });
    }
    if (
      (value.kind === "cancelled_before_start" && value.emptyCgroup !== null) ||
      (value.kind === "process_tree_killed" && value.emptyCgroup === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Termination kind does not match empty-cgroup proof",
      });
    }
    if (value.runtimeIdentity && value.emptyCgroup) {
      validateEmptyCgroupProof(
        value.runtimeIdentity,
        value.emptyCgroup,
        context,
      );
    }
  });

const accessContextBrand = Symbol("brai.trusted-access-context");
const platformAdminContextBrand = Symbol("brai.trusted-platform-admin-context");
const provisioningContextBrand = Symbol("brai.trusted-provisioning-context");
const runtimeContextBrand = Symbol("brai.trusted-runtime-context");
const provisionReceiptBrand = Symbol("brai.verified-provision-receipt");
const runtimeClaimBrand = Symbol("brai.verified-runtime-claim");
const runtimeStartedBrand = Symbol("brai.verified-runtime-started-receipt");
const runtimeExitBrand = Symbol("brai.verified-runtime-exit-receipt");
const terminationReceiptBrand = Symbol(
  "brai.verified-runtime-termination-receipt",
);

const issuedAccessContexts = new WeakSet<object>();
const issuedPlatformAdminContexts = new WeakSet<object>();
const issuedProvisioningContexts = new WeakSet<object>();
const issuedRuntimeContexts = new WeakSet<object>();
const signedProvisioningResolvers = new WeakMap<
  object,
  TrustedReceiptPublicKeyResolver
>();
const signedRuntimeResolvers = new WeakMap<
  object,
  TrustedReceiptPublicKeyResolver
>();
const issuedProvisionReceipts = new WeakSet<object>();
const issuedRuntimeClaims = new WeakSet<object>();
const issuedRuntimeStartedReceipts = new WeakSet<object>();
const issuedRuntimeExitReceipts = new WeakSet<object>();
const issuedTerminationReceipts = new WeakSet<object>();

export type TrustedAccessContext = Readonly<{
  actorUserId: string;
  [accessContextBrand]: true;
}>;

export type TrustedPlatformAdminContext = Readonly<{
  actorUserId: string;
  [platformAdminContextBrand]: true;
}>;

export type TrustedProvisioningContext = Readonly<{
  [provisioningContextBrand]: true;
}>;

export type TrustedRuntimeContext = Readonly<{
  [runtimeContextBrand]: true;
}>;

export type HostProvisioningReceipt = z.infer<
  typeof hostProvisioningReceiptSchema
>;

export type VerifiedEnvironmentProvisionReceipt = Readonly<{
  userId: string;
  environmentId: string;
  provisionGeneration: number;
  accessGeneration: number;
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
  storageDevice: string;
  quotaBytes: number;
  quotaInodes: number;
  projectInheritance: true;
  quotaEnforcementActive: true;
  imagePath: string;
  imageSha256: string;
  hostProvisionedAt: string;
  evidenceSha256: string;
  [provisionReceiptBrand]: true;
}>;

export type VerifiedRuntimeClaim = Readonly<{
  projectId: string;
  userId: string;
  environmentId: string | null;
  runId: string;
  profile: "user-sandbox" | "developer";
  accessGeneration: number;
  runtimeHostId: typeof BRAI_SINGLE_RUNTIME_HOST_ID;
  jobReference: string;
  commandSha256: string;
  runtimeIdentity: RuntimeIdentity;
  [runtimeClaimBrand]: true;
}>;

export type VerifiedRuntimeStartedReceipt = Readonly<{
  projectId: string;
  userId: string;
  runId: string;
  accessGeneration: number;
  runtimeIdentity: RuntimeIdentity;
  startedAt: string;
  [runtimeStartedBrand]: true;
}>;

export type VerifiedRuntimeExitReceipt = Readonly<{
  projectId: string;
  userId: string;
  runId: string;
  accessGeneration: number;
  runtimeIdentity: RuntimeIdentity;
  outcome: "succeeded" | "failed";
  exitCode: number | null;
  signal: string | null;
  exitedAt: string;
  emptyCgroup: EmptyCgroupProof;
  [runtimeExitBrand]: true;
}>;

export type VerifiedRuntimeTerminationReceipt = Readonly<{
  projectId: string;
  userId: string;
  runId: string;
  accessGeneration: number;
  kind: "cancelled_before_start" | "process_tree_killed";
  runtimeIdentity: RuntimeIdentity | null;
  terminatedAt: string;
  emptyCgroup: EmptyCgroupProof | null;
  [terminationReceiptBrand]: true;
}>;

function trustedContextError(message: string, cause?: unknown): never {
  throw new AccessServiceError("access_trusted_context_required", message, {
    cause,
  });
}

function parseServerIdentity(actorUserId: string): string {
  const parsed = uuidV4Schema.safeParse(actorUserId);
  if (!parsed.success) {
    return trustedContextError(
      "Trusted context requires an authenticated UUID v4 identity",
      parsed.error,
    );
  }
  return parsed.data;
}

function parseTrustedPayload<Output>(
  schema: z.ZodType<Output>,
  input: unknown,
  message: string,
): Output {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return trustedContextError(message, parsed.error);
  }
  return parsed.data;
}

function issueProvisioningContext(): TrustedProvisioningContext {
  const context = Object.freeze({
    [provisioningContextBrand]: true as const,
  });
  issuedProvisioningContexts.add(context);
  return context;
}

function issueRuntimeContext(): TrustedRuntimeContext {
  const context = Object.freeze({ [runtimeContextBrand]: true as const });
  issuedRuntimeContexts.add(context);
  return context;
}

/** Authenticated-user adapter seam. JSON cannot preserve WeakSet issuance. */
export function trustedAccessContextFromServerIdentity(
  actorUserId: string,
): TrustedAccessContext {
  const context = Object.freeze({
    actorUserId: parseServerIdentity(actorUserId),
    [accessContextBrand]: true as const,
  });
  issuedAccessContexts.add(context);
  return context;
}

/** Global platform-superadmin adapter seam, distinct from project roles. */
export function trustedPlatformAdminContextFromServerIdentity(
  actorUserId: string,
): TrustedPlatformAdminContext {
  const context = Object.freeze({
    actorUserId: parseServerIdentity(actorUserId),
    [platformAdminContextBrand]: true as const,
  });
  issuedPlatformAdminContexts.add(context);
  return context;
}

/** Same-process host seam. Never expose this issuer through a transport. */
export function trustedProvisioningContextFromServer(): TrustedProvisioningContext {
  return issueProvisioningContext();
}

/** Cross-process host seam bound to server-configured Ed25519 public keys. */
export function trustedProvisioningContextFromEd25519KeyResolver(
  resolvePublicKey: TrustedReceiptPublicKeyResolver,
): TrustedProvisioningContext {
  if (typeof resolvePublicKey !== "function") {
    return trustedContextError("Provisioning key resolver is required");
  }
  const context = issueProvisioningContext();
  signedProvisioningResolvers.set(context, resolvePublicKey);
  return context;
}

/** Same-process runtime-controller seam. Never expose this issuer via NATS/HTTP. */
export function trustedRuntimeContextFromServer(): TrustedRuntimeContext {
  return issueRuntimeContext();
}

/** Cross-process controller seam bound to server-configured Ed25519 public keys. */
export function trustedRuntimeContextFromEd25519KeyResolver(
  resolvePublicKey: TrustedReceiptPublicKeyResolver,
): TrustedRuntimeContext {
  if (typeof resolvePublicKey !== "function") {
    return trustedContextError("Runtime key resolver is required");
  }
  const context = issueRuntimeContext();
  signedRuntimeResolvers.set(context, resolvePublicKey);
  return context;
}

export function actorFromTrustedContext(context: unknown): string {
  if (
    typeof context !== "object" ||
    context === null ||
    !issuedAccessContexts.has(context) ||
    !("actorUserId" in context) ||
    typeof context.actorUserId !== "string"
  ) {
    return trustedContextError("Требуется server-authenticated access context");
  }
  return context.actorUserId;
}

export function assertTrustedPlatformAdminContext(context: unknown): void {
  if (
    typeof context !== "object" ||
    context === null ||
    !issuedPlatformAdminContexts.has(context)
  ) {
    throw new AccessServiceError(
      "access_admin_required",
      "Developer mode может менять только platform superadmin",
    );
  }
}

export function assertTrustedProvisioningContext(context: unknown): void {
  if (
    typeof context !== "object" ||
    context === null ||
    !issuedProvisioningContexts.has(context)
  ) {
    return trustedContextError("Требуется trusted host provisioning context");
  }
}

export function assertTrustedRuntimeContext(context: unknown): void {
  if (
    typeof context !== "object" ||
    context === null ||
    !issuedRuntimeContexts.has(context)
  ) {
    return trustedContextError("Требуется trusted runtime-controller context");
  }
}

function requireSameProcessProvisioningContext(
  context: TrustedProvisioningContext,
): void {
  assertTrustedProvisioningContext(context);
  if (signedProvisioningResolvers.has(context)) {
    return trustedContextError(
      "A key-bound provisioning context accepts only signed envelopes",
    );
  }
}

function requireSameProcessRuntimeContext(
  context: TrustedRuntimeContext,
): void {
  assertTrustedRuntimeContext(context);
  if (signedRuntimeResolvers.has(context)) {
    return trustedContextError(
      "A key-bound runtime context accepts only signed envelopes",
    );
  }
}

function signedProvisioningPayload(
  context: TrustedProvisioningContext,
  envelope: SignedTrustedReceiptEnvelope,
): unknown {
  assertTrustedProvisioningContext(context);
  const resolver = signedProvisioningResolvers.get(context);
  if (!resolver) {
    return trustedContextError(
      "A signed provisioning envelope requires a key-bound context",
    );
  }
  return verifyTrustedReceiptEnvelope(
    envelope,
    "environment-provision-v1",
    resolver,
  );
}

function signedRuntimePayload(
  context: TrustedRuntimeContext,
  envelope: SignedTrustedReceiptEnvelope,
  purpose:
    | "runtime-claim-v2"
    | "runtime-started-v2"
    | "runtime-exit-v2"
    | "runtime-termination-v2",
): unknown {
  assertTrustedRuntimeContext(context);
  const resolver = signedRuntimeResolvers.get(context);
  if (!resolver) {
    return trustedContextError(
      "A signed runtime envelope requires a key-bound context",
    );
  }
  return verifyTrustedReceiptEnvelope(envelope, purpose, resolver);
}

function buildProvisionReceipt(
  input: unknown,
): VerifiedEnvironmentProvisionReceipt {
  const envelope = parseTrustedPayload(
    provisionEnvelopePayloadSchema,
    input,
    "Host provisioning receipt is malformed",
  );
  const host = envelope.receipt;
  const slot = envelope.allocationSlot;
  const reservation = allocationReservationForSlot(slot);
  const valid =
    host.runtime.environmentName === reservation.environmentName &&
    host.runtime.outerIdRangeStart === reservation.outerIdRangeStart &&
    host.runtime.outerIdRangeCount === reservation.outerIdRangeCount &&
    host.runtime.imageBraiUid === reservation.unixUid &&
    host.runtime.imageBraiGid === reservation.unixGid &&
    host.runtime.guestInnerSubuidStart === INNER_SUBID_OFFSET &&
    host.runtime.guestInnerSubgidStart === INNER_SUBID_OFFSET &&
    host.runtime.effectiveHostInnerSubuidStart === reservation.subuidStart &&
    host.runtime.effectiveHostInnerSubgidStart === reservation.subgidStart &&
    host.runtime.innerSubidCount === INNER_SUBID_COUNT &&
    host.storage.mountPoint === reservation.storageMountPoint &&
    host.storage.dataPath === reservation.storagePath &&
    host.storage.xfsProjectId === reservation.quotaProjectId;
  if (!valid) {
    throw new AccessServiceError(
      "access_input_invalid",
      "Host receipt does not match deterministic runtime allocation policy",
    );
  }

  const receipt = Object.freeze({
    userId: host.userId,
    environmentId: envelope.environmentId,
    provisionGeneration: envelope.provisionGeneration,
    accessGeneration: host.accessGeneration,
    ...reservation,
    storageDevice: host.storage.device,
    quotaBytes: host.storage.hardLimitBytes,
    quotaInodes: host.storage.hardLimitInodes,
    projectInheritance: host.storage.projectInheritance,
    quotaEnforcementActive: host.storage.quotaEnforcementActive,
    imagePath: host.image.path,
    imageSha256: host.image.sha256,
    hostProvisionedAt: host.provisionedAt,
    evidenceSha256: createHash("sha256")
      .update(JSON.stringify(host))
      .digest("hex"),
    [provisionReceiptBrand]: true as const,
  });
  issuedProvisionReceipts.add(receipt);
  return receipt;
}

export function verifiedEnvironmentProvisionReceiptFromHost(
  context: TrustedProvisioningContext,
  input: unknown,
): VerifiedEnvironmentProvisionReceipt {
  requireSameProcessProvisioningContext(context);
  return buildProvisionReceipt(input);
}

export function verifiedEnvironmentProvisionReceiptFromSignedEnvelope(
  context: TrustedProvisioningContext,
  envelope: SignedTrustedReceiptEnvelope,
): VerifiedEnvironmentProvisionReceipt {
  return buildProvisionReceipt(signedProvisioningPayload(context, envelope));
}

export function assertVerifiedEnvironmentProvisionReceipt(
  receipt: unknown,
): asserts receipt is VerifiedEnvironmentProvisionReceipt {
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    !issuedProvisionReceipts.has(receipt)
  ) {
    return trustedContextError("Требуется verified host provision receipt");
  }
}

function buildRuntimeClaim(input: unknown): VerifiedRuntimeClaim {
  const parsed = parseTrustedPayload(
    runtimeClaimPayloadSchema,
    input,
    "Runtime claim is malformed",
  );
  const claim = Object.freeze({
    projectId: parsed.projectId,
    userId: parsed.userId,
    environmentId: parsed.environmentId,
    runId: parsed.runId,
    profile: parsed.profile,
    accessGeneration: parsed.accessGeneration,
    runtimeHostId: parsed.runtimeHostId,
    jobReference: parsed.jobReference,
    commandSha256: parsed.commandSha256,
    runtimeIdentity: parsed.runtimeIdentity,
    [runtimeClaimBrand]: true as const,
  });
  issuedRuntimeClaims.add(claim);
  return claim;
}

export function verifiedRuntimeClaimFromController(
  context: TrustedRuntimeContext,
  claims: unknown,
): VerifiedRuntimeClaim {
  requireSameProcessRuntimeContext(context);
  return buildRuntimeClaim(claims);
}

export function verifiedRuntimeClaimFromSignedEnvelope(
  context: TrustedRuntimeContext,
  envelope: SignedTrustedReceiptEnvelope,
): VerifiedRuntimeClaim {
  return buildRuntimeClaim(
    signedRuntimePayload(context, envelope, "runtime-claim-v2"),
  );
}

export function assertVerifiedRuntimeClaim(
  claim: unknown,
): asserts claim is VerifiedRuntimeClaim {
  if (
    typeof claim !== "object" ||
    claim === null ||
    !issuedRuntimeClaims.has(claim)
  ) {
    return trustedContextError("Требуется verified one-time runtime claim");
  }
}

function buildRuntimeStartedReceipt(
  input: unknown,
): VerifiedRuntimeStartedReceipt {
  const parsed = parseTrustedPayload(
    runtimeStartedPayloadSchema,
    input,
    "Runtime started receipt is malformed",
  );
  const receipt = Object.freeze({
    projectId: parsed.projectId,
    userId: parsed.userId,
    runId: parsed.runId,
    accessGeneration: parsed.accessGeneration,
    runtimeIdentity: parsed.runtimeIdentity,
    startedAt: parsed.startedAt,
    [runtimeStartedBrand]: true as const,
  });
  issuedRuntimeStartedReceipts.add(receipt);
  return receipt;
}

export function verifiedRuntimeStartedReceiptFromController(
  context: TrustedRuntimeContext,
  claims: Readonly<{
    projectId: string;
    userId: string;
    runId: string;
    accessGeneration: number;
    runtimeIdentity: RuntimeIdentity;
    startedAt: Date;
  }>,
): VerifiedRuntimeStartedReceipt {
  requireSameProcessRuntimeContext(context);
  return buildRuntimeStartedReceipt({
    ...claims,
    startedAt: claims.startedAt.toISOString(),
  });
}

export function verifiedRuntimeStartedReceiptFromSignedEnvelope(
  context: TrustedRuntimeContext,
  envelope: SignedTrustedReceiptEnvelope,
): VerifiedRuntimeStartedReceipt {
  return buildRuntimeStartedReceipt(
    signedRuntimePayload(context, envelope, "runtime-started-v2"),
  );
}

export function assertVerifiedRuntimeStartedReceipt(
  receipt: unknown,
): asserts receipt is VerifiedRuntimeStartedReceipt {
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    !issuedRuntimeStartedReceipts.has(receipt)
  ) {
    return trustedContextError("Требуется verified runtime started receipt");
  }
}

function buildRuntimeExitReceipt(input: unknown): VerifiedRuntimeExitReceipt {
  const parsed = parseTrustedPayload(
    runtimeExitPayloadSchema,
    input,
    "Runtime exit receipt is malformed",
  );
  const receipt = Object.freeze({
    projectId: parsed.projectId,
    userId: parsed.userId,
    runId: parsed.runId,
    accessGeneration: parsed.accessGeneration,
    runtimeIdentity: parsed.runtimeIdentity,
    outcome: parsed.outcome,
    exitCode: parsed.exitCode,
    signal: parsed.signal,
    exitedAt: parsed.exitedAt,
    emptyCgroup: parsed.emptyCgroup,
    [runtimeExitBrand]: true as const,
  });
  issuedRuntimeExitReceipts.add(receipt);
  return receipt;
}

export function verifiedRuntimeExitReceiptFromController(
  context: TrustedRuntimeContext,
  claims: Readonly<{
    projectId: string;
    userId: string;
    runId: string;
    accessGeneration: number;
    runtimeIdentity: RuntimeIdentity;
    outcome: "succeeded" | "failed";
    exitCode: number | null;
    signal: string | null;
    exitedAt: Date;
    emptyCgroup: EmptyCgroupProof;
  }>,
): VerifiedRuntimeExitReceipt {
  requireSameProcessRuntimeContext(context);
  return buildRuntimeExitReceipt({
    ...claims,
    exitedAt: claims.exitedAt.toISOString(),
  });
}

export function verifiedRuntimeExitReceiptFromSignedEnvelope(
  context: TrustedRuntimeContext,
  envelope: SignedTrustedReceiptEnvelope,
): VerifiedRuntimeExitReceipt {
  return buildRuntimeExitReceipt(
    signedRuntimePayload(context, envelope, "runtime-exit-v2"),
  );
}

export function assertVerifiedRuntimeExitReceipt(
  receipt: unknown,
): asserts receipt is VerifiedRuntimeExitReceipt {
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    !issuedRuntimeExitReceipts.has(receipt)
  ) {
    return trustedContextError("Требуется verified runtime exit receipt");
  }
}

function buildTerminationReceipt(
  input: unknown,
): VerifiedRuntimeTerminationReceipt {
  const parsed = parseTrustedPayload(
    terminationPayloadSchema,
    input,
    "Runtime termination receipt is malformed",
  );
  const receipt = Object.freeze({
    projectId: parsed.projectId,
    userId: parsed.userId,
    runId: parsed.runId,
    accessGeneration: parsed.accessGeneration,
    kind: parsed.kind,
    runtimeIdentity: parsed.runtimeIdentity,
    terminatedAt: parsed.terminatedAt,
    emptyCgroup: parsed.emptyCgroup,
    [terminationReceiptBrand]: true as const,
  });
  issuedTerminationReceipts.add(receipt);
  return receipt;
}

export function verifiedRuntimeTerminationReceiptFromController(
  context: TrustedRuntimeContext,
  claims: Readonly<{
    projectId: string;
    userId: string;
    runId: string;
    accessGeneration: number;
    kind: "cancelled_before_start" | "process_tree_killed";
    runtimeIdentity: RuntimeIdentity | null;
    terminatedAt: Date;
    emptyCgroup: EmptyCgroupProof | null;
  }>,
): VerifiedRuntimeTerminationReceipt {
  requireSameProcessRuntimeContext(context);
  return buildTerminationReceipt({
    ...claims,
    terminatedAt: claims.terminatedAt.toISOString(),
  });
}

export function verifiedRuntimeTerminationReceiptFromSignedEnvelope(
  context: TrustedRuntimeContext,
  envelope: SignedTrustedReceiptEnvelope,
): VerifiedRuntimeTerminationReceipt {
  return buildTerminationReceipt(
    signedRuntimePayload(context, envelope, "runtime-termination-v2"),
  );
}

export function assertVerifiedRuntimeTerminationReceipt(
  receipt: unknown,
): asserts receipt is VerifiedRuntimeTerminationReceipt {
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    !issuedTerminationReceipts.has(receipt)
  ) {
    return trustedContextError(
      "Требуется verified OS process-tree termination receipt",
    );
  }
}
