/**
 * Import this subpath only from the trusted authentication adapter after it
 * has validated a server-side session/token. User command handlers must never
 * construct an actor context from request JSON.
 */
export {
  createTrustedAuthenticatedActorContext,
  type TrustedAuthenticatedActorContext,
} from "./trusted-actor-context.js";
