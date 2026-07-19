## Context

Brai New currently has a useful documentation-governance Codex adapter, but the
adapter is the only place where the full workflow is described. `AGENTS.md`,
`openspec/config.yaml`, and the permanent specs still assume that every durable
task has an OpenSpec Change. The agreed model has two inputs: an OpenSpec Change
or a task-database context. The task database is not available in this change,
so the implementation must accept a generic context envelope without creating
or depending on a database.

The runner must be fast for ordinary work, usable outside Codex, and safe when
the agent supplies incomplete information. It must report evidence rather than
trust prose, but it must not become a file watcher or run the full CI suite for
every edit.

## Goals / Non-Goals

**Goals:**

- Provide a compact `docflow` skill that routes preflight and finalize work.
- Provide a project-local deterministic Node runner callable by any agent or CI.
- Accept optional `changeId`, `taskId`, `parentTaskId`, `files`, `intent`, and
  impact metadata without requiring either workflow source.
- Classify work as `quick`, `normal`, or `full` from deterministic signals and
  escalate uncertainty only to a bounded audit depth.
- Capture a baseline and final file manifest, produce compact JSON evidence, and
  fail closed when required governance decisions or checks are missing.
- Keep normative OpenSpec, current-state docs, ADR rationale, and Memory Bank
  responsibilities separate.
- Run targeted static checks and expose full CI as an explicit opt-in.

**Non-Goals:**

- Creating or defining the task database schema, API, or persistence service.
- Managing agent worktrees, merge queues, commits, or conflict resolution.
- Automatically publishing `adr.brai.one`.
- Inferring an architectural decision or rewriting OpenSpec from an unsupported
  implementation detail.
- Replacing the detailed documentation methodology or loading all project docs
  into every agent context.

## Decisions

### 1. Thin adapter, deterministic runner

`docflow` contains only the procedural route and source-selection rules. The
project-local `tools/docs/docflow.mjs` owns deterministic classification,
baseline/evidence handling, targeted checks, and finalization gates. A missing
skill therefore does not disable the repository workflow.

Alternatives considered:

- Keep all logic in the skill — rejected because other agents and CI would not
  share the enforcement layer.
- Put all documentation rules into `AGENTS.md` — rejected because it bloats the
  always-loaded context and duplicates source documents.

### 2. One context envelope for two work sources

The runner accepts a small JSON context with optional `source`, `taskId`,
`parentTaskId`, `changeId`, `intent`, `files`, and final governance decisions.
`source` may be `openspec`, `task-db`, or `direct`. The runner does not call a
task database and does not require a Change.

Alternatives considered:

- Require a Change for every durable task — rejected by the agreed DB-only
  workflow.
- Invent a task database adapter now — rejected because its API is a separate
  future task.

### 3. Bounded routing and checks

Hard signals for architecture, security, contracts, dependencies,
infrastructure, deployment, OpenSpec specs, and ADRs select `full`. Known
small edits select `quick`; ordinary source or documentation changes select
`normal`. Missing or conflicting hints select the next deeper audit level but
do not create an ADR or edit OpenSpec by themselves.

The runner performs local manifest/link checks for quick work, targeted project
checks for normal work, and all static documentation/specification checks for
full work. `pnpm run ci` is only run when explicitly requested by CI/release or
the context; it is never an unconditional per-edit hook.

### 4. Evidence and fail-closed finalization

Preflight stores a small baseline manifest for the relevant files. Finalize
compares hashes and records the result. Git diff is used when a valid repository
is available; otherwise the explicit file manifest and hashes are used. A
finalize context must state the docs, spec, and ADR decisions, including an
explicit reason for unchanged/not-required results. `pending-governance`,
`spec-drift`, and unresolved conflict statuses cannot finalize.

### 5. Source-of-truth routing

The runner and skill direct agents to the smallest relevant source set:

- current system behavior → reader-facing docs;
- required future behavior → permanent OpenSpec;
- why a significant choice exists → existing/new ADR;
- short handoff state → Memory Bank.

The skill first reuses an existing ADR, uses `supersedes` for a replacement, and
does not create duplicates. The runner validates structure and links; the agent
performs evidence-based prose synchronization.

### 6. Compatibility and progressive context

The new skill is named `docflow`. The old `documentation-governance` adapter is
kept as a short compatibility redirect so existing agent discovery does not
break. `AGENTS.md` remains a compact project kernel, while Memory Bank loading
starts with the README and active/progress summaries and expands by route.

## Risks / Trade-offs

- **[Risk]** An agent can provide an incomplete file manifest in a non-Git
  environment. → **Mitigation:** require baseline/evidence at finalize and fail
  closed when the manifest is missing; use valid Git diff when available.
- **[Risk]** Path-based classification misses a semantic behavior change. →
  **Mitigation:** accept intent/surface hints, escalate uncertainty, and require
  explicit no-impact decisions rather than silently closing.
- **[Risk]** Static checks may still be slow on a large repository. →
  **Mitigation:** route-specific checks, input hashes, and explicit CI opt-in.
- **[Risk]** Compatibility with the old skill can leave two names visible. →
  **Mitigation:** make `docflow` canonical and keep the old skill body as a
  redirect only.

## Migration Plan

1. Add the project-local runner and package entry point.
2. Update the project kernel, OpenSpec context, and permanent delta specs.
3. Install the short `docflow` skill and replace the old adapter with a
   compatibility redirect.
4. Run route and finalization scenarios without deploying or publishing ADRs.
5. Synchronize permanent specs and archive this Change after all checks pass.

Rollback is limited to restoring the previous project rules and using the
compatibility adapter; the runner writes only its local evidence state and does
not mutate production services.

## Open Questions

- The future task database must define the concrete context transport and how
  conflict tasks link to parent tasks. This change intentionally leaves that
  contract generic.
