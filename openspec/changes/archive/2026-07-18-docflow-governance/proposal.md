## Why

The current governance lane depends too heavily on a long Codex adapter and on
OpenSpec Change as the default work envelope. That makes documentation checks
less portable across agents, needlessly expensive for small edits, and unable
to describe a task-database route without inventing a Change. The project needs
one compact, fail-closed workflow that keeps current documentation, normative
specification, and decision rationale synchronized without loading the whole
project context for every task.

## What Changes

- Introduce the short `docflow` skill as a compact audit/sync/finalize adapter.
- Add a project-local deterministic runner that accepts either an OpenSpec
  Change context or a generic task context without implementing a task database.
- Route work through `quick`, `normal`, and `full` governance levels with
  targeted checks, caching, and no unconditional full CI.
- Synchronize reader-facing documentation automatically; update OpenSpec only
  when normative behavior changes; evaluate ADR reuse, supersession, or an
  explicit no-ADR result.
- Add baseline/evidence reporting, `pending-governance`, `spec-drift`, and
  fail-closed finalization behavior.
- Make Memory Bank loading progressive and keep `AGENTS.md` limited to the
  central project principles and the `docflow` entry point.
- Support docs-only and DB-only task contexts while keeping task database,
  worktree orchestration, and conflict resolution outside this change.
- Keep external ADR publication separate from local task completion.

## Capabilities

### New Capabilities

None. The new behavior extends the existing documentation and agent workflow
capabilities.

### Modified Capabilities

- `documentation-governance`: define dual task inputs, compact routing,
  evidence-based synchronization, progressive context, and fail-closed
  finalization.
- `agent-workflow`: make OpenSpec Change optional for DB-only work and require
  the same project-local governance entry point for all agents.

## Impact

- Project rules: `AGENTS.md` and `openspec/config.yaml`.
- Deterministic tooling: `tools/docs/` and package scripts.
- OpenSpec permanent specifications for documentation governance and agent
  workflow.
- Codex skill installation under the shared skill directory, with a project
  fallback when the skill is unavailable.
- Memory Bank routing and governance records.
- No task database, task API, worktree manager, or production deployment is
  introduced by this change.
