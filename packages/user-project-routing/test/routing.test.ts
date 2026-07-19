import { describe, expect, it } from "vitest";

import {
  ROUTING_SCHEMA_VERSION,
  UserProjectRoutingError,
  UserProjectRoutingService,
  generatedProjectHostname,
  type ActivateChallengeResult,
  type AtomicOwnershipExpectation,
  type CreateChallengeResult,
  type CustomDomainChallenge,
  type DomainOwnershipVerifier,
  type IngressRoute,
  type ProjectEnvironmentOwnership,
  type ReserveRouteResult,
  type SetRouteStatusResult,
  type UserProjectRoutingRepository,
} from "../src/index.js";
import { createTrustedAuthenticatedActorContext } from "../src/trusted-adapter.js";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const ENVIRONMENT_ID = "55555555-5555-4555-8555-555555555555";
const ROUTE_ONE_ID = "66666666-6666-4666-8666-666666666666";
const ROUTE_TWO_ID = "77777777-7777-4777-8777-777777777777";
const CHALLENGE_ID = "88888888-8888-4888-8888-888888888888";
const NOW = "2026-07-17T12:00:00.000Z";
const DESIRED_STATE_VALID_UNTIL = "2026-07-17T12:05:00.000Z";
const TOKEN = "abcdefghijklmnopqrstuvwxyz_ABCDEFG-1234567890";

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

function sameChallengeIntent(
  left: CustomDomainChallenge,
  right: CustomDomainChallenge,
): boolean {
  return (
    left.hostname === right.hostname &&
    left.owner_user_id === right.owner_user_id &&
    left.project_id === right.project_id &&
    left.target.environment_id === right.target.environment_id &&
    left.target.port === right.target.port
  );
}

class MemoryRoutingRepository implements UserProjectRoutingRepository {
  readonly ownership = new Map<string, ProjectEnvironmentOwnership>();
  readonly routes = new Map<string, IngressRoute>();
  readonly challenges = new Map<string, CustomDomainChallenge>();
  beforeNextAtomic: (() => void) | undefined;

  ownershipKey(projectId: string, environmentId: string): string {
    return `${projectId}:${environmentId}`;
  }

  addOwnership(ownership: ProjectEnvironmentOwnership): void {
    this.ownership.set(
      this.ownershipKey(ownership.project_id, ownership.environment_id),
      ownership,
    );
  }

  removeOwnership(projectId: string, environmentId: string): void {
    this.ownership.delete(this.ownershipKey(projectId, environmentId));
  }

  runBeforeAtomic(): void {
    const hook = this.beforeNextAtomic;
    this.beforeNextAtomic = undefined;
    hook?.();
  }

  hasExpectedOwnership(expectation: AtomicOwnershipExpectation): boolean {
    const ownership = this.ownership.get(
      this.ownershipKey(expectation.project_id, expectation.environment_id),
    );
    return ownership?.owner_user_id === expectation.expected_owner_user_id;
  }

  hasCurrentRecordOwnership(
    record: Readonly<{
      owner_user_id: string;
      project_id: string;
      target: Readonly<{ environment_id: string }>;
    }>,
  ): boolean {
    return this.hasExpectedOwnership({
      expected_owner_user_id: record.owner_user_id,
      project_id: record.project_id,
      environment_id: record.target.environment_id,
    });
  }

  reclaimStaleHostnameReservations(
    hostname: string,
    now: string,
    preservedChallengeId?: string,
  ): void {
    const nowMs = Date.parse(now);
    for (const [routeId, route] of this.routes) {
      if (route.hostname !== hostname || route.status === "deleted") continue;
      const challenge =
        route.verification_challenge_id === null
          ? null
          : (this.challenges.get(route.verification_challenge_id) ?? null);
      const customProofCurrent =
        route.kind === "generated" ||
        (challenge !== null &&
          challenge.status === "activated" &&
          challenge.activated_route_id === route.route_id &&
          Date.parse(challenge.expires_at) > nowMs);
      if (this.hasCurrentRecordOwnership(route) && customProofCurrent) continue;
      this.routes.set(routeId, {
        ...route,
        status: "deleted",
        revision: route.revision + 1,
        updated_at: now,
      });
    }

    for (const [challengeId, challenge] of this.challenges) {
      if (
        challengeId === preservedChallengeId ||
        challenge.hostname !== hostname ||
        challenge.status !== "pending"
      ) {
        continue;
      }
      if (
        this.hasCurrentRecordOwnership(challenge) &&
        Date.parse(challenge.expires_at) > nowMs
      ) {
        continue;
      }
      this.challenges.set(challengeId, {
        ...challenge,
        status: "cancelled",
        revision: challenge.revision + 1,
      });
    }
  }

