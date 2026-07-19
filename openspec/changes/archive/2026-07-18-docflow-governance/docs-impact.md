# Documentation impact — `docflow-governance`

## Source-of-truth decisions

- **OpenSpec:** updated permanent
  `openspec/specs/documentation-governance/spec.md` and
  `openspec/specs/agent-workflow/spec.md`, because this Change introduces
  normative workflow behavior for both OpenSpec and task-database routes.
- **Reader-facing documentation:** updated
  `docs/documentation-methodology.md`, `docs/README.md` and
  `docs/reference/commands.md` to describe the current agent workflow,
  progressive context and project-local runner.
- **ADR:** created
  [`20260718-adopt-docflow-governance.md`](../../../../docs/decisions/20260718-adopt-docflow-governance.md)
  because the project-wide governance boundary and enforcement mechanism are a
  durable architectural/process decision. Existing ADRs remain valid and are
  not superseded.
- **Memory Bank:** updated `activeContext.md` and `progress.md` with the
  agreed workflow, implementation scope and verification state.

## Scope boundary

This Change does not implement the future task database, task API, worktree
allocation, commit/merge orchestration or conflict-resolution runtime. Those
systems must later provide the generic task context and use the same governance
rules. Conflict tasks and parent/child ownership remain recorded as future
workflow requirements, not as an implementation claim here.

## Evidence

- `node --test tools/docs/docflow.test.mjs`
- `node --check tools/docs/docflow.mjs`
- `pnpm run docs:check`
- `pnpm run adr:check`
- `openspec validate --all --strict`
- quick preflight/finalize smoke run with explicit context and baseline

Full project CI is not part of the ordinary documentation route and was not
run automatically. It remains an explicit `docflow --ci`/release action.
