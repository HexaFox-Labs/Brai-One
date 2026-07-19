import { createHash, timingSafeEqual } from "node:crypto";
import type { ZodType } from "zod";

import { UserProjectRoutingError } from "./errors.js";
import {
  canonicalizeCustomHostname,
  customDomainVerificationRecord,
  generatedProjectHostname,
} from "./hostname.js";
import type {
  DomainOwnershipVerifier,
  UserProjectRoutingRepository,
} from "./repository.js";
import {
  INGRESS_DESIRED_STATE_SCHEMA_VERSION,
  ROUTING_SCHEMA_VERSION,
  activateCustomDomainRequestSchema,
  beginCustomDomainVerificationRequestSchema,
  customDomainChallengeSchema,
  domainOwnershipVerificationReceiptSchema,
  ingressDesiredStateSchema,
  ingressRouteSchema,
  identifierSchema,
  issueGeneratedRouteRequestSchema,
  projectEnvironmentOwnershipSchema,
  routeMutationRequestSchema,
  type CustomDomainChallenge,
  type IngressDesiredState,
  type IngressRoute,
  type ProjectEnvironmentOwnership,
  type RouteTarget,
} from "./schemas.js";
import {
  assertTrustedAuthenticatedActorContext,
  type TrustedAuthenticatedActorContext,
} from "./trusted-actor-context.js";

const DEFAULT_CHALLENGE_TTL_MS = 30 * 60 * 1_000;
const MAX_CHALLENGE_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_DESIRED_STATE_TTL_MS = 5 * 60 * 1_000;
const MIN_DESIRED_STATE_TTL_MS = 30 * 1_000;
const MAX_DESIRED_STATE_TTL_MS = 15 * 60 * 1_000;
const MAX_CURRENT_OWNERSHIP_RECEIPT_AGE_MS = 60 * 1_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,160}$/u;

export interface UserProjectRoutingServiceDependencies {
  readonly repository: UserProjectRoutingRepository;
  readonly ownershipVerifier: DomainOwnershipVerifier;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly newChallengeToken: () => string;
  readonly challengeTtlMs?: number;
  readonly desiredStateTtlMs?: number;
}

function invalidRequest(message: string): UserProjectRoutingError {
  return new UserProjectRoutingError("invalid_request", message);
}

function parseOrInvalid<T>(
  schema: ZodType<T>,
  value: unknown,
  message: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw invalidRequest(message);
  }
  return parsed.data;
}

function validNow(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new UserProjectRoutingError(
      "repository_invariant_violation",
      "Clock вернул некорректное время",
    );
  }
  return value;
}

