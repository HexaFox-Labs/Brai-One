## ADDED Requirements

### Requirement: Documentation governance includes ADR impact

The project documentation workflow SHALL evaluate ADR impact for every
non-trivial change. The evaluation SHALL record whether the change needs a new
ADR, updates an existing ADR, or explicitly needs no ADR with a reason.

#### Scenario: Architectural change with an active Change

- **WHEN** an active OpenSpec Change changes architecture, security,
  infrastructure, a durable dependency, data ownership, or a public contract
- **THEN** the agent evaluates ADR impact before declaring the Change complete
- **AND** it creates or updates one ADR when the decision is durable
- **AND** it links the ADR and OpenSpec capability to each other

#### Scenario: Small change without ADR impact

- **WHEN** a change is limited to formatting, a typo, or an internal refactor
  with no decision or behavior change
- **THEN** the governance report records that no ADR is required
- **AND** it gives the reason without creating an empty ADR

### Requirement: Missing Change can be backfilled from evidence

When durable behavior already changed without an active OpenSpec Change, the
documentation governance workflow SHALL perform an evidence-based backfill.
It SHALL distinguish implemented behavior from planned behavior and SHALL not
invent unsupported requirements or architectural decisions.

#### Scenario: Durable implementation without Change

- **WHEN** the agent finds a durable implementation with no matching active
  Change
- **THEN** it creates a backfill Change or equivalent durable record
- **AND** it derives claims from code, tests, configuration, and verified host
  state
- **AND** it records the implementation as backfilled/implemented rather than
  as an unimplemented plan

### Requirement: Governance is callable by any project agent

The governance workflow SHALL be documented in project rules and SHALL have a
deterministic project-local check that can be called by Codex, another coding
agent, or CI. A Codex skill MAY orchestrate reasoning and updates but SHALL
not be the only enforcement mechanism.

#### Scenario: Agent source differs

- **WHEN** the task is performed outside Codex Desktop
- **THEN** the project agent can discover the governance rules from
  `AGENTS.md` and project documentation
- **AND** it can run the same repository checks without a Codex-specific slash
  command
