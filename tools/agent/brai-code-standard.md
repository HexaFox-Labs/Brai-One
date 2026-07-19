# Brai code standard router

Use this compact router for code, test or code-configuration work.

1. Read [`docs/reference/code-style.md`](../../docs/reference/code-style.md);
   treat [`openspec/specs/code-quality/spec.md`](../../openspec/specs/code-quality/spec.md)
   as normative.
2. Keep comments focused on why, invariants, security constraints and external
   workarounds. Use TSDoc for non-obvious public or contract-facing exports.
3. Do not add commented-out code, ownerless TODOs or unexplained lint
   suppressions.
4. Run `pnpm run format:check`, relevant lint/typecheck targets and tests.
5. If creating a commit, use Conventional Commits and keep it logically atomic.
6. Report skipped checks and evidence; do not copy the full reference into the
   task context.

This file is a portable project-local skill source for agents that cannot load
the Codex skill catalog. `AGENTS.md`, the reference and OpenSpec remain the
canonical entry points.
