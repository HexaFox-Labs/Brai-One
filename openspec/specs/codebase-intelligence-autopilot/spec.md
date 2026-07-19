# Codebase Intelligence Autopilot Specification

## Purpose

Определяет постоянный local-only слой Graphify и SocratiCode для Brai New,
его unattended lifecycle, агентский retrieval order и protected Graphify viewer.

## Requirements

### Requirement: Local codebase intelligence is continuously maintained

The system SHALL maintain a local Graphify code graph and SocratiCode semantic
index for the Brai New checkout without a user or agent manually starting,
indexing or refreshing either layer.

#### Scenario: Code or context changes

- **WHEN** relevant source/configuration changes in the checkout
- **THEN** Graphify refreshes its code-only graph and SocratiCode refreshes its
  code index and declared context artifacts
- **AND** generated output does not recursively trigger either refresh

#### Scenario: Host restart or routine service failure

- **WHEN** a managed service restarts, becomes inactive or reports stale state
- **THEN** systemd and the independent health timer reconcile or restart it
- **AND** checkpointed SocratiCode indexing resumes without manual action

### Requirement: Retrieval is layered and fails open

Agents SHALL use Graphify first for non-trivial structural discovery and
SocratiCode second for current semantic fragments, context artifacts or
dependency information. A degraded layer MUST NOT block implementation when
the other layer is healthy.

#### Scenario: Healthy discovery

- **WHEN** an agent starts non-trivial discovery
- **THEN** it asks Graphify for a scoped structural map before broad raw search
- **AND** it asks SocratiCode for the relevant semantic context before targeted
  source reads

#### Scenario: One layer is degraded

- **WHEN** a Graphify or SocratiCode status record is degraded
- **THEN** the agent continues through the healthy layer
- **AND** the background recovery loop records and attempts repair

### Requirement: Graphify stays code-only and uses its standard viewer

Graphify SHALL exclude documentation, OpenSpec, Memory Bank and generated
output from its code graph. Its published viewer SHALL be Graphify's generated
standard HTML, with required browser assets served locally; it MUST NOT be
replaced with a custom viewer without Sergey Bright's explicit approval.

#### Scenario: Documentation corpus exists

- **WHEN** project documentation grows
- **THEN** it remains available through SocratiCode context artifacts
- **AND** it does not create Graphify graph nodes

#### Scenario: Browser opens Graphify

- **WHEN** an authenticated browser reaches `codegraph.brai.one`
- **THEN** Caddy terminates TLS and unified Basic Auth before proxying only to
  loopback services
- **AND** the route serves Graphify's generated standard viewer

### Requirement: Code-intelligence host access is narrow and observable

Graphify and SocratiCode operational services SHALL run as `mark:mark` with
only checkout/output/state access and loopback listeners. The root-owned health
oneshot MAY invoke systemd recovery only; it MUST NOT read project secrets or
open a listener.

#### Scenario: Service starts

- **WHEN** an operational code-intelligence service starts
- **THEN** it has resource limits and restrictive filesystem boundaries
- **AND** Qdrant, Ollama and Graphify MCP remain non-public

#### Scenario: Tool lifecycle changes

- **WHEN** Graphify or SocratiCode is installed, upgraded, moved or removed
- **THEN** `/home/mark/DEPLOYMENT.md`, the canonical stack catalog and generated
  stack pages are synchronized without secrets
- **AND** lifecycle and documentation checks complete before the change closes
