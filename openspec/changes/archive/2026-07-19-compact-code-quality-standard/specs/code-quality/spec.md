## ADDED Requirements

### Requirement: Hand-written source uses canonical formatting

Brai New hand-written source and project documentation SHALL use the checked-in
EditorConfig and Prettier configuration. Generated OpenSpec skill files MAY be
excluded when they are outside the repository's existing formatting baseline.

#### Scenario: Formatting is checked

- **WHEN** a code or documentation change is submitted
- **THEN** `pnpm run format:check` checks the repository formatting scope
- **AND** the check fails when a checked-in file differs from canonical output

#### Scenario: Editor defaults are consistent

- **WHEN** an agent or developer opens a hand-written project file
- **THEN** the repository configuration declares UTF-8, LF line endings and
  two-space indentation

### Requirement: Code quality gates remain automated

The repository SHALL keep ESLint, strict TypeScript checking and relevant tests
as automated quality gates. ESLint configuration SHALL focus on correctness and
maintainability rather than competing with Prettier's formatting decisions.

#### Scenario: CI runs the quality gates

- **WHEN** the repository CI workflow runs
- **THEN** formatting, lint, typecheck and tests are executed before completion
- **AND** a failed required gate makes the workflow fail

#### Scenario: Local agent validates a focused change

- **WHEN** an agent finishes a code change
- **THEN** it runs the relevant format, lint, typecheck and test commands
- **AND** it reports any skipped check and its reason

### Requirement: Comments document intent and public contracts

Comments SHALL add information that is not already obvious from names, types
and control flow. Implementation comments SHALL explain intent, invariants,
security constraints, external limitations or non-obvious trade-offs. Public
or contract-facing exports SHALL use TSDoc when consumers need behavior,
constraints, errors, deprecation guidance or examples.

#### Scenario: Obvious private code is implemented

- **WHEN** a private function or local expression is clear from its name, type
  and implementation
- **THEN** no comment is required

#### Scenario: A non-obvious invariant is implemented

- **WHEN** code relies on a security boundary, ordering rule, external quirk,
  compatibility workaround or invariant
- **THEN** the code includes a concise comment explaining why the rule exists

#### Scenario: A public API is documented

- **WHEN** a public export has non-obvious behavior, errors, constraints,
  deprecation state or a usage example
- **THEN** its `/** ... */` comment uses compatible TSDoc tags as needed

### Requirement: Agent context stays progressive and compact

The project SHALL expose the code-quality standard through a short mandatory
agent kernel, one detailed reference, and a thin optional skill/router. The
kernel and skill/router SHALL link to the canonical documents instead of
duplicating the full style guide.

#### Scenario: Agent starts a code task

- **WHEN** an agent changes source code, tests or code configuration
- **THEN** it follows the compact kernel and loads the detailed reference only
  for the code task
- **AND** it applies the repository quality commands before finalizing

#### Scenario: A non-code task is handled

- **WHEN** an agent performs an unrelated read-only or non-code task
- **THEN** it is not required to load the full code-style reference

### Requirement: Quality exceptions are explicit

Intentional exceptions SHALL be narrow, documented and reviewable. ESLint
suppression comments SHALL state the reason on the same line. Commented-out
production code and ownerless TODO markers SHALL NOT be added.

#### Scenario: A lint rule is suppressed

- **WHEN** a local exception is necessary
- **THEN** the suppression names the rule and includes a concise reason
- **AND** the suppression applies to the smallest practical scope

#### Scenario: Deferred work is recorded

- **WHEN** a code comment records unfinished work
- **THEN** it uses `TODO(<task-or-issue>): <action>` with an actionable task
- **AND** it does not contain a block of disabled old implementation code

### Requirement: Agent-created commits are machine-readable

When an agent creates a Git commit, the commit subject SHALL follow the
Conventional Commits structure with a type, optional scope and short summary.

#### Scenario: Agent creates a normal commit

- **WHEN** an agent commits a completed logical change
- **THEN** the subject uses a supported type such as `feat`, `fix`, `docs`,
  `refactor`, `test`, `build`, `ci` or `chore`
- **AND** the subject describes one logical change

#### Scenario: Agent creates a breaking commit

- **WHEN** a commit changes a public contract incompatibly
- **THEN** the subject uses `!` or a `BREAKING CHANGE:` footer
