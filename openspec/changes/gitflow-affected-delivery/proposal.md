## Why

The current workflow runs the whole workspace and builds every runtime image for
every relevant change, while a push to `main` deploys production immediately.
That repeats the legacy failure mode: slow feedback, duplicated artifacts and
unsafe promotion semantics.

The public Brai repository needs a Git Flow delivery model that is fast by
default, preserves strict trust boundaries, and creates preview environments
only when a runtime change actually needs one.

A real preview validation also showed that a healthy controller deployment is
not a complete delivery result by itself: the exact immutable preview manifest
must be persisted in GHCR before the GitHub check can become green and the
revision can be promoted.

The same live validation found that preview cleanup and owner acceptance were
incorrectly requiring the GitHub event-only `action` field as an OIDC claim.
GitHub's OIDC token contract does not emit that field, so the trusted controller
rejected legitimate workflow requests before it could release a slot or report
an exact preview revision.

## What Changes

- Add Git Flow branch, merge, acceptance and promotion rules for `dev`,
  `release/*`, `main`, feature/fix/docs and hotfix branches.
- Replace broad CI execution with Nx/Lerna affected checks and a declared
  runtime dependency closure.
- Publish only affected immutable GHCR images and assemble exact deployment
  manifests by reusing unchanged image digests.
- Add a least-privilege preview controller with deterministic `p01`--`p20`
  slot allocation, a priority queue, 72-hour idle expiry, isolated seeded
  databases, Caddy routes and container names such as `p07-brai-api`.
- Add `dev` and production manifest promotion, health-gated rollback, storage,
  CPU and memory admission budgets, retention and auditable cleanup.
- Restrict public-repository automation so external forks cannot run internal
  workflows, obtain secrets, create previews or deploy.
- Replace the current automatic production deployment from every `main` push
  with an explicit, accepted release promotion.
- Treat the exact GHCR manifest as a terminal requirement for both Dev and
  Preview/release delivery, with target-neutral registry authentication and a
  regression test for the workflow contract.
- Authorize preview cleanup and owner acceptance only from documented GitHub
  Actions OIDC claims, while retaining the narrow trusted workflow triggers
  that select the `closed` and `submitted` activities.

## Capabilities

### New Capabilities

- `gitflow-affected-delivery`: Fast, deterministic Git Flow CI/CD, preview
  lifecycle, image promotion, terminal immutable-manifest persistence and
  capacity-aware cleanup for Brai.

### Modified Capabilities

- `agent-access`: Deployment and preview automation receives strictly scoped
  credentials and rejects untrusted public-repository events.
- `agent-workflow`: Agents follow the branch/preview/acceptance lifecycle when
  they implement and submit runtime changes.

## Impact

Affected surfaces include Nx and Lerna configuration, GitHub Actions, GHCR
publication, deployment manifests, Docker Compose/runtime scripts, Caddy,
PostgreSQL preview data management, host monitoring, protected GitHub settings,
operator documentation, access policy and Memory Bank. The migration must not
delete or disrupt the legacy Brai environment before the new dev and preview
path has passed verification.
