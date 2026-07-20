import { expectedRepository } from "./constants.mjs";

/** @param {Record<string, unknown>} claims @param {{ target: "dev" | "preview"; branch: string }} request */
export function authorizeDelivery(claims, request) {
  assertTrustedWorkflow(claims, "delivery.yml");
  const event = stringClaim(claims, "event_name");
  if (request.target === "dev") {
    const allowed =
      (event === "push" && claims.ref === "refs/heads/dev") ||
      (event === "workflow_dispatch" && claims.ref === "refs/heads/dev");
    if (!allowed || request.branch !== "dev") {
      throw new Error("OIDC token is not authorized for dev delivery");
    }
    return;
  }
  const branchRef = `refs/heads/${request.branch}`;
  const pullRequest =
    event === "pull_request" &&
    claims.head_ref === request.branch &&
    claims.base_ref === "dev";
  const releasePush =
    event === "push" &&
    request.branch.startsWith("release/") &&
    claims.ref === branchRef;
  if (!pullRequest && !releasePush) {
    throw new Error("OIDC token is not authorized for preview delivery");
  }
}

/** @param {Record<string, unknown>} claims @param {string} branch */
export function authorizePreviewRelease(claims, branch) {
  assertTrustedWorkflow(claims, "preview-cleanup.yml");
  if (claims.event_name !== "pull_request" || claims.head_ref !== branch) {
    throw new Error("OIDC token is not authorized for preview cleanup");
  }
}

/** @param {Record<string, unknown>} claims @param {string} branch */
export function authorizePreviewStatus(claims, branch) {
  assertTrustedWorkflow(claims, "enable-runtime-automerge.yml");
  if (
    typeof branch !== "string" ||
    claims.event_name !== "workflow_dispatch" ||
    claims.ref !== "refs/heads/dev"
  ) {
    throw new Error("OIDC token is not authorized for preview status");
  }
}

/** @param {Record<string, unknown>} claims @param {string} workflow */
function assertTrustedWorkflow(claims, workflow) {
  if (
    claims.repository !== expectedRepository ||
    claims.repository_visibility !== "public" ||
    typeof claims.workflow_ref !== "string" ||
    !claims.workflow_ref.startsWith(
      `${expectedRepository}/.github/workflows/${workflow}@`,
    )
  ) {
    throw new Error("OIDC workflow identity is not trusted");
  }
}

/** @param {Record<string, unknown>} claims @param {string} name */
function stringClaim(claims, name) {
  if (typeof claims[name] !== "string")
    throw new Error(`OIDC ${name} claim is invalid`);
  return claims[name];
}
