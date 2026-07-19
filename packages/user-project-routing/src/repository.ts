import type {
  CustomDomainChallenge,
  IngressRoute,
  ProjectEnvironmentOwnership,
} from "./schemas.js";

export type ReserveRouteResult =
  | Readonly<{ outcome: "created" | "idempotent"; route: IngressRoute }>
  | Readonly<{ outcome: "access_denied" | "hostname_collision" }>;

export type CreateChallengeResult =
  | Readonly<{
      outcome: "created" | "idempotent";
      challenge: CustomDomainChallenge;
    }>
  | Readonly<{ outcome: "access_denied" | "hostname_collision" }>;

export type ActivateChallengeResult =
  | Readonly<{
      outcome: "activated" | "idempotent";
      route: IngressRoute;
    }>
  | Readonly<{
      outcome:
        | "access_denied"
        | "challenge_not_found"
        | "hostname_collision"
        | "stale";
    }>;

export type SetRouteStatusResult =
  | Readonly<{
      outcome: "updated" | "idempotent";
      route: IngressRoute;
    }>
  | Readonly<{ outcome: "access_denied" | "route_not_found" | "stale" }>;

export interface AtomicOwnershipExpectation {
  readonly expected_owner_user_id: string;
  readonly project_id: string;
  readonly environment_id: string;
}

/**
 * Persistence boundary for the routing domain. Implementations must perform
 * each `*Atomically` method in one database transaction, recheck the supplied
 * project/environment ownership expectation in that same transaction, and
 * enforce a unique
 * canonical-hostname reservation across non-deleted routes and live pending
 * challenges. Exact retries return `idempotent`; a different semantic intent
 * for the same hostname returns `hostname_collision`. Before deciding a
 * collision, the same transaction must tombstone routes whose stored
 * project/environment owner is no longer current and custom routes whose linked
 * proof hard deadline has passed. It must also cancel expired or ownership-lost
 * pending challenges. Stale records remain as history but never reserve a
 * hostname forever.
 */
export interface UserProjectRoutingRepository {
  findProjectEnvironment(
    projectId: string,
    environmentId: string,
  ): Promise<ProjectEnvironmentOwnership | null>;

  findRouteById(routeId: string): Promise<IngressRoute | null>;

  findChallengeById(challengeId: string): Promise<CustomDomainChallenge | null>;

  reserveActiveRouteAtomically(
    command: AtomicOwnershipExpectation &
      Readonly<{
        candidate: IngressRoute;
      }>,
  ): Promise<ReserveRouteResult>;

  createOrGetChallengeAtomically(
    command: AtomicOwnershipExpectation &
      Readonly<{
        candidate: CustomDomainChallenge;
      }>,
  ): Promise<CreateChallengeResult>;

  activateChallengeAtomically(
    command: AtomicOwnershipExpectation &
      Readonly<{
        challenge_id: string;
        expected_challenge_revision: number;
        route: IngressRoute;
      }>,
  ): Promise<ActivateChallengeResult>;

  setRouteStatusAtomically(
    command: AtomicOwnershipExpectation &
      Readonly<{
        route_id: string;
        expected_revision: number;
        status: "revoked" | "deleted";
        updated_at: string;
      }>,
  ): Promise<SetRouteStatusResult>;

  /**
   * Returns, from one consistent read, only active routes whose current
   * project/environment owner still equals the route owner. Ownership-lost
   * routes must never enter desired ingress state.
   */
  listActiveRoutesWithCurrentOwnership(): Promise<readonly IngressRoute[]>;
}

export interface DomainOwnershipVerifier {
  /**
   * This is a trusted adapter boundary, not user input. It must perform the
   * external DNS/HTTP proof and return what it actually observed.
   */
  verify(challenge: CustomDomainChallenge): Promise<unknown>;
}
