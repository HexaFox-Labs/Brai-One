## 1. OpenSpec and catalog foundation

- [x] 1.1 Add the permanent `tooling-catalog` capability specification and
      validate its schema/scenarios.
- [x] 1.2 Define the canonical manifest schema, allowed categories, generated
      file boundaries, and initial RTK record.

## 2. Generator and validation

- [x] 2.1 Implement deterministic manifest validation and Markdown/JSON
      generation under `tools/stack/` without adding a runtime dependency.
- [x] 2.2 Add `stack:generate`, `stack:check`, and focused Node tests for
      completeness, classification, parity, links, and secret exclusion.
- [x] 2.3 Run stack validation from the repository CI/documentation gate.

## 3. Reader-facing catalog

- [x] 3.1 Generate the first RTK mini-landing page, category index, and
      web-ready JSON catalog.
- [x] 3.2 Update `docs/stack/README.md`, `docs/reference/commands.md`, and the
      stack entry template with the new source-of-truth workflow.
- [x] 3.3 Add a how-to explaining how installation/upgrade entries are added and
      regenerated, including the RTK example.

## 4. Governance and verification

- [x] 4.1 Update Memory Bank with the catalog architecture, RTK registration,
      checks, and remaining scope for future site UI.
- [x] 4.2 Run format, stack/docs/ADR checks, relevant tests, lint/typecheck, and
      strict OpenSpec validation.
- [x] 4.3 Run docflow finalize with evidence and record the ADR result.
