import { UserProjectRoutingError } from "./errors.js";
import { identifierSchema } from "./schemas.js";

const trustedActorBrand: unique symbol = Symbol(
  "brai.user-project-routing.trusted-actor",
);
const issuedContexts = new WeakSet<object>();

/**
 * An authentication principal issued by the trusted server adapter. The
 * private symbol makes the type nominal; the module-private WeakSet prevents
 * runtime forgery even if a caller copies symbol properties from a real value.
 */
export interface TrustedAuthenticatedActorContext {
  readonly authenticated_user_id: string;
  readonly [trustedActorBrand]: true;
}

export function createTrustedAuthenticatedActorContext(
  authenticatedUserId: unknown,
): TrustedAuthenticatedActorContext {
  const parsed = identifierSchema.safeParse(authenticatedUserId);
  if (!parsed.success) {
    throw new UserProjectRoutingError(
      "invalid_request",
      "Trusted auth adapter передал некорректный user id",
    );
  }

  const context: TrustedAuthenticatedActorContext = Object.freeze({
    authenticated_user_id: parsed.data,
    [trustedActorBrand]: true as const,
  });
  issuedContexts.add(context);
  return context;
}

export function assertTrustedAuthenticatedActorContext(
  value: unknown,
): TrustedAuthenticatedActorContext {
  if (
    typeof value !== "object" ||
    value === null ||
    !issuedContexts.has(value)
  ) {
    throw new UserProjectRoutingError(
      "access_denied",
      "Требуется actor context от trusted auth adapter",
    );
  }

  const context = value as TrustedAuthenticatedActorContext;
  if (
    context[trustedActorBrand] !== true ||
    !Object.isFrozen(context) ||
    !identifierSchema.safeParse(context.authenticated_user_id).success
  ) {
    throw new UserProjectRoutingError(
      "access_denied",
      "Trusted actor context повреждён",
    );
  }
  return context;
}
