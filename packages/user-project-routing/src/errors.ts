export type UserProjectRoutingErrorCode =
  | "access_denied"
  | "challenge_expired"
  | "challenge_not_found"
  | "concurrency_conflict"
  | "domain_invalid"
  | "domain_reserved"
  | "hostname_collision"
  | "invalid_request"
  | "ownership_verification_failed"
  | "repository_invariant_violation"
  | "route_not_found";

export class UserProjectRoutingError extends Error {
  readonly code: UserProjectRoutingErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: UserProjectRoutingErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "UserProjectRoutingError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
