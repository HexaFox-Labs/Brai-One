## MODIFIED Requirements

### Requirement: Documentation governance includes ADR impact

The project documentation workflow SHALL evaluate ADR impact for every
non-trivial change from either an OpenSpec Change or a task-database context.
The evaluation SHALL record whether an existing ADR is updated, a replacement
ADR is linked with `supersedes`, a new ADR is created, or no ADR is required
with an explicit reason.

#### Scenario: Architectural change with an OpenSpec Change

- **WHEN** an active OpenSpec Change changes architecture, security,
  infrastructure, a durable dependency, data ownership, or a public contract
- **THEN** the agent evaluates ADR impact before declaring the Change complete
- **AND** it reuses or creates the focused ADR for the durable decision
- **AND** it links the ADR and OpenSpec capability to each other

#### Scenario: Architectural change with a task-database context

- **WHEN** a task-database task changes an ADR-required surface without an
  OpenSpec Change
- **THEN** the same ADR evaluation and final report are required
- **AND** the task database context provides the evidence and decision links

#### Scenario: Small change without ADR impact

- **WHEN** a change is limited to formatting, a typo, or an internal refactor
  with no decision or behavior change
- **THEN** the governance report records that no ADR is required
- **AND** it gives the reason without creating an empty ADR

### Requirement: Missing Change can be handled by the task context

When durable behavior already changed without an active OpenSpec Change, the
documentation governance workflow SHALL perform an evidence-based backfill in
the active work context. The workflow MAY update permanent OpenSpec directly
when the task-database context is the selected work envelope; it SHALL NOT
invent unsupported requirements or force creation of a Change solely for
governance identity.

#### Scenario: Durable implementation without Change

- **WHEN** the agent finds a durable implementation with no matching active
  Change and has a task-database or direct task context
- **THEN** it derives claims from code, tests, configuration, and verified host
  state
- **AND** it records the implementation as implemented/tested/installed or
  production-verified only when evidence supports that status
- **AND** it reports the affected OpenSpec, docs, and ADR decisions

#### Scenario: Direct task without a durable work record

- **WHEN** a user gives a direct implementation request without a Change or
  task-database identifier
- **THEN** the agent creates a lightweight task context automatically
- **AND** it does not create an OpenSpec Change merely to obtain an identifier

### Requirement: Governance is callable by any project agent

The governance workflow SHALL be documented in the compact project rules and
SHALL have a deterministic project-local `docflow` runner callable by Codex,
another coding agent, or CI. The Codex skill MAY orchestrate reasoning and
document synchronization but SHALL not be the only enforcement mechanism.

#### Scenario: Agent source differs

- **WHEN** the task is performed outside Codex Desktop
- **THEN** the project agent can discover the governance rules from `AGENTS.md`
  and project documentation
- **AND** it can run the same repository checks without a Codex-specific slash
  command

### Requirement: Governance uses bounded routes

The workflow SHALL classify work as `quick`, `normal`, or `full` from task
context and deterministic file/surface signals. Uncertainty SHALL increase
audit depth by at most one level and SHALL NOT alone create an ADR or change
OpenSpec.

#### Scenario: Trivial edit

- **WHEN** the work is a typo, formatting-only edit, or test-only change with
  no behavior or contract impact
- **THEN** the workflow uses the quick route and targeted checks
- **AND** it does not run the full project CI suite

#### Scenario: High-impact surface

- **WHEN** the work affects architecture, security, contracts, dependencies,
  infrastructure, deployment, permanent specs, or ADRs
- **THEN** the workflow uses the full route
- **AND** it runs the relevant static specification/documentation checks
- **AND** it requests full CI only when the task or CI/release context requires
  it

### Requirement: Governance synchronizes the correct source of truth

The workflow SHALL update reader-facing documentation for verified current-state
changes, SHALL update permanent OpenSpec only when normative behavior or a
contract changes, and SHALL update or link an ADR only for a durable decision.
It SHALL prefer one canonical source per fact and link other audience-specific
documents to it.

#### Scenario: Behavior changes within an existing normative contract

- **WHEN** implementation changes the current system behavior or architecture
  without changing the normative contract
- **THEN** the workflow updates the relevant reader-facing documentation
- **AND** it records that OpenSpec remains unchanged with a reason

#### Scenario: Normative behavior changes

- **WHEN** required future behavior, a contract, an invariant, or a boundary
  changes
- **THEN** the workflow updates the permanent OpenSpec requirement
- **AND** it updates affected current-state documentation
- **AND** it evaluates ADR impact separately

#### Scenario: Code drifts from OpenSpec

- **WHEN** code, tests, or runtime evidence disagrees with a permanent OpenSpec
  requirement
- **THEN** the workflow records `spec-drift`
- **AND** it does not rewrite OpenSpec automatically to match the code
- **AND** a higher-level agent must choose between fixing the code and changing
  the normative requirement

### Requirement: Finalization is evidence-based and fail-closed

The workflow SHALL capture a preflight baseline and a compact structured result
containing route, sources, actions, checks, blockers, status, and evidence
links. Finalization SHALL require explicit docs, OpenSpec, and ADR outcomes
where applicable, including a reason for unchanged/not-required outcomes.

#### Scenario: Complete task

- **WHEN** implementation, required synchronization, and relevant checks have
  completed with evidence
- **THEN** the workflow reports the final decisions and allows the task or
  Change to close

#### Scenario: Missing governance evidence

- **WHEN** the agent cannot prove the required documentation, specification,
  ADR, or checks are complete
- **THEN** the workflow leaves the task open in `pending-governance` or
  `blocked`
- **AND** it reports the precise missing evidence

#### Scenario: Partial implementation

- **WHEN** code or documentation work is partially complete but a check or
  decision fails
- **THEN** the workflow preserves the useful changes and evidence
- **AND** it leaves the task open for continuation

### Requirement: Governance preserves performance and progressive context

The workflow SHALL keep the skill and always-loaded project kernel compact. It
SHALL load thematic Memory Bank and project sources only when selected by the
task route, SHALL cache unchanged check inputs, and SHALL not run a full CI
suite for every edit.

#### Scenario: Ordinary task

- **WHEN** the task is on the quick or normal route
- **THEN** governance checks complete using targeted project sources and checks
- **AND** they do not load or print the entire documentation corpus

#### Scenario: Full task

- **WHEN** the task is on the full route or an explicit CI/release check is
  requested
- **THEN** the workflow expands the source and check set once for the relevant
  finalization
- **AND** it records the actual check results and duration-relevant blockers
