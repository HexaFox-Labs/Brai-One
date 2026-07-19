# Delta for Agent Workflow

## ADDED Requirements

### Requirement: Natural-language task routing

The agent SHALL route ordinary user requests through the appropriate project
workflow without requiring the user to know OpenSpec, OPSX, or CLI command names.

#### Scenario: User requests a non-trivial implementation

- **WHEN** the user asks in natural language to add or change behavior, a
  contract, an access boundary, an infrastructure component, or a coordinated
  multi-file feature
- **THEN** the agent SHALL create or continue a matching active OpenSpec change
- **AND** the agent SHALL use the change as the durable source of truth while
  implementing the request

#### Scenario: User requests a trivial task

- **WHEN** the request is limited to a read-only investigation, an isolated
  typo/formatting correction, or a test-only change that does not change
  behavior or contracts
- **THEN** the agent MAY work without creating an OpenSpec change
- **AND** the agent SHALL state that no durable change was required

### Requirement: Agent-owned command execution

The agent SHALL execute required OpenSpec CLI commands and use generated
OpenSpec skills itself; the user SHALL NOT be required to enter `/opsx:*` or
`openspec ...` commands as a prerequisite for the requested work.

#### Scenario: Generated slash commands are unavailable

- **WHEN** a generated OpenSpec skill or chat command cannot be loaded
- **THEN** the agent SHALL continue by reading the project rules and writing the
  equivalent OpenSpec artifacts directly or by invoking the CLI in the terminal
- **AND** the agent SHALL report the integration limitation without blocking on
  a manual user command

### Requirement: Change lifecycle

The agent SHALL maintain the OpenSpec change lifecycle for every durable change.

#### Scenario: Work begins

- **WHEN** no matching active change exists
- **THEN** the agent SHALL create `proposal.md`, a delta spec, `design.md`, and
  `tasks.md` before implementation when the scope requires planning

#### Scenario: Implementation reveals a plan change

- **WHEN** implementation invalidates an assumption, requirement, or design
  decision
- **THEN** the agent SHALL update the relevant OpenSpec artifact before
  continuing implementation

#### Scenario: Verified implementation is complete

- **WHEN** all required tasks are implemented and relevant checks pass
- **THEN** the agent SHALL synchronize delta requirements into the permanent
  specs and archive the change for implementation requests
- **AND** the agent SHALL leave planning-only changes active

### Requirement: Project policy precedence

The agent SHALL apply the project rule and source-of-truth precedence before
following generated workflow instructions.

#### Scenario: Workflow instruction conflicts with project policy

- **WHEN** a generated skill, proposal, or design conflicts with `AGENTS.md`, a
  permanent OpenSpec requirement, or a higher-priority user instruction
- **THEN** the agent SHALL follow the higher-priority source
- **AND** the agent SHALL update the change artifact to record the constraint

### Requirement: Completion evidence

The agent SHALL report the selected change, artifacts, checks, and remaining
limitations after a durable task.

#### Scenario: Change cannot be completed

- **WHEN** validation, tests, required authority, or an external dependency
  prevents completion
- **THEN** the agent SHALL keep the change unarchived
- **AND** the agent SHALL report the concrete blocker and the next safe action
