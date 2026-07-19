## Why

Brai New already has TypeScript strict mode, ESLint and Prettier, but their
usage is not yet described as one compact standard for people and coding
agents. Without a canonical source, formatting, comments and quality checks
can drift while agents are working rapidly.

## What Changes

- Add a small normative `code-quality` capability for source formatting,
  lint/type checks, comments, TSDoc and agent workflow.
- Add a reader-facing reference with the complete rules and examples.
- Add a short project-local agent router that can be registered as a skill by
  environments with a writable skill catalog, without duplicating the
  reference in every context.
- Add explicit EditorConfig and Prettier configuration plus a format check.
- Make the repository CI run the format check alongside existing quality gates.
- Keep documentation and enforcement compact; do not require comments for
  obvious private implementation code.

## Capabilities

### New Capabilities

- `code-quality`: Canonical code style, documentation-comment rules and
  automated quality gates for Brai New source changes.

### Modified Capabilities

- None.

## Impact

- Repository configuration: `.editorconfig`, Prettier scripts and CI runner.
- Agent entry points: `AGENTS.md` and a small project-local router.
- Reader-facing documentation: `docs/reference/code-style.md` and its index.
- Normative OpenSpec: new `openspec/specs/code-quality/spec.md`.
- No runtime API, access boundary, deployment service or external dependency
  is changed.
