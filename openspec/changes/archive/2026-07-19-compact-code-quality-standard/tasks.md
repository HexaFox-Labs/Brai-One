## 1. Repository formatting and quality gates

- [x] 1.1 Add compact `.editorconfig` and explicit `.prettierrc.json` matching
      the current TypeScript repository style.
- [x] 1.2 Add `format` and `format:check` package scripts and exclude only the
      existing generated OpenSpec skill bundle from the formatting baseline.
- [x] 1.3 Run `format:check` from `tools/ci/run.mjs` before the existing Nx
      lint, typecheck, build and test targets.

## 2. Canonical documentation and agent routing

- [x] 2.1 Add `docs/reference/code-style.md` with compact rules for formatting,
      naming, TypeScript, comments/TSDoc, exceptions, tests and checks.
- [x] 2.2 Add the code-style reference to `docs/reference/README.md` and the
      compact code-task kernel to `AGENTS.md`.
- [x] 2.3 Add a short portable `tools/agent/brai-code-standard.md` router that
      can be registered as a skill without duplicating the canonical reference.

## 3. Normative source and checks

- [x] 3.1 Validate the new OpenSpec delta and sync `code-quality` into the
      permanent `openspec/specs/code-quality/spec.md`.
- [x] 3.2 Add focused tests or deterministic checks for the new format script,
      agent entry point and documentation links where existing tooling allows.

## 4. Governance and completion

- [x] 4.1 Run targeted Markdown, ADR and OpenSpec checks plus relevant lint,
      typecheck and tests; record baseline failures separately.
- [x] 4.2 Update Memory Bank with the accepted compact standard and evidence.
- [x] 4.3 Run `docflow finalize`, confirm ADR is not required with a reason, and
      archive the completed Change after all tasks and checks pass.
