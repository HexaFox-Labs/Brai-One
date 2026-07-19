## 1. Delivery contract and impact catalog

- [x] 1.1 Add a typed delivery catalog mapping Nx projects, images, runtime dependencies, checks and non-runtime paths.
- [x] 1.2 Add deterministic affected/impact resolver with merge-base validation and unit tests.
- [x] 1.3 Add manifest composition that overlays only changed image digests on a verified base manifest.

## 2. GitHub Actions and Git Flow

- [ ] 2.1 Replace broad PR CI with trusted-primary-repository affected checks and documentation-only reduced checks.
- [ ] 2.2 Publish only affected GHCR images, attach provenance/SBOM and retain a small manifest artifact.
- [ ] 2.3 Add dev, preview, release and explicit production-promotion workflows with exact revision checks and concurrency controls.
- [ ] 2.4 Add repository policy script and operator instructions for protected branches, environments, auto-merge and fork workflow denial.

## 3. Preview controller and host contracts

- [ ] 3.1 Implement lease registry, ordered slot allocator, priority queue, 72-hour expiry and stale-generation protection.
- [ ] 3.2 Implement snapshot/restore, slot database isolation, migration runner and budget enforcement without attachments or build artifacts.
- [ ] 3.3 Add prefixed preview/dev Compose rendering, protected Caddy route rendering and health-gated atomic manifest activation.
- [ ] 3.4 Add scoped host receiver commands, cleanup, log/image retention and capacity admission checks.

## 4. Security and observability

- [ ] 4.1 Enforce least-privilege event, token and environment policy in workflows and tests.
- [ ] 4.2 Add private GitHub status/notification diagnostics for failed checks, queueing, capacity and rollback.
- [ ] 4.3 Add disk, CPU, RAM, database and log budget checks with safe non-destructive behavior.

## 5. Validation and migration

- [ ] 5.1 Add focused tests for classification, manifests, slot lifecycle, rejection and rollback.
- [ ] 5.2 Run formatting, targeted Nx checks, deployment/Compose tests, OpenSpec validation and security policy checks.
- [ ] 5.3 Connect and configure the GitHub repository, then verify protected workflow behavior against a controlled branch.
- [ ] 5.4 Install the host-side controller and complete synthetic dev/preview verification without changing legacy traffic.
- [ ] 5.5 Perform owner-approved legacy dev cutover, capacity baseline and real branch/release/rollback verification.

## 6. Documentation and governance

- [ ] 6.1 Add/update delivery reference and operator migration documentation.
- [ ] 6.2 Create an ADR for Git Flow affected delivery, immutable manifest promotion and bounded preview slots.
- [ ] 6.3 Synchronize permanent OpenSpec specs, Memory Bank and deployment registry.
- [ ] 6.4 Run docflow finalize and archive the Change only after all implementation and cutover evidence is complete.