  async findProjectEnvironment(
    projectId: string,
    environmentId: string,
  ): Promise<ProjectEnvironmentOwnership | null> {
    return (
      this.ownership.get(this.ownershipKey(projectId, environmentId)) ?? null
    );
  }

  async findRouteById(routeId: string): Promise<IngressRoute | null> {
    return this.routes.get(routeId) ?? null;
  }

  async findChallengeById(
    challengeId: string,
  ): Promise<CustomDomainChallenge | null> {
    return this.challenges.get(challengeId) ?? null;
  }

  async reserveActiveRouteAtomically(
    command: AtomicOwnershipExpectation &
      Readonly<{
        candidate: IngressRoute;
      }>,
  ): Promise<ReserveRouteResult> {
    this.runBeforeAtomic();
    if (!this.hasExpectedOwnership(command)) {
      return { outcome: "access_denied" };
    }
    const { candidate } = command;
    if (
      candidate.owner_user_id !== command.expected_owner_user_id ||
      candidate.project_id !== command.project_id ||
      candidate.target.environment_id !== command.environment_id
    ) {
      return { outcome: "access_denied" };
    }
    this.reclaimStaleHostnameReservations(
      candidate.hostname,
      candidate.created_at,
    );
    const existing = [...this.routes.values()].find(
      (route) =>
        route.hostname === candidate.hostname && route.status !== "deleted",
    );
    if (existing !== undefined) {
      return sameRouteIntent(existing, candidate)
        ? { outcome: "idempotent", route: existing }
        : { outcome: "hostname_collision" };
    }
    const pending = [...this.challenges.values()].some(
      (challenge) =>
        challenge.hostname === candidate.hostname &&
        challenge.status === "pending" &&
        Date.parse(challenge.expires_at) > Date.parse(candidate.created_at),
    );
    if (pending) {
      return { outcome: "hostname_collision" };
    }
    this.routes.set(candidate.route_id, candidate);
    return { outcome: "created", route: candidate };
  }

  async createOrGetChallengeAtomically(
    command: AtomicOwnershipExpectation &
      Readonly<{
        candidate: CustomDomainChallenge;
      }>,
  ): Promise<CreateChallengeResult> {
    this.runBeforeAtomic();
    if (!this.hasExpectedOwnership(command)) {
      return { outcome: "access_denied" };
    }
    const { candidate } = command;
    if (
      candidate.owner_user_id !== command.expected_owner_user_id ||
      candidate.project_id !== command.project_id ||
      candidate.target.environment_id !== command.environment_id
    ) {
      return { outcome: "access_denied" };
    }
    this.reclaimStaleHostnameReservations(
      candidate.hostname,
      candidate.created_at,
    );
    const routeCollision = [...this.routes.values()].some(
      (route) =>
        route.hostname === candidate.hostname && route.status !== "deleted",
    );
    if (routeCollision) {
      return { outcome: "hostname_collision" };
    }
    const existing = [...this.challenges.values()].find(
      (challenge) =>
        challenge.hostname === candidate.hostname &&
        challenge.status === "pending" &&
        Date.parse(challenge.expires_at) > Date.parse(candidate.created_at),
    );
    if (existing !== undefined) {
      return sameChallengeIntent(existing, candidate)
        ? { outcome: "idempotent", challenge: existing }
        : { outcome: "hostname_collision" };
    }
    this.challenges.set(candidate.challenge_id, candidate);
    return { outcome: "created", challenge: candidate };
  }

