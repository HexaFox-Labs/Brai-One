## ADDED Requirements

### Requirement: Local codebase intelligence is continuously maintained
The system SHALL maintain local Graphify and SocratiCode layers without manual
start, indexing or refresh. Relevant source/configuration changes SHALL refresh
the code-only Graphify graph and SocratiCode code/context indices, while their
generated outputs MUST NOT recursively trigger refreshes.

#### Scenario: Host restart or routine service failure
- **WHEN** a managed service restarts, becomes inactive or reports stale state
- **THEN** systemd and an independent health timer reconcile or restart it
- **AND** checkpointed SocratiCode indexing resumes without manual action

### Requirement: Agent retrieval follows graph-first semantic resolution
The Codex integration SHALL use Graphify first for non-trivial structural
discovery and SocratiCode second for current semantic fragments, context
artifacts or dependency data. A degraded layer MUST NOT block work through the
remaining healthy layer.

#### Scenario: Healthy discovery session
- **WHEN** an agent begins non-trivial codebase discovery
- **THEN** it asks Graphify for a scoped structural map before broad raw search
- **AND** asks SocratiCode for relevant semantic context before targeted reads

### Requirement: Graphify remains code-only and standard
Graphify SHALL exclude documentation, OpenSpec, Memory Bank and generated
output from its code graph. Its protected browser route SHALL serve Graphify's
generated standard viewer with locally served required assets; a custom viewer
MUST NOT replace it without Sergey Bright's explicit approval.

#### Scenario: Documentation corpus exists
- **WHEN** documentation grows
- **THEN** it remains available as SocratiCode context artifacts
- **AND** it does not create Graphify graph nodes

### Requirement: Host services are narrow and lifecycle-recorded
Operational Graphify/SocratiCode services SHALL run as `mark:mark` with narrow
checkout/state access and loopback-only endpoints. The root health oneshot MAY
invoke systemd recovery only. Tool lifecycle changes SHALL synchronize the host
registry and canonical catalog without secrets.

#### Scenario: Public Graphify request
- **WHEN** a browser reaches `codegraph.brai.one`
- **THEN** Caddy applies unified Basic Auth and TLS before its loopback proxy
- **AND** no Graphify, Qdrant or Ollama port is directly public
