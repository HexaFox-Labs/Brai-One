## 1. Delivery contract and impact catalog

- [x] 1.1 Add a typed delivery catalog mapping Nx projects, images, runtime dependencies, checks and non-runtime paths.
- [x] 1.2 Add deterministic affected/impact resolver with merge-base validation and unit tests.
- [x] 1.3 Add manifest composition that overlays only changed image digests on a verified base manifest.

## 2. GitHub Actions and Git Flow

- [x] 2.1 Replace broad PR CI with trusted-primary-repository affected checks and documentation-only reduced checks.
- [x] 2.2 Publish only affected GHCR images, attach provenance/SBOM and retain a small manifest artifact.
- [x] 2.3 Add dev, preview, release and explicit production-promotion workflows with exact revision checks and concurrency controls.
- [x] 2.4 Add repository policy script and operator instructions for protected branches, environments, auto-merge and fork workflow denial.
- [x] 2.5 Make GHCR authentication a shared terminal prerequisite for Dev and Preview/release manifests, with a workflow-policy regression test.
- [x] 2.6 Require an exact owner-issued runtime acceptance status on `dev` so manual merge cannot bypass Preview, and replace the impossible self-review trigger with an owner-only dispatch.
- [x] 2.7 Carry immutable image manifests across non-runtime Dev/release revisions, derive Dev affected scope from the actually published manifest to survive replaced pending runs, and resolve release branches against the exact frozen Dev base without rebuilding unrelated runtime images.
- [x] 2.8 Accept the repository's single-package GHCR digest format in a bumped fail-closed production host contract, support protected exact-revision rollback and add regression coverage.
- [x] 2.9 Make all commandless scratch-manifest readers use a never-started extraction container with an explicit inert command and cover every workflow path with regression tests.
- [x] 2.10 Reuse canonical Preview manifest strings across the whole undelivered Dev range, make owner-only acceptance status-only so an authorized primary agent performs the exact-head protected squash merge without suppressing downstream events, and cover both contracts with executable tests.
- [x] 2.11 Preserve Nx-affected runtime services, images and Preview requirements when a range also contains control paths, with a mixed workflow-plus-web regression test.
- [ ] 2.12 Keep the root-owned production SSH authorization immutable but readable by OpenSSH under the locked deploy UID, and verify real public-key authentication before retrying cutover.

## 3. Preview controller and host contracts

- [x] 3.1 Implement lease registry, ordered slot allocator, priority queue, 72-hour expiry and stale-generation protection.
- [x] 3.2 Implement snapshot/restore, slot database isolation, migration runner and budget enforcement without attachments or build artifacts.
- [x] 3.3 Add prefixed preview/dev Compose rendering, protected Caddy route rendering and health-gated atomic manifest activation.
- [x] 3.4 Add scoped host receiver commands, cleanup, log/image retention and capacity admission checks.
- [x] 3.5 Preserve the managed Dev Caddy block when the host controller is reinstalled after cutover.

## 4. Security and observability

- [x] 4.1 Enforce least-privilege event, token and environment policy in workflows and tests.
- [x] 4.2 Add private GitHub status/notification diagnostics for failed checks, queueing, capacity and rollback.
- [x] 4.3 Add disk, CPU, RAM, database and log budget checks with safe non-destructive behavior.
- [x] 4.4 Bind preview cleanup and owner acceptance to documented GitHub OIDC claims and test requests that omit event-payload-only fields.
- [x] 4.5 Calibrate the host free-space floor to the bounded five-preview budget without deleting legacy environments.

## 5. Validation and migration

- [x] 5.1 Add focused tests for classification, manifests, slot lifecycle, rejection and rollback.
- [x] 5.2 Run formatting, targeted Nx checks, deployment/Compose tests, OpenSpec validation and security policy checks; keep the Playwright-only webServer bounded on the many-core host.
- [ ] 5.3 Complete terminal GitHub workflow verification on a controlled branch: Dev and Preview/release both persist their exact immutable manifests and remain green.
- [x] 5.4 Complete real p01 HTTPS validation, merge-triggered cleanup and slot release without changing legacy traffic.
- [ ] 5.5 Perform owner-approved legacy dev cutover, capacity baseline and real branch/release/rollback verification.

## 6. Documentation and governance

- [x] 6.1 Add/update delivery reference and operator migration documentation.
- [x] 6.2 Create an ADR for Git Flow affected delivery, immutable manifest promotion and bounded preview slots.
- [x] 6.3 Synchronize permanent OpenSpec specs, Memory Bank and deployment registry.
- [ ] 6.4 Run docflow finalize and archive the Change only after all implementation and cutover evidence is complete.
