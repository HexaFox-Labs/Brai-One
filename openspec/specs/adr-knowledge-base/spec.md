# adr-knowledge-base Specification

## Purpose

Defines the Brai New ADR source boundary, reproducible Log4brains installation,
record metadata contract, and the distinction between ADR rationale and
normative OpenSpec behavior.

## Requirements

### Requirement: Brai New owns a separate ADR source

Brai New SHALL keep its Architecture Decision Records in the project-local
`docs/decisions/` directory and SHALL treat that directory as the source for
the Log4brains site. The initial Brai New catalog SHALL NOT import or copy ADR
records, generated output, or runtime data from the legacy Brai project.

#### Scenario: Clean ADR initialization

- **WHEN** the ADR system is initialized in Brai New
- **THEN** the generated catalog contains only records present in Brai New
  `docs/decisions/`
- **AND** no file from `/srv/projects/brai/docs/adr` is copied into the new
  project

#### Scenario: Existing Brai New decision remains visible

- **WHEN** Log4brains builds the Brai New catalog
- **THEN** the existing Brai New documentation decision is listed as an ADR
- **AND** its source remains the Brai New repository file

### Requirement: Log4brains is reproducibly available to the project

The project SHALL pin Log4brains as a local development dependency in the pnpm
workspace and SHALL configure it for `Etc/UTC` and `./docs/decisions`. The
project SHALL expose agent-runnable scripts for listing, previewing, building,
and checking ADRs without requiring the user to install a global Log4brains
binary.

#### Scenario: Locked installation

- **WHEN** a clean checkout runs `pnpm install --frozen-lockfile`
- **THEN** the pinned Log4brains dependency is installed from the lockfile
- **AND** the ADR scripts resolve the project-local binary

#### Scenario: ADR command suite

- **WHEN** an agent needs to inspect or build ADRs
- **THEN** it can run the project scripts for `adr:list`, `adr:preview`,
  `adr:build`, and `adr:check`
- **AND** those scripts do not require the user to type internal workflow
  commands

### Requirement: ADR records preserve decision metadata

Each active ADR source file SHALL describe one architectural decision and SHALL
contain status, deciders, date, tags, context, decision, alternatives,
consequences, verification, and links. Log4brains-compatible filenames and
statuses SHALL be used. An ADR SHALL explain rationale and trade-offs but SHALL
not replace the normative OpenSpec contract.

#### Scenario: Valid ADR record

- **WHEN** `adr:check` examines an ADR source file
- **THEN** it accepts the file only when the required metadata and decision
  sections are present
- **AND** it reports the exact file and missing section for an invalid record

#### Scenario: Normative behavior changes

- **WHEN** a decision changes required system behavior or an architectural
  invariant
- **THEN** the agent also updates or creates the relevant OpenSpec capability
- **AND** the ADR links to the OpenSpec source of truth
