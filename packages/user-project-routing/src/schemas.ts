import { z } from "zod";

export const ROUTING_SCHEMA_VERSION = 1 as const;
export const INGRESS_DESIRED_STATE_SCHEMA_VERSION = 2 as const;
export const MIN_USER_PROJECT_PORT = 1_024;
export const MAX_USER_PROJECT_PORT = 65_535;

export const identifierSchema = z.string().uuid();
export const internalPortSchema = z
  .number()
  .int()
  .min(MIN_USER_PROJECT_PORT)
  .max(MAX_USER_PROJECT_PORT);

export const routeTargetSchema = z.strictObject({
  environment_id: identifierSchema,
  port: internalPortSchema,
});

export const projectEnvironmentOwnershipSchema = z.strictObject({
  project_id: identifierSchema,
  environment_id: identifierSchema,
  owner_user_id: identifierSchema,
});

export const issueGeneratedRouteRequestSchema = z.strictObject({
  project_id: identifierSchema,
  environment_id: identifierSchema,
  port: internalPortSchema,
});

export const beginCustomDomainVerificationRequestSchema = z.strictObject({
  project_id: identifierSchema,
  environment_id: identifierSchema,
  port: internalPortSchema,
  hostname: z.string().min(1).max(253),
});

export const activateCustomDomainRequestSchema = z.strictObject({
  challenge_id: identifierSchema,
});

export const routeMutationRequestSchema = z.strictObject({
  route_id: identifierSchema,
});

export const ingressRouteSchema = z
  .strictObject({
    schema_version: z.literal(ROUTING_SCHEMA_VERSION),
    route_id: identifierSchema,
    hostname: z.string().min(1).max(253),
    kind: z.enum(["generated", "custom"]),
    owner_user_id: identifierSchema,
    project_id: identifierSchema,
    target: routeTargetSchema,
    verification_challenge_id: identifierSchema.nullable(),
    status: z.enum(["active", "revoked", "deleted"]),
    revision: z.number().int().positive(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .superRefine((route, context) => {
    if (
      route.kind === "generated" &&
      route.verification_challenge_id !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Generated routes cannot reference a custom-domain challenge",
        path: ["verification_challenge_id"],
      });
    }
    if (route.kind === "custom" && route.verification_challenge_id === null) {
      context.addIssue({
        code: "custom",
        message: "Custom routes require a verification challenge",
        path: ["verification_challenge_id"],
      });
    }
  });

export const customDomainChallengeSchema = z
  .strictObject({
    schema_version: z.literal(ROUTING_SCHEMA_VERSION),
    challenge_id: identifierSchema,
    owner_user_id: identifierSchema,
    project_id: identifierSchema,
    target: routeTargetSchema,
    hostname: z.string().min(1).max(253),
    record_name: z.string().min(1).max(253),
    expected_value: z.string().min(1).max(255),
    status: z.enum(["pending", "activated", "cancelled"]),
    activated_route_id: identifierSchema.nullable(),
    revision: z.number().int().positive(),
    created_at: z.iso.datetime(),
    expires_at: z.iso.datetime(),
  })
  .superRefine((challenge, context) => {
    if (
      challenge.status === "activated" &&
      challenge.activated_route_id === null
    ) {
      context.addIssue({
        code: "custom",
        message: "An activated challenge must reference its route",
        path: ["activated_route_id"],
      });
    }
    if (
      challenge.status !== "activated" &&
      challenge.activated_route_id !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Only an activated challenge may reference a route",
        path: ["activated_route_id"],
      });
    }
  });

export const domainOwnershipVerificationReceiptSchema = z.strictObject({
  challenge_id: identifierSchema,
  hostname: z.string().min(1).max(253),
  record_name: z.string().min(1).max(253),
  observed_value: z.string().min(1).max(255),
  verified_at: z.iso.datetime(),
  verifier_reference: z.string().min(1).max(255),
});

export const ingressDesiredRouteSchema = z.strictObject({
  route_id: identifierSchema,
  hostname: z.string().min(1).max(253),
  target: routeTargetSchema,
});

export const ingressDesiredStateSchema = z.strictObject({
  schema_version: z.literal(INGRESS_DESIRED_STATE_SCHEMA_VERSION),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  valid_until: z.iso.datetime(),
  routes: z.array(ingressDesiredRouteSchema).readonly(),
});

export type RouteTarget = z.infer<typeof routeTargetSchema>;
export type ProjectEnvironmentOwnership = z.infer<
  typeof projectEnvironmentOwnershipSchema
>;
export type IssueGeneratedRouteRequest = z.infer<
  typeof issueGeneratedRouteRequestSchema
>;
export type BeginCustomDomainVerificationRequest = z.infer<
  typeof beginCustomDomainVerificationRequestSchema
>;
export type ActivateCustomDomainRequest = z.infer<
  typeof activateCustomDomainRequestSchema
>;
export type RouteMutationRequest = z.infer<typeof routeMutationRequestSchema>;
export type IngressRoute = z.infer<typeof ingressRouteSchema>;
export type CustomDomainChallenge = z.infer<typeof customDomainChallengeSchema>;
export type DomainOwnershipVerificationReceipt = z.infer<
  typeof domainOwnershipVerificationReceiptSchema
>;
export type IngressDesiredRoute = z.infer<typeof ingressDesiredRouteSchema>;
export type IngressDesiredState = z.infer<typeof ingressDesiredStateSchema>;