function exactStringMatch(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function ownershipReceiptMatches(
  challenge: CustomDomainChallenge,
  rawReceipt: unknown,
  notBeforeMs: number,
  notAfterMs: number,
): boolean {
  const receipt =
    domainOwnershipVerificationReceiptSchema.safeParse(rawReceipt);
  if (!receipt.success) return false;
  const verifiedAt = Date.parse(receipt.data.verified_at);
  return (
    receipt.data.challenge_id === challenge.challenge_id &&
    receipt.data.hostname === challenge.hostname &&
    receipt.data.record_name === challenge.record_name &&
    exactStringMatch(receipt.data.observed_value, challenge.expected_value) &&
    verifiedAt >= notBeforeMs &&
    verifiedAt <= notAfterMs
  );
}

function freezeRoute(route: IngressRoute): IngressRoute {
  return Object.freeze({
    ...route,
    target: Object.freeze({ ...route.target }),
  });
}

function sameImmutableRoute(left: IngressRoute, right: IngressRoute): boolean {
  return (
    left.route_id === right.route_id &&
    left.hostname === right.hostname &&
    left.kind === right.kind &&
    left.owner_user_id === right.owner_user_id &&
    left.project_id === right.project_id &&
    left.target.environment_id === right.target.environment_id &&
    left.target.port === right.target.port &&
    left.verification_challenge_id === right.verification_challenge_id &&
    left.created_at === right.created_at
  );
}

function sameRouteIntent(left: IngressRoute, right: IngressRoute): boolean {
  return (
    left.hostname === right.hostname &&
    left.kind === right.kind &&
    left.owner_user_id === right.owner_user_id &&
    left.project_id === right.project_id &&
    left.target.environment_id === right.target.environment_id &&
    left.target.port === right.target.port &&
    left.verification_challenge_id === right.verification_challenge_id
  );
}

function parseRepositoryRoute(value: unknown): IngressRoute {
  const parsed = ingressRouteSchema.safeParse(value);
  if (!parsed.success) {
    throw new UserProjectRoutingError(
      "repository_invariant_violation",
      "Repository вернул некорректный route",
    );
  }
  try {
    const expectedHostname =
      parsed.data.kind === "generated"
        ? generatedProjectHostname(
            parsed.data.project_id,
            parsed.data.target.environment_id,
            parsed.data.target.port,
          )
        : canonicalizeCustomHostname(parsed.data.hostname);
    if (parsed.data.hostname !== expectedHostname) {
      throw new Error("non-canonical route hostname");
    }
  } catch {
    throw new UserProjectRoutingError(
      "repository_invariant_violation",
      "Repository вернул небезопасный или несогласованный hostname",
    );
  }
  return freezeRoute(parsed.data);
}

function parseRepositoryChallenge(value: unknown): CustomDomainChallenge {
  const parsed = customDomainChallengeSchema.safeParse(value);
  if (!parsed.success) {
    throw new UserProjectRoutingError(
      "repository_invariant_violation",
      "Repository вернул некорректный verification challenge",
    );
  }
  try {
    const hostname = canonicalizeCustomHostname(parsed.data.hostname);
    const valuePrefix = "brai-domain-verification=";
    if (
      hostname !== parsed.data.hostname ||
      parsed.data.record_name !== customDomainVerificationRecord(hostname) ||
      !parsed.data.expected_value.startsWith(valuePrefix) ||
      !TOKEN_PATTERN.test(
        parsed.data.expected_value.slice(valuePrefix.length),
      ) ||
      Date.parse(parsed.data.expires_at) <= Date.parse(parsed.data.created_at)
    ) {
      throw new Error("invalid challenge invariant");
    }
  } catch {
    throw new UserProjectRoutingError(
      "repository_invariant_violation",
      "Repository вернул небезопасный или несогласованный challenge",
    );
  }
  return Object.freeze({
    ...parsed.data,
    target: Object.freeze({ ...parsed.data.target }),
  });
}

export class UserProjectRoutingService {
  readonly #repository: UserProjectRoutingRepository;
  readonly #ownershipVerifier: DomainOwnershipVerifier;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #newChallengeToken: () => string;
  readonly #challengeTtlMs: number;
  readonly #desiredStateTtlMs: number;

  constructor(dependencies: UserProjectRoutingServiceDependencies) {
    this.#repository = dependencies.repository;
    this.#ownershipVerifier = dependencies.ownershipVerifier;
    this.#now = dependencies.now;
    this.#newId = dependencies.newId;
    this.#newChallengeToken = dependencies.newChallengeToken;
    const ttl = dependencies.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS;
    if (
      !Number.isSafeInteger(ttl) ||
      ttl < 1_000 ||
      ttl > MAX_CHALLENGE_TTL_MS
    ) {
      throw invalidRequest("Некорректный TTL domain challenge");
    }
    this.#challengeTtlMs = ttl;
    const desiredStateTtl =
      dependencies.desiredStateTtlMs ?? DEFAULT_DESIRED_STATE_TTL_MS;
    if (
      !Number.isSafeInteger(desiredStateTtl) ||
      desiredStateTtl < MIN_DESIRED_STATE_TTL_MS ||
      desiredStateTtl > MAX_DESIRED_STATE_TTL_MS
    ) {
      throw invalidRequest("Некорректный TTL ingress desired state");
    }
    this.#desiredStateTtlMs = desiredStateTtl;
  }

  async issueGeneratedRoute(
    trustedActorContext: TrustedAuthenticatedActorContext,
    untrustedRequest: unknown,
  ): Promise<IngressRoute> {
    const actor = assertTrustedAuthenticatedActorContext(trustedActorContext);
    const request = parseOrInvalid(
      issueGeneratedRouteRequestSchema,
      untrustedRequest,
      "Некорректный запрос generated route",
    );
    await this.#assertOwnership(
      actor,
      request.project_id,
      request.environment_id,
    );

    const hostname = generatedProjectHostname(
      request.project_id,
      request.environment_id,
      request.port,
    );
    const route = this.#newRoute({
      hostname,
      kind: "generated",
      ownerUserId: actor.authenticated_user_id,
      projectId: request.project_id,
      target: {
        environment_id: request.environment_id,
        port: request.port,
      },
      verificationChallengeId: null,
    });
    const result = await this.#repository.reserveActiveRouteAtomically({
      expected_owner_user_id: actor.authenticated_user_id,
      project_id: request.project_id,
      environment_id: request.environment_id,
      candidate: route,
    });
    if (result.outcome === "created" || result.outcome === "idempotent") {
      const storedRoute = parseRepositoryRoute(result.route);
      if (
        !sameRouteIntent(storedRoute, route) ||
        storedRoute.status !== "active"
      ) {
        throw new UserProjectRoutingError(
          "repository_invariant_violation",
          "Idempotent route reservation вернул другой intent",
        );
      }
      return storedRoute;
    }
    if (result.outcome === "hostname_collision") {
      throw new UserProjectRoutingError(
        "hostname_collision",
        "Generated hostname уже занят другим route",
      );
    }
    if (result.outcome === "access_denied") {
      throw new UserProjectRoutingError(
        "access_denied",
        "Ownership изменился до atomic route reservation",
      );
    }
    throw new UserProjectRoutingError(
      "repository_invariant_violation",
      "Repository вернул неизвестный результат route reservation",
    );
  }

  async beginCustomDomainVerification(
    trustedActorContext: TrustedAuthenticatedActorContext,
    untrustedRequest: unknown,
  ): Promise<CustomDomainChallenge> {
    const actor = assertTrustedAuthenticatedActorContext(trustedActorContext);
    const request = parseOrInvalid(
      beginCustomDomainVerificationRequestSchema,
      untrustedRequest,
      "Некорректный запрос custom domain",
    );
    await this.#assertOwnership(
      actor,
      request.project_id,
      request.environment_id,
    );

    const hostname = canonicalizeCustomHostname(request.hostname);
    const now = validNow(this.#now);
    const challengeId = this.#validGeneratedId(this.#newId());
    const token = this.#newChallengeToken();
    if (!TOKEN_PATTERN.test(token)) {
      throw new UserProjectRoutingError(
        "repository_invariant_violation",
        "Challenge token generator вернул небезопасное значение",
      );
    }

    const candidate = parseRepositoryChallenge({
      schema_version: ROUTING_SCHEMA_VERSION,
      challenge_id: challengeId,
      owner_user_id: actor.authenticated_user_id,
      project_id: request.project_id,
      target: {
        environment_id: request.environment_id,
        port: request.port,
      },
      hostname,
      record_name: customDomainVerificationRecord(hostname),
      expected_value: `brai-domain-verification=${token}`,
      status: "pending",
      activated_route_id: null,
      revision: 1,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + this.#challengeTtlMs).toISOString(),
    });
    const result = await this.#repository.createOrGetChallengeAtomically({
      expected_owner_user_id: actor.authenticated_user_id,
      project_id: request.project_id,
      environment_id: request.environment_id,
      candidate,
    });
    if (result.outcome === "hostname_collision") {
      throw new UserProjectRoutingError(
        "hostname_collision",
        "Hostname уже зарезервирован другим route или challenge",
      );
    }
    if (result.outcome === "access_denied") {
      throw new UserProjectRoutingError(
        "access_denied",
        "Ownership изменился до atomic challenge reservation",
      );
    }
    if (result.outcome !== "created" && result.outcome !== "idempotent") {
      throw new UserProjectRoutingError(
        "repository_invariant_violation",
        "Repository вернул неизвестный результат challenge reservation",
      );
    }
    const storedChallenge = parseRepositoryChallenge(result.challenge);
    if (
      storedChallenge.hostname !== candidate.hostname ||
      storedChallenge.owner_user_id !== candidate.owner_user_id ||
      storedChallenge.project_id !== candidate.project_id ||
      storedChallenge.target.environment_id !==
        candidate.target.environment_id ||
      storedChallenge.target.port !== candidate.target.port ||
      storedChallenge.status !== "pending" ||
      Date.parse(storedChallenge.expires_at) <= now.getTime()
    ) {
      throw new UserProjectRoutingError(
        "repository_invariant_violation",
        "Idempotent challenge reservation вернул другой intent",
      );
    }
    return storedChallenge;
  }

  async activateCustomDomain(
    trustedActorContext: TrustedAuthenticatedActorContext,
    untrustedRequest: unknown,
  ): Promise<IngressRoute> {
    const actor = assertTrustedAuthenticatedActorContext(trustedActorContext);
    const request = parseOrInvalid(
      activateCustomDomainRequestSchema,
      untrustedRequest,
      "Некорректный запрос активации custom domain",
    );
    const stored = await this.#repository.findChallengeById(
      request.challenge_id,
    );
    if (stored === null) {
      throw new UserProjectRoutingError(
        "challenge_not_found",
        "Domain challenge не найден",
      );
    }
    const challenge = parseRepositoryChallenge(stored);
    if (challenge.owner_user_id !== actor.authenticated_user_id) {
      throw new UserProjectRoutingError(
        "access_denied",
        "Domain challenge принадлежит другому пользователю",
      );
    }
    await this.#assertOwnership(
      actor,
      challenge.project_id,
      challenge.target.environment_id,
    );

    if (challenge.status === "activated") {
      if (challenge.activated_route_id === null) {
        throw new UserProjectRoutingError(
          "repository_invariant_violation",
          "Activated challenge не содержит route id",
        );
      }
      const activeRoute = await this.#repository.findRouteById(
        challenge.activated_route_id,
      );
      if (activeRoute === null) {
        throw new UserProjectRoutingError(
          "repository_invariant_violation",
          "Activated challenge ссылается на отсутствующий route",
        );
      }
      const parsedRoute = parseRepositoryRoute(activeRoute);
      if (
        parsedRoute.kind !== "custom" ||
        parsedRoute.owner_user_id !== challenge.owner_user_id ||
        parsedRoute.hostname !== challenge.hostname ||
        parsedRoute.project_id !== challenge.project_id ||
        parsedRoute.target.environment_id !== challenge.target.environment_id ||
        parsedRoute.target.port !== challenge.target.port ||
        parsedRoute.verification_challenge_id !== challenge.challenge_id
      ) {
        throw new UserProjectRoutingError(
          "repository_invariant_violation",
          "Activated challenge ссылается на другой route intent",
        );
      }
      if (parsedRoute.status !== "active") {
        throw new UserProjectRoutingError(
          "route_not_found",
          "Verified route больше не активен и не будет восстановлен",
        );
      }
      return parsedRoute;
    }
    if (challenge.status !== "pending") {
      throw new UserProjectRoutingError(
        "challenge_not_found",
        "Domain challenge больше не действует",
      );
    }

    const now = validNow(this.#now);
    if (Date.parse(challenge.expires_at) <= now.getTime()) {
      throw new UserProjectRoutingError(
        "challenge_expired",
        "Domain challenge истёк",
      );
    }

    const rawReceipt = await this.#ownershipVerifier.verify(challenge);
    if (
      !ownershipReceiptMatches(
        challenge,
        rawReceipt,
        Date.parse(challenge.created_at),
        Math.min(now.getTime(), Date.parse(challenge.expires_at) - 1),
      )
    ) {
      throw new UserProjectRoutingError(
        "ownership_verification_failed",
        "Verification receipt не совпадает с exact challenge",
      );
    }

    const route = this.#newRoute({
      hostname: challenge.hostname,
      kind: "custom",
      ownerUserId: actor.authenticated_user_id,
      projectId: challenge.project_id,
      target: challenge.target,
      verificationChallengeId: challenge.challenge_id,
    });
    const result = await this.#repository.activateChallengeAtomically({
      expected_owner_user_id: actor.authenticated_user_id,
      project_id: challenge.project_id,
      environment_id: challenge.target.environment_id,
      challenge_id: challenge.challenge_id,
      expected_challenge_revision: challenge.revision,
      route,
    });
    if (result.outcome === "activated" || result.outcome === "idempotent") {
      const storedRoute = parseRepositoryRoute(result.route);
      if (
        !sameRouteIntent(storedRoute, route) ||
        storedRoute.status !== "active"
      ) {
        throw new UserProjectRoutingError(
          "repository_invariant_violation",
          "Challenge activation вернул другой route intent",
        );
      }
      return storedRoute;
    }
    if (result.outcome === "hostname_collision") {
      throw new UserProjectRoutingError(
        "hostname_collision",
        "Hostname был занят до завершения verification",
      );
    }
    if (result.outcome === "access_denied") {
      throw new UserProjectRoutingError(
        "access_denied",
        "Ownership изменился до atomic domain activation",
      );
    }
    if (result.outcome === "challenge_not_found") {
      throw new UserProjectRoutingError(
        "challenge_not_found",
        "Domain challenge больше не существует",
      );
    }
    if (result.outcome === "stale") {
      throw new UserProjectRoutingError(
        "concurrency_conflict",
        "Domain challenge изменился параллельно",
      );
    }
    throw new UserProjectRoutingError(
      "repository_invariant_violation",
      "Repository вернул неизвестный результат challenge activation",
    );
  }

  async revokeRoute(
    trustedActorContext: TrustedAuthenticatedActorContext,
    untrustedRequest: unknown,
  ): Promise<IngressRoute> {
    return this.#setRouteStatus(
      trustedActorContext,
      untrustedRequest,
      "revoked",
    );
  }

  async deleteRoute(
    trustedActorContext: TrustedAuthenticatedActorContext,
    untrustedRequest: unknown,
  ): Promise<IngressRoute> {
    return this.#setRouteStatus(
      trustedActorContext,
      untrustedRequest,
      "deleted",
    );
  }

  /**
   * Narrow, credential-free seam for a later ingress controller. The output
   * can only name a route and its abstract environment + internal port.
   */
  async buildDesiredState(): Promise<IngressDesiredState> {
    const now = validNow(this.#now);
    const activeRoutes = (
      await this.#repository.listActiveRoutesWithCurrentOwnership()
    ).map(parseRepositoryRoute);
    const currentlyOwnedRoutes: IngressRoute[] = [];
    let earliestCustomProofExpiryMs = Number.POSITIVE_INFINITY;
    for (const route of activeRoutes) {
      if (route.status !== "active") continue;
      if (route.kind === "custom") {
        const proofValidUntil = await this.#currentCustomDomainProofExpiry(
          route,
          now,
        );
        if (proofValidUntil === null) continue;
        earliestCustomProofExpiryMs = Math.min(
          earliestCustomProofExpiryMs,
          proofValidUntil,
        );
      }
      currentlyOwnedRoutes.push(route);
    }
    const routes = currentlyOwnedRoutes
      .sort((left, right) => left.hostname.localeCompare(right.hostname, "en"))
      .map((route) =>
        Object.freeze({
          route_id: route.route_id,
          hostname: route.hostname,
          target: Object.freeze({ ...route.target }),
        }),
      );
    const uniqueHostnames = new Set(routes.map((route) => route.hostname));
    if (uniqueHostnames.size !== routes.length) {
      throw new UserProjectRoutingError(
        "repository_invariant_violation",
        "Repository вернул несколько active routes для одного hostname",
      );
    }
    const validUntil = new Date(
      Math.min(
        now.getTime() + this.#desiredStateTtlMs,
        earliestCustomProofExpiryMs,
      ),
    ).toISOString();
    const serialized = JSON.stringify({ routes, valid_until: validUntil });
    const digest = `sha256:${createHash("sha256")
      .update(serialized)
      .digest("hex")}`;
    const parsed = ingressDesiredStateSchema.parse({
      schema_version: INGRESS_DESIRED_STATE_SCHEMA_VERSION,
      digest,
      valid_until: validUntil,
      routes,
    });
    return Object.freeze({
      ...parsed,
      routes: Object.freeze([...parsed.routes]),
    });
  }

  async #currentCustomDomainProofExpiry(
    route: IngressRoute,
    now: Date,
  ): Promise<number | null> {
    const challengeId = route.verification_challenge_id;
    if (challengeId === null) {
      throw new UserProjectRoutingError(
        "repository_invariant_violation",
        "Custom route не содержит verification challenge",
      );
    }
    const stored = await this.#repository.findChallengeById(challengeId);
    if (stored === null) {
      throw new UserProjectRoutingError(
        "repository_invariant_violation",
        "Custom route ссылается на отсутствующий challenge",
      );
    }
    const challenge = parseRepositoryChallenge(stored);
    if (
      challenge.status !== "activated" ||
      challenge.activated_route_id !== route.route_id ||
      challenge.owner_user_id !== route.owner_user_id ||
      challenge.project_id !== route.project_id ||
      challenge.hostname !== route.hostname ||
      challenge.target.environment_id !== route.target.environment_id ||
      challenge.target.port !== route.target.port
    ) {
      throw new UserProjectRoutingError(
        "repository_invariant_violation",
        "Custom route и activated challenge не совпадают",
      );
    }

    const proofValidUntil = Date.parse(challenge.expires_at);
    if (proofValidUntil <= now.getTime()) return null;

    try {
      return ownershipReceiptMatches(
        challenge,
        await this.#ownershipVerifier.verify(challenge),
        now.getTime() - MAX_CURRENT_OWNERSHIP_RECEIPT_AGE_MS,
        now.getTime(),
      )
        ? proofValidUntil
        : null;
    } catch {
      return null;
    }
  }

  async #setRouteStatus(
    trustedActorContext: TrustedAuthenticatedActorContext,
    untrustedRequest: unknown,
    status: "revoked" | "deleted",
  ): Promise<IngressRoute> {
    const actor = assertTrustedAuthenticatedActorContext(trustedActorContext);
    const request = parseOrInvalid(
      routeMutationRequestSchema,
      untrustedRequest,
      "Некорректный запрос изменения route",
    );
    const stored = await this.#repository.findRouteById(request.route_id);
    if (stored === null) {
      throw new UserProjectRoutingError("route_not_found", "Route не найден");
    }
    const route = parseRepositoryRoute(stored);
    await this.#assertOwnership(
      actor,
      route.project_id,
      route.target.environment_id,
    );

    const result = await this.#repository.setRouteStatusAtomically({
      expected_owner_user_id: actor.authenticated_user_id,
      project_id: route.project_id,
      environment_id: route.target.environment_id,
      route_id: route.route_id,
      expected_revision: route.revision,
      status,
      updated_at: validNow(this.#now).toISOString(),
    });
    if (result.outcome === "updated" || result.outcome === "idempotent") {
      const storedRoute = parseRepositoryRoute(result.route);
      if (
        !sameImmutableRoute(storedRoute, route) ||
        (storedRoute.status !== status && storedRoute.status !== "deleted")
      ) {
        throw new UserProjectRoutingError(
          "repository_invariant_violation",
          "Route mutation вернул несогласованный route",
        );
      }
      return storedRoute;
    }
    if (result.outcome === "route_not_found") {
      throw new UserProjectRoutingError("route_not_found", "Route не найден");
    }
    if (result.outcome === "access_denied") {
      throw new UserProjectRoutingError(
        "access_denied",
        "Ownership изменился до atomic route mutation",
      );
    }
    if (result.outcome === "stale") {
      throw new UserProjectRoutingError(
        "concurrency_conflict",
        "Route изменился параллельно",
      );
    }
    throw new UserProjectRoutingError(
      "repository_invariant_violation",
      "Repository вернул неизвестный результат route mutation",
    );
  }

  async #assertOwnership(
    actor: TrustedAuthenticatedActorContext,
    projectId: string,
    environmentId: string,
  ): Promise<ProjectEnvironmentOwnership> {
    const stored = await this.#repository.findProjectEnvironment(
      projectId,
      environmentId,
    );
    if (stored === null) {
      throw new UserProjectRoutingError(
        "access_denied",
        "Project environment недоступен",
      );
    }
    const parsed = projectEnvironmentOwnershipSchema.safeParse(stored);
    if (
      !parsed.success ||
      parsed.data.project_id !== projectId ||
      parsed.data.environment_id !== environmentId
    ) {
      throw new UserProjectRoutingError(
        "repository_invariant_violation",
        "Repository вернул несогласованную ownership relation",
      );
    }
    if (parsed.data.owner_user_id !== actor.authenticated_user_id) {
      throw new UserProjectRoutingError(
        "access_denied",
        "Project environment принадлежит другому пользователю",
      );
    }
    return parsed.data;
  }

  #newRoute(
    input: Readonly<{
      hostname: string;
      kind: "generated" | "custom";
      ownerUserId: string;
      projectId: string;
      target: RouteTarget;
      verificationChallengeId: string | null;
    }>,
  ): IngressRoute {
    const now = validNow(this.#now).toISOString();
    return parseRepositoryRoute({
      schema_version: ROUTING_SCHEMA_VERSION,
      route_id: this.#validGeneratedId(this.#newId()),
      hostname: input.hostname,
      kind: input.kind,
      owner_user_id: input.ownerUserId,
      project_id: input.projectId,
      target: input.target,
      verification_challenge_id: input.verificationChallengeId,
      status: "active",
      revision: 1,
      created_at: now,
      updated_at: now,
    });
  }

  #validGeneratedId(value: string): string {
    const parsed = identifierSchema.safeParse(value);
    if (!parsed.success) {
      throw new UserProjectRoutingError(
        "repository_invariant_violation",
        "ID generator вернул некорректный UUID",
      );
    }
    return parsed.data;
  }
}