  async activateChallengeAtomically(
    command: AtomicOwnershipExpectation &
      Readonly<{
        challenge_id: string;
        expected_challenge_revision: number;
        route: IngressRoute;
      }>,
  ): Promise<ActivateChallengeResult> {
    this.runBeforeAtomic();
    if (!this.hasExpectedOwnership(command)) {
      return { outcome: "access_denied" };
    }
    const challenge = this.challenges.get(command.challenge_id);
    if (challenge === undefined) {
      return { outcome: "challenge_not_found" };
    }
    if (
      challenge.owner_user_id !== command.expected_owner_user_id ||
      challenge.project_id !== command.project_id ||
      challenge.target.environment_id !== command.environment_id ||
      command.route.owner_user_id !== command.expected_owner_user_id ||
      command.route.project_id !== command.project_id ||
      command.route.target.environment_id !== command.environment_id
    ) {
      return { outcome: "access_denied" };
    }
    if (challenge.status === "activated") {
      const existing =
        challenge.activated_route_id === null
          ? undefined
          : this.routes.get(challenge.activated_route_id);
      return existing !== undefined && sameRouteIntent(existing, command.route)
        ? { outcome: "idempotent", route: existing }
        : { outcome: "stale" };
    }
    if (
      challenge.status !== "pending" ||
      challenge.revision !== command.expected_challenge_revision ||
      Date.parse(challenge.expires_at) <= Date.parse(command.route.created_at)
    ) {
      return { outcome: "stale" };
    }
    this.reclaimStaleHostnameReservations(
      command.route.hostname,
      command.route.created_at,
      challenge.challenge_id,
    );
    const routeCollision = [...this.routes.values()].some(
      (route) =>
        route.hostname === command.route.hostname && route.status !== "deleted",
    );
    if (routeCollision) {
      return { outcome: "hostname_collision" };
    }
    this.routes.set(command.route.route_id, command.route);
    this.challenges.set(challenge.challenge_id, {
      ...challenge,
      status: "activated",
      activated_route_id: command.route.route_id,
      revision: challenge.revision + 1,
    });
    return { outcome: "activated", route: command.route };
  }

  async setRouteStatusAtomically(
    command: AtomicOwnershipExpectation &
      Readonly<{
        route_id: string;
        expected_revision: number;
        status: "revoked" | "deleted";
        updated_at: string;
      }>,
  ): Promise<SetRouteStatusResult> {
    this.runBeforeAtomic();
    if (!this.hasExpectedOwnership(command)) {
      return { outcome: "access_denied" };
    }
    const route = this.routes.get(command.route_id);
    if (route === undefined) {
      return { outcome: "route_not_found" };
    }
    if (
      route.project_id !== command.project_id ||
      route.target.environment_id !== command.environment_id
    ) {
      return { outcome: "access_denied" };
    }
    if (route.status === command.status || route.status === "deleted") {
      return { outcome: "idempotent", route };
    }
    if (route.revision !== command.expected_revision) {
      return { outcome: "stale" };
    }
    const updated: IngressRoute = {
      ...route,
      status: command.status,
      revision: route.revision + 1,
      updated_at: command.updated_at,
    };
    this.routes.set(route.route_id, updated);
    return { outcome: "updated", route: updated };
  }

  async listActiveRoutesWithCurrentOwnership(): Promise<
    readonly IngressRoute[]
  > {
    return [...this.routes.values()].filter((route) => {
      const ownership = this.ownership.get(
        this.ownershipKey(route.project_id, route.target.environment_id),
      );
      return (
        route.status === "active" &&
        ownership?.owner_user_id === route.owner_user_id
      );
    });
  }
}

function exactVerifier(): DomainOwnershipVerifier {
  return {
    verify: (challenge) =>
      Promise.resolve({
        challenge_id: challenge.challenge_id,
        hostname: challenge.hostname,
        record_name: challenge.record_name,
        observed_value: challenge.expected_value,
        verified_at: NOW,
        verifier_reference: "dns-query:test",
      }),
  };
}

function harness(
  options: Readonly<{
    verifier?: DomainOwnershipVerifier;
    ids?: readonly string[];
    now?: () => Date;
    challengeTtlMs?: number;
  }> = {},
): Readonly<{
  repository: MemoryRoutingRepository;
  service: UserProjectRoutingService;
}> {
  const repository = new MemoryRoutingRepository();
  repository.addOwnership({
    project_id: PROJECT_ID,
    environment_id: ENVIRONMENT_ID,
    owner_user_id: OWNER_ID,
  });
  const ids = [...(options.ids ?? [ROUTE_ONE_ID, ROUTE_TWO_ID, CHALLENGE_ID])];
  let index = 0;
  const service = new UserProjectRoutingService({
    repository,
    ownershipVerifier: options.verifier ?? exactVerifier(),
    now: options.now ?? (() => new Date(NOW)),
    newId: () => ids[index++] ?? ROUTE_TWO_ID,
    newChallengeToken: () => TOKEN,
    ...(options.challengeTtlMs === undefined
      ? {}
      : { challengeTtlMs: options.challengeTtlMs }),
  });
  return { repository, service };
}

