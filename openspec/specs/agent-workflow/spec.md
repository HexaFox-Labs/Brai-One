# agent-workflow Specification

## Purpose

Определяет обязательный workflow, по которому агент маршрутизирует
естественно-языковые задачи через OpenSpec или task context без требования к
пользователю вводить внутренние CLI или slash-команды.

## Requirements

### Requirement: Natural-language task routing

The agent SHALL route ordinary user requests through the appropriate project
workflow without requiring the user to know OpenSpec, OPSX, CLI command names,
or task-database internals. The selected work envelope MAY be an OpenSpec Change,
a task-database task, or an automatically created lightweight task context.

#### Scenario: User requests a non-trivial implementation

- **WHEN** the user asks in natural language to add or change behavior, a
  contract, an access boundary, an infrastructure component, or a coordinated
  multi-file feature
- **THEN** the agent creates or continues the selected work context
- **AND** it runs `docflow` before and after implementation
- **AND** it uses an OpenSpec Change only when that route is selected or useful

#### Scenario: User requests a trivial task

- **WHEN** the request is limited to a read-only investigation, an isolated
  typo/formatting correction, or a test-only change that does not change
  behavior or contracts
- **THEN** the agent MAY work with a lightweight temporary context
- **AND** it runs the quick governance route
- **AND** it states that no durable OpenSpec Change was required

### Requirement: Agent-owned command execution

The agent SHALL execute required OpenSpec and `docflow` commands itself; the
user SHALL NOT be required to enter `/opsx:*`, `openspec ...`, or project
governance commands as a prerequisite for the requested work.

#### Scenario: Generated slash commands are unavailable

- **WHEN** a generated OpenSpec skill or chat command cannot be loaded
- **THEN** the agent SHALL continue by reading the project rules and writing the
  equivalent OpenSpec artifacts directly or by invoking the CLI in the terminal
- **AND** it SHALL report the integration limitation without blocking on a
  manual user command

### Requirement: Change lifecycle

The agent SHALL maintain the OpenSpec Change lifecycle when a Change is the
selected work envelope. It SHALL NOT create or archive a Change solely because
documentation governance needs a task identity.

#### Scenario: Work begins through OpenSpec

- **WHEN** no matching active Change exists and the OpenSpec route is selected
- **THEN** the agent SHALL create `proposal.md`, a delta spec, `design.md`, and
  `tasks.md` before implementation when the scope requires planning

#### Scenario: Work begins through task database

- **WHEN** the task-database route is selected
- **THEN** the agent SHALL keep the task database as the work context
- **AND** it SHALL apply the same governance, documentation, ADR, and evidence
  requirements without requiring a Change

#### Scenario: Verified implementation is complete

- **WHEN** all required work-context tasks are implemented and relevant checks
  pass
- **THEN** the agent SHALL synchronize the required permanent sources
- **AND** it SHALL archive a selected OpenSpec Change only when one exists and
  the request is an implementation request

### Requirement: Project policy precedence

The agent SHALL apply the project rule and source-of-truth precedence before
following generated workflow instructions.

#### Scenario: Workflow instruction conflicts with project policy

- **WHEN** a generated skill, proposal, or design conflicts with `AGENTS.md`, a
  permanent OpenSpec requirement, or a higher-priority user instruction
- **THEN** the agent SHALL follow the higher-priority source
- **AND** it SHALL update the change artifact to record the constraint

### Requirement: Completion evidence

The agent SHALL report the selected work source, route, artifacts, checks,
evidence, ADR decision, and remaining limitations after a durable task.

#### Scenario: Change cannot be completed

- **WHEN** validation, tests, required authority, or an external dependency
  prevents completion
- **THEN** the agent SHALL keep the selected work context open
- **AND** it SHALL report the concrete blocker and the next safe action

#### Scenario: Documentation decision is pending

- **WHEN** code implementation is complete but a required documentation,
  specification, or ADR decision is not resolved
- **THEN** the agent MAY preserve the implementation in `pending-governance`
- **AND** it SHALL NOT close the parent work context

### Requirement: Durable changes include ADR impact review

The agent SHALL run the project `docflow` workflow before finishing a durable
task from either work source and SHALL include its ADR decision in the final
evidence. A durable task SHALL NOT close while required ADR work or the explicit
no-ADR rationale is missing.

#### Scenario: Change with an architectural decision

- **WHEN** a durable task introduces or changes an architectural decision
- **THEN** the agent creates, updates, or supersedes the corresponding ADR
- **AND** the final report links the ADR, normative OpenSpec capability when
  applicable, and verification

#### Scenario: Task with no ADR requirement

- **WHEN** a task is reviewed and no new architectural decision is introduced
- **THEN** the agent records an explicit no-ADR rationale
- **AND** the task can proceed only after normal documentation checks pass
