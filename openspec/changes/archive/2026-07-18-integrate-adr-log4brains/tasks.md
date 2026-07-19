## 1. OpenSpec and workflow contract

- [x] 1.1 Validate the proposal, new capabilities, and agent-workflow delta against the current OpenSpec schema.
- [x] 1.2 Add the project documentation-governance contract and ADR-aware completion rule to permanent specs during finalization.

## 2. Local ADR installation

- [x] 2.1 Add pinned Log4brains 1.1.0 to the root pnpm devDependencies and lockfile.
- [x] 2.2 Add `.log4brains.yml` targeting `Etc/UTC` and `./docs/decisions`.
- [x] 2.3 Add project-local ADR scripts for list, preview, build, and check using the local binary.
- [x] 2.4 Add a Log4brains-compatible ADR template and a new Brai New bootstrap ADR; do not copy legacy ADR records.
- [x] 2.5 Add deterministic ADR metadata/source validation and checks for valid records and legacy-data exclusion.

## 3. Agent and documentation integration

- [x] 3.1 Install the shared Codex `documentation-governance` skill adapter with audit, sync, backfill, and finalize modes.
- [x] 3.2 Make the adapter read project rules, Memory Bank, OpenSpec, docs methodology, ADRs, and implementation evidence before changing records.
- [x] 3.3 Update `AGENTS.md`, `openspec/config.yaml`, and documentation indexes so agents invoke ADR impact review without user-entered internal commands.
- [x] 3.4 Update the docs methodology/stack/reference materials to define ADR versus OpenSpec responsibility and the clean new source boundary.

## 4. Static publication and domain ownership

- [x] 4.1 Add an atomic ADR static-release publisher with a Brai New host root separate from the legacy static root.
- [x] 4.2 Build the clean Brai New site and verify title, search index, bootstrap ADR, links, and authentication behavior locally.
- [x] 4.3 Switch the live Caddy `adr.brai.one` root to the Brai New release while preserving HTTPS, redirect, and unified Basic Auth.
- [x] 4.4 Verify the canonical domain through the isolated authenticated browser/HTTP smoke path and record rollback readiness.

## 5. Completion evidence

- [x] 5.1 Run formatting, ADR checks, OpenSpec strict validation, relevant project tests, and deployment/configuration tests; record the unrelated `@brai/web` baseline CI blocker.
- [x] 5.2 Update `/home/mark/DEPLOYMENT.md` to make Brai New the ADR source of truth and record the legacy root as preserved rollback material without secrets.
- [x] 5.3 Update `memory-bank/activeContext.md` and `memory-bank/progress.md` with the implementation, cutover, verification, and remaining Caddy ownership limitation.
- [x] 5.4 Synchronize the delta specs, validate all permanent specs, and archive this Change only after the new domain is verified.
