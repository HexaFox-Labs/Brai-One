## 1. Deterministic project runner

- [x] 1.1 Implement `tools/docs/docflow.mjs` with the generic context envelope,
      `quick`/`normal`/`full` classification, compact JSON output, and
      preflight/finalize phases.
- [x] 1.2 Add baseline manifest and final hash comparison with Git-diff
      fallback, unsafe-path handling, and fail-closed missing-evidence results.
- [x] 1.3 Add route-specific static checks, explicit CI opt-in, and result
      caching/skip behavior for unchanged inputs.
- [x] 1.4 Add focused Node tests covering Change-based, DB-only, direct,
      docs-only, `spec-drift`, pending-governance, and conflict statuses.

## 2. Project integration

- [x] 2.1 Add the `docflow` package script and document the context envelope for
      agents without introducing a task database.
- [x] 2.2 Reduce `AGENTS.md` to the compact governance kernel and update
      `openspec/config.yaml` to describe both work routes and progressive Memory
      Bank loading.
- [x] 2.3 Update the permanent documentation-governance and agent-workflow
      specifications from the validated delta artifacts.

## 3. Agent skill and context routing

- [x] 3.1 Install the compact `docflow` skill and UI metadata in the shared
      Codex skill directory.
- [x] 3.2 Replace the old `documentation-governance` body with a compatibility
      redirect to `docflow`.
- [x] 3.3 Update Memory Bank routing instructions so the always-loaded kernel is
      compact and thematic files are loaded by route.

## 4. Governance validation and handoff

- [x] 4.1 Run the fast route scenarios and verify that no full CI is triggered.
- [x] 4.2 Run normal/full static checks, OpenSpec strict validation, and the
      project documentation/ADR checks.
- [x] 4.3 Complete ADR impact review, record the final ADR decision and
      `docs-impact.md`, then update Memory Bank with actual results.
- [x] 4.4 Archive this OpenSpec Change only after all required evidence and
      checks pass; report any baseline CI blocker separately.