const owner = createTrustedAuthenticatedActorContext(OWNER_ID);
const otherUser = createTrustedAuthenticatedActorContext(OTHER_USER_ID);
const generatedRequest = Object.freeze({
  project_id: PROJECT_ID,
  environment_id: ENVIRONMENT_ID,
  port: 3_000,
});

async function expectRoutingError(
  action: Promise<unknown>,
  code: UserProjectRoutingError["code"],
): Promise<UserProjectRoutingError> {
  let caught: unknown;
  try {
    await action;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(UserProjectRoutingError);
  const routingError = caught as UserProjectRoutingError;
  expect(routingError.code).toBe(code);
  return routingError;
}

describe("deterministic user-project routing", () => {
  it("issues only a platform-generated hostname after server-side ownership", async () => {
    const { service } = harness();
    const route = await service.issueGeneratedRoute(owner, generatedRequest);

    expect(route).toMatchObject({
      schema_version: ROUTING_SCHEMA_VERSION,
      hostname: generatedProjectHostname(PROJECT_ID, ENVIRONMENT_ID, 3_000),
      kind: "generated",
      owner_user_id: OWNER_ID,
      project_id: PROJECT_ID,
      target: { environment_id: ENVIRONMENT_ID, port: 3_000 },
      verification_challenge_id: null,
      status: "active",
    });
    expect(route.hostname.endsWith(".brightos.world")).toBe(true);
  });

  it("denies cross-user routing from the stored ownership relation", async () => {
    const { service } = harness();
    await expectRoutingError(
      service.issueGeneratedRoute(otherUser, generatedRequest),
      "access_denied",
    );
  });

  it("rejects plain JSON, JSON round-trips, and copied symbol brands", async () => {
    const { service } = harness();
    const plainJson = { authenticated_user_id: OWNER_ID };
    const roundTripped = JSON.parse(JSON.stringify(owner)) as unknown;
    const brand = Object.getOwnPropertySymbols(owner)[0];
    expect(brand).toBeDefined();
    if (brand === undefined) {
      throw new Error("Trusted context brand is missing");
    }
    const copiedBrand = Object.freeze({
      authenticated_user_id: OWNER_ID,
      [brand]: true,
    });

    for (const forgedContext of [plainJson, roundTripped, copiedBrand]) {
      await expectRoutingError(
        service.issueGeneratedRoute(forgedContext as never, generatedRequest),
        "access_denied",
      );
    }
  });

  it("rejects forged owner/profile and every arbitrary upstream field", async () => {
    const { service } = harness();
    for (const forged of [
      { actor: OWNER_ID },
      { actor_id: OWNER_ID },
      { authenticated_user_id: OWNER_ID },
      { owner_user_id: OWNER_ID },
      { context: { authenticated_user_id: OWNER_ID } },
      { trustedActorContext: { authenticated_user_id: OWNER_ID } },
      { profile: "developer" },
      { upstream_host: "127.0.0.1" },
      { upstream_ip: "10.0.0.2" },
      { host_path: "/var/run/docker.sock" },
      { socket: "/run/user/1000/docker.sock" },
      { caddy_credentials: "forged" },
    ]) {
      await expectRoutingError(
        service.issueGeneratedRoute(owner, {
          ...generatedRequest,
          ...forged,
        }),
        "invalid_request",
      );
    }
  });

  it("keeps every command payload strict at the actor/owner/context boundary", async () => {
    const { service } = harness();
    await expectRoutingError(
      service.beginCustomDomainVerification(owner, {
        ...generatedRequest,
        hostname: "app.example.com",
        owner_user_id: OWNER_ID,
      }),
      "invalid_request",
    );
    await expectRoutingError(
      service.activateCustomDomain(owner, {
        challenge_id: CHALLENGE_ID,
        actor: OWNER_ID,
      }),
      "invalid_request",
    );
    await expectRoutingError(
      service.revokeRoute(owner, {
        route_id: ROUTE_ONE_ID,
        context: { authenticated_user_id: OWNER_ID },
      }),
      "invalid_request",
    );
  });

  it("rechecks ownership inside atomic generated-route reservation", async () => {
    const { repository, service } = harness();
    repository.beforeNextAtomic = () => {
      repository.removeOwnership(PROJECT_ID, ENVIRONMENT_ID);
    };

    await expectRoutingError(
      service.issueGeneratedRoute(owner, generatedRequest),
      "access_denied",
    );
    expect(repository.routes.size).toBe(0);
  });

  it("accepts only internal ports 1024..65535", async () => {
    for (const port of [0, 80, 1_023, 65_536, 3_000.5, "3000"] as const) {
      const { service } = harness();
      await expectRoutingError(
        service.issueGeneratedRoute(owner, { ...generatedRequest, port }),
        "invalid_request",
      );
    }
    for (const port of [1_024, 65_535]) {
      const { service } = harness();
      await expect(
        service.issueGeneratedRoute(owner, { ...generatedRequest, port }),
      ).resolves.toMatchObject({ target: { port } });
    }
  });

  it("makes concurrent generated-route retries exactly idempotent", async () => {
    const { service } = harness({ ids: [ROUTE_ONE_ID, ROUTE_TWO_ID] });
    const [first, second] = await Promise.all([
      service.issueGeneratedRoute(owner, generatedRequest),
      service.issueGeneratedRoute(owner, generatedRequest),
    ]);

    expect(first.route_id).toBe(ROUTE_ONE_ID);
    expect(second).toEqual(first);
  });

  it("fails closed on an atomic hostname collision", async () => {
    const { repository, service } = harness();
    const hostname = generatedProjectHostname(
      PROJECT_ID,
      ENVIRONMENT_ID,
      3_000,
    );
    repository.addOwnership({
      project_id: OTHER_PROJECT_ID,
      environment_id: ENVIRONMENT_ID,
      owner_user_id: OTHER_USER_ID,
    });
    repository.routes.set(ROUTE_TWO_ID, {
      schema_version: ROUTING_SCHEMA_VERSION,
      route_id: ROUTE_TWO_ID,
      hostname,
      kind: "generated",
      owner_user_id: OTHER_USER_ID,
      project_id: OTHER_PROJECT_ID,
      target: { environment_id: ENVIRONMENT_ID, port: 4_000 },
      verification_challenge_id: null,
      status: "active",
      revision: 1,
      created_at: NOW,
      updated_at: NOW,
    });

    await expectRoutingError(
      service.issueGeneratedRoute(owner, generatedRequest),
      "hostname_collision",
    );
  });

  it.each([
    "*.example.com",
    "127.0.0.1",
    "[::1]",
    "localhost",
    "app.localhost",
    "project.internal",
    "single-label",
    "-bad.example.com",
  ])("rejects invalid custom hostname %s", async (hostname) => {
    const { service } = harness({ ids: [CHALLENGE_ID] });
    await expectRoutingError(
      service.beginCustomDomainVerification(owner, {
        ...generatedRequest,
        hostname,
      }),
      "domain_invalid",
    );
  });

  it.each([
    "brightos.world",
    "admin.brightos.world",
    "hex.brightos.world",
    "anything.brightos.world",
  ])("reserves platform and technical hostname %s", async (hostname) => {
    const { service } = harness({ ids: [CHALLENGE_ID] });
    await expectRoutingError(
      service.beginCustomDomainVerification(owner, {
        ...generatedRequest,
        hostname,
      }),
      "domain_reserved",
    );
  });

  it("activates a canonical custom domain only after an exact trusted receipt", async () => {
    const { service } = harness({ ids: [CHALLENGE_ID, ROUTE_ONE_ID] });
    const challenge = await service.beginCustomDomainVerification(owner, {
      ...generatedRequest,
      hostname: "App.Example.COM",
    });
    expect(challenge).toMatchObject({
      hostname: "app.example.com",
      record_name: "_brai-domain-verification.app.example.com",
      expected_value: `brai-domain-verification=${TOKEN}`,
      status: "pending",
    });

    const route = await service.activateCustomDomain(owner, {
      challenge_id: challenge.challenge_id,
    });
    expect(route).toMatchObject({
      route_id: ROUTE_ONE_ID,
      hostname: "app.example.com",
      kind: "custom",
      verification_challenge_id: CHALLENGE_ID,
      target: { environment_id: ENVIRONMENT_ID, port: 3_000 },
    });
  });

  it("rejects a forged or mismatched ownership receipt", async () => {
    const verifier: DomainOwnershipVerifier = {
      verify: (challenge) =>
        Promise.resolve({
          challenge_id: challenge.challenge_id,
          hostname: challenge.hostname,
          record_name: challenge.record_name,
          observed_value: `${challenge.expected_value}-forged`,
          verified_at: NOW,
          verifier_reference: "dns-query:test",
        }),
    };
    const { repository, service } = harness({
      verifier,
      ids: [CHALLENGE_ID, ROUTE_ONE_ID],
    });
    const challenge = await service.beginCustomDomainVerification(owner, {
      ...generatedRequest,
      hostname: "app.example.com",
    });

    await expectRoutingError(
      service.activateCustomDomain(owner, {
        challenge_id: challenge.challenge_id,
      }),
      "ownership_verification_failed",
    );
    expect(repository.routes.size).toBe(0);
  });

  it("rechecks ownership atomically after asynchronous domain verification", async () => {
    const repositoryReference: { current?: MemoryRoutingRepository } = {};
    const verifier: DomainOwnershipVerifier = {
      verify: (challenge) => {
        repositoryReference.current?.removeOwnership(
          PROJECT_ID,
          ENVIRONMENT_ID,
        );
        return Promise.resolve({
          challenge_id: challenge.challenge_id,
          hostname: challenge.hostname,
          record_name: challenge.record_name,
          observed_value: challenge.expected_value,
          verified_at: NOW,
          verifier_reference: "dns-query:ownership-race",
        });
      },
    };
    const { repository, service } = harness({
      verifier,
      ids: [CHALLENGE_ID, ROUTE_ONE_ID],
    });
    repositoryReference.current = repository;
    const challenge = await service.beginCustomDomainVerification(owner, {
      ...generatedRequest,
      hostname: "race.example.com",
    });

    await expectRoutingError(
      service.activateCustomDomain(owner, {
        challenge_id: challenge.challenge_id,
      }),
      "access_denied",
    );
    expect(repository.routes.size).toBe(0);
  });

  it("keeps custom-domain challenge retries and activation idempotent", async () => {
    const { service } = harness({
      ids: [CHALLENGE_ID, ROUTE_ONE_ID, ROUTE_TWO_ID],
    });
    const request = { ...generatedRequest, hostname: "app.example.com" };
    const [firstChallenge, secondChallenge] = await Promise.all([
      service.beginCustomDomainVerification(owner, request),
      service.beginCustomDomainVerification(owner, request),
    ]);
    expect(secondChallenge).toEqual(firstChallenge);

    const firstRoute = await service.activateCustomDomain(owner, {
      challenge_id: firstChallenge.challenge_id,
    });
    const replayedRoute = await service.activateCustomDomain(owner, {
      challenge_id: firstChallenge.challenge_id,
    });
    expect(replayedRoute).toEqual(firstRoute);
  });

  it("prevents another intent from reserving an existing custom hostname", async () => {
    const { repository, service } = harness({ ids: [CHALLENGE_ID] });
    await service.beginCustomDomainVerification(owner, {
      ...generatedRequest,
      hostname: "app.example.com",
    });
    repository.addOwnership({
      project_id: OTHER_PROJECT_ID,
      environment_id: ENVIRONMENT_ID,
      owner_user_id: OWNER_ID,
    });

    await expectRoutingError(
      service.beginCustomDomainVerification(owner, {
        project_id: OTHER_PROJECT_ID,
        environment_id: ENVIRONMENT_ID,
        port: 4_000,
        hostname: "app.example.com",
      }),
      "hostname_collision",
    );
  });

  it("denies cross-user revoke, then revokes/deletes idempotently", async () => {
    const { service } = harness({ ids: [ROUTE_ONE_ID] });
    const route = await service.issueGeneratedRoute(owner, generatedRequest);

    await expectRoutingError(
      service.revokeRoute(otherUser, { route_id: route.route_id }),
      "access_denied",
    );
    const revoked = await service.revokeRoute(owner, {
      route_id: route.route_id,
    });
    expect(revoked.status).toBe("revoked");
    await expect(
      service.revokeRoute(owner, { route_id: route.route_id }),
    ).resolves.toEqual(revoked);

    const deleted = await service.deleteRoute(owner, {
      route_id: route.route_id,
    });
    expect(deleted.status).toBe("deleted");
    await expect(
      service.deleteRoute(owner, { route_id: route.route_id }),
    ).resolves.toEqual(deleted);
  });

  it("rechecks ownership inside atomic revoke", async () => {
    const { repository, service } = harness({ ids: [ROUTE_ONE_ID] });
    const route = await service.issueGeneratedRoute(owner, generatedRequest);
    repository.beforeNextAtomic = () => {
      repository.removeOwnership(PROJECT_ID, ENVIRONMENT_ID);
    };

    await expectRoutingError(
      service.revokeRoute(owner, { route_id: route.route_id }),
      "access_denied",
    );
    expect(repository.routes.get(route.route_id)?.status).toBe("active");
  });

  it("emits a deterministic narrow desired state without credentials or upstreams", async () => {
    const { service } = harness({ ids: [ROUTE_ONE_ID] });
    await service.issueGeneratedRoute(owner, generatedRequest);

    const desired = await service.buildDesiredState();
    expect(desired).toEqual({
      schema_version: 2,
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      valid_until: DESIRED_STATE_VALID_UNTIL,
      routes: [
        {
          route_id: ROUTE_ONE_ID,
          hostname: generatedProjectHostname(PROJECT_ID, ENVIRONMENT_ID, 3_000),
          target: { environment_id: ENVIRONMENT_ID, port: 3_000 },
        },
      ],
    });
    const serialized = JSON.stringify(desired);
    for (const forbidden of [
      "owner_user_id",
      "project_id",
      "upstream",
      "host_path",
      "socket",
      "credential",
      "caddy",
      "dns_token",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }

    await service.revokeRoute(owner, { route_id: ROUTE_ONE_ID });
    expect((await service.buildDesiredState()).routes).toEqual([]);
  });

  it("revalidates custom-domain ownership on every leased desired state", async () => {
    let currentlyOwned = true;
    const verifier: DomainOwnershipVerifier = {
      verify: (challenge) =>
        Promise.resolve({
          challenge_id: challenge.challenge_id,
          hostname: challenge.hostname,
          record_name: challenge.record_name,
          observed_value: currentlyOwned
            ? challenge.expected_value
            : "brai-domain-verification=ownership-transferred",
          verified_at: NOW,
          verifier_reference: "dns-query:lease-refresh",
        }),
    };
    const { service } = harness({
      verifier,
      ids: [CHALLENGE_ID, ROUTE_ONE_ID],
    });
    const challenge = await service.beginCustomDomainVerification(owner, {
      ...generatedRequest,
      hostname: "lease.example.com",
    });
    await service.activateCustomDomain(owner, {
      challenge_id: challenge.challenge_id,
    });

    const ownedState = await service.buildDesiredState();
    expect(ownedState.routes).toHaveLength(1);
    expect(ownedState.valid_until).toBe(DESIRED_STATE_VALID_UNTIL);

    currentlyOwned = false;
    const transferredState = await service.buildDesiredState();
    expect(transferredState.routes).toEqual([]);
    expect(transferredState.digest).not.toBe(ownedState.digest);
  });

  it("fails a custom route closed when current DNS verification is unavailable", async () => {
    let verifierCalls = 0;
    const verifier: DomainOwnershipVerifier = {
      verify: (challenge) => {
        verifierCalls += 1;
        if (verifierCalls > 1) {
          return Promise.reject(new Error("DNS unavailable"));
        }
        return Promise.resolve({
          challenge_id: challenge.challenge_id,
          hostname: challenge.hostname,
          record_name: challenge.record_name,
          observed_value: challenge.expected_value,
          verified_at: NOW,
          verifier_reference: "dns-query:activation",
        });
      },
    };
    const { service } = harness({
      verifier,
      ids: [CHALLENGE_ID, ROUTE_ONE_ID],
    });
    const challenge = await service.beginCustomDomainVerification(owner, {
      ...generatedRequest,
      hostname: "dns-down.example.com",
    });
    await service.activateCustomDomain(owner, {
      challenge_id: challenge.challenge_id,
    });

    expect((await service.buildDesiredState()).routes).toEqual([]);
  });

  it("expires one-time domain proof even when its old TXT value remains", async () => {
    let now = new Date(NOW);
    const verifier: DomainOwnershipVerifier = {
      verify: (challenge) =>
        Promise.resolve({
          challenge_id: challenge.challenge_id,
          hostname: challenge.hostname,
          record_name: challenge.record_name,
          observed_value: challenge.expected_value,
          verified_at: now.toISOString(),
          verifier_reference: "dns-query:old-token-still-present",
        }),
    };
    const { service } = harness({
      verifier,
      ids: [CHALLENGE_ID, ROUTE_ONE_ID],
      now: () => new Date(now),
    });
    const challenge = await service.beginCustomDomainVerification(owner, {
      ...generatedRequest,
      hostname: "bounded-proof.example.com",
    });
    await service.activateCustomDomain(owner, {
      challenge_id: challenge.challenge_id,
    });
    expect((await service.buildDesiredState()).routes).toHaveLength(1);

    now = new Date(Date.parse(challenge.expires_at) + 1);
    expect((await service.buildDesiredState()).routes).toEqual([]);
  });

  it("never leases desired state beyond the custom proof deadline", async () => {
    const { service } = harness({
      ids: [CHALLENGE_ID, ROUTE_ONE_ID],
      challengeTtlMs: 60_000,
    });
    const challenge = await service.beginCustomDomainVerification(owner, {
      ...generatedRequest,
      hostname: "short-proof.example.com",
    });
    await service.activateCustomDomain(owner, {
      challenge_id: challenge.challenge_id,
    });

    expect((await service.buildDesiredState()).valid_until).toBe(
      challenge.expires_at,
    );
  });

  it("excludes an active route immediately when current ownership is lost", async () => {
    const { repository, service } = harness({ ids: [ROUTE_ONE_ID] });
    await service.issueGeneratedRoute(owner, generatedRequest);
    repository.removeOwnership(PROJECT_ID, ENVIRONMENT_ID);

    expect((await service.buildDesiredState()).routes).toEqual([]);
  });

  it("atomically releases a generated hostname after project ownership changes", async () => {
    const { repository, service } = harness({
      ids: [ROUTE_ONE_ID, ROUTE_TWO_ID],
    });
    const oldRoute = await service.issueGeneratedRoute(owner, generatedRequest);
    repository.addOwnership({
      project_id: PROJECT_ID,
      environment_id: ENVIRONMENT_ID,
      owner_user_id: OTHER_USER_ID,
    });

    const replacement = await service.issueGeneratedRoute(
      otherUser,
      generatedRequest,
    );
    expect(replacement.route_id).toBe(ROUTE_TWO_ID);
    expect(replacement.owner_user_id).toBe(OTHER_USER_ID);
    expect(repository.routes.get(oldRoute.route_id)?.status).toBe("deleted");
    expect((await service.buildDesiredState()).routes).toEqual([
      expect.objectContaining({ route_id: ROUTE_TWO_ID }),
    ]);
  });

  it("lets a new owner challenge a custom hostname after the old proof expires", async () => {
    let now = new Date(NOW);
    const verifier: DomainOwnershipVerifier = {
      verify: (challenge) =>
        Promise.resolve({
          challenge_id: challenge.challenge_id,
          hostname: challenge.hostname,
          record_name: challenge.record_name,
          observed_value: challenge.expected_value,
          verified_at: now.toISOString(),
          verifier_reference: "dns-query:ownership-lifecycle",
        }),
    };
    const { repository, service } = harness({
      verifier,
      ids: [CHALLENGE_ID, ROUTE_ONE_ID, ROUTE_TWO_ID],
      now: () => new Date(now),
    });
    const oldChallenge = await service.beginCustomDomainVerification(owner, {
      ...generatedRequest,
      hostname: "transferred.example.com",
    });
    const oldRoute = await service.activateCustomDomain(owner, {
      challenge_id: oldChallenge.challenge_id,
    });
    now = new Date(Date.parse(oldChallenge.expires_at) + 1);
    repository.addOwnership({
      project_id: OTHER_PROJECT_ID,
      environment_id: ENVIRONMENT_ID,
      owner_user_id: OTHER_USER_ID,
    });

    const freshChallenge = await service.beginCustomDomainVerification(
      otherUser,
      {
        project_id: OTHER_PROJECT_ID,
        environment_id: ENVIRONMENT_ID,
        port: 4_000,
        hostname: oldRoute.hostname,
      },
    );
    expect(freshChallenge.challenge_id).toBe(ROUTE_TWO_ID);
    expect(freshChallenge.owner_user_id).toBe(OTHER_USER_ID);
    expect(repository.routes.get(oldRoute.route_id)?.status).toBe("deleted");
    expect((await service.buildDesiredState()).routes).toEqual([]);
  });

  it("never reactivates a route through an already-used domain challenge", async () => {
    const { service } = harness({ ids: [CHALLENGE_ID, ROUTE_ONE_ID] });
    const challenge = await service.beginCustomDomainVerification(owner, {
      ...generatedRequest,
      hostname: "revoked.example.com",
    });
    const route = await service.activateCustomDomain(owner, {
      challenge_id: challenge.challenge_id,
    });
    await service.revokeRoute(owner, { route_id: route.route_id });

    await expectRoutingError(
      service.activateCustomDomain(owner, {
        challenge_id: challenge.challenge_id,
      }),
      "route_not_found",
    );
  });
});
