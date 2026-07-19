## Context

Brai New is a TypeScript/pnpm/Nx monorepo with repository-wide ESLint,
TypeScript strict mode and a pinned Prettier dependency. The project already
uses progressive context and `docflow`; the new standard must add a compact
code-specific layer without copying a long style guide into `AGENTS.md` or a
skill.

## Goals / Non-Goals

**Goals:**

- Make formatting and mechanical quality checks deterministic and CI-enforced.
- Keep the always-loaded agent instructions short.
- Put detailed examples in one reader-facing reference and normative behavior
  in a small OpenSpec capability.
- Establish TSDoc/comment rules that do not require comments for obvious
  private code.
- Keep the implementation dependency-free by using the existing tooling.

**Non-Goals:**

- No runtime, API, access-boundary or deployment behavior changes.
- No semantic refactor or opportunistic cleanup. A one-time mechanical
  formatting pass over active hand-written files is allowed so the new CI gate
  has a clean baseline.
- No mandatory type-aware ESLint rollout or API documentation generator yet;
  those can be introduced by a separate measured change.
- No large duplicated agent prompt.

## Decisions

1. **Canonical layers.** `openspec/specs/code-quality/spec.md` defines
   enforceable intent, `docs/reference/code-style.md` explains current rules,
   `AGENTS.md` contains only a short pointer and kernel, and the portable
   project-local router under `tools/agent/` is a thin task router. This follows
   the existing source-of-truth and progressive-disclosure model.
2. **Formatting.** Add `.editorconfig` and explicit `.prettierrc.json` using
   the current repository style: UTF-8, LF, two spaces, semicolons, double
   quotes, trailing commas and the existing 80-column wrapping target. Prettier remains
   the formatter; ESLint does not duplicate formatting rules.
3. **Enforcement.** Add `format` and `format:check` scripts. The CI runner
   invokes `format:check` before the existing Nx quality targets. Existing
   lint and strict typecheck remain the mechanical enforcement for code.
4. **Comments.** Public or contract-facing exports use TSDoc when a consumer
   needs behavior, constraints, errors, deprecation or examples. Internal
   comments explain why, invariants, security constraints or external
   workarounds. Obvious private implementation needs no comment.
5. **Generated material.** Existing generated OpenSpec skills remain outside
   the repository formatting baseline. The new portable router is hand-written
   and is checked by the repository formatter.
6. **ADR.** No ADR is required: this change does not introduce a runtime
   architecture, access boundary, deployment service or new dependency; the
   durable contract is the OpenSpec capability and its enforcement.

## Risks / Trade-offs

- **[Risk]** A repository-wide format check can expose old formatting drift. →
  **Mitigation:** exclude generated/archive material, perform one mechanical
  baseline pass, and let future touched files converge through Prettier.
- **[Risk]** Semantic comment quality cannot be fully decided by a formatter. →
  **Mitigation:** keep the rule compact and reviewable, enforce syntax and
  mechanical gates automatically, and let the agent skill surface the rule.
- **[Risk]** The baseline formatting pass can create unrelated-looking churn.
  → **Mitigation:** it is mechanical only, active hand-written files are
  checked by the new gate, and generated/archive material is excluded.
