# gitflow-affected-delivery Specification

## Purpose

Определяет быстрый delivery-контур Brai New: Nx affected checks, immutable OCI
images, Git Flow promotion и изолированные preview slots.

## Requirements

### Requirement: Delivery classifies exact affected runtime scope

The delivery system SHALL derive affected Nx projects from the exact commit and
its merge base, expand them through a checked-in runtime dependency catalog,
and run only required checks. Documentation-only changes SHALL NOT build runtime
images, create a preview or run runtime test suites. Unknown or shared delivery
inputs MUST use a conservative policy and MUST NOT be treated as documentation.

#### Scenario: Web-only change

- **WHEN** a commit affects only the `web` runtime project and no shared
  catalog, lockfile or contract input
- **THEN** CI builds and tests the affected web closure only
- **AND** the manifest reuses every unchanged service image digest

#### Scenario: Documentation-only change

- **WHEN** a commit changes only classified documentation files
- **THEN** CI runs reduced documentation checks only
- **AND** no preview slot, runtime image build or deployment is created

### Requirement: Git Flow promotion is protected and revision exact

The system SHALL use `dev` as the integration branch, `release/*` as a frozen
release-candidate branch and `main` as production history. Runtime changes MUST
receive a green preview and explicit acceptance of the deployed revision before
GitHub auto-merge can be enabled. Production MUST be promoted only by an
explicit protected release action after release checks are green. A runtime
delivery check SHALL remain green only after its health-gated controller result
and exact target manifest have both been persisted; its job MUST authenticate
to GHCR before publishing either Dev or Preview/release manifest.

#### Scenario: Accepted feature revision merges to dev

- **WHEN** Sergey accepts a green runtime preview revision and required checks
  remain green
- **THEN** GitHub native auto-merge may merge that exact pull request to `dev`
- **AND** the dev manifest deploys only affected image changes

#### Scenario: Preview manifest persistence fails after a healthy deploy

- **WHEN** a Preview/release controller deployment is healthy but its exact
  manifest cannot be persisted in GHCR
- **THEN** the delivery check fails and the revision cannot merge or promote
- **AND** the already activated preview remains intact for diagnosis

#### Scenario: Main receives an ordinary push

- **WHEN** an ordinary push reaches `main`
- **THEN** no production deployment is performed solely because of that push
- **AND** production remains on its prior healthy manifest until promotion

### Requirement: Preview slots are isolated, ordered and recoverable

The system SHALL allocate a qualifying runtime branch the lowest free slot from
`p01` through `p20`, retain branch ownership through a lease generation, and
use release-priority FIFO queuing when capacity is unavailable. Each slot MUST
use `pNN-brai-*` containers, a separate database identity seeded from the
latest verified dev snapshot, an isolated network and a protected Caddy route.
The data-only snapshot SHALL omit migration ledgers and immutable
migration-owned seed records, which the preview recreates through its checked
migrations before restoring runtime data.

#### Scenario: Lowest free slot is selected

- **WHEN** `p02` and `p03` are occupied while `p01` is free
- **THEN** the next qualifying branch receives `p01`
- **AND** its containers are named with the `p01-brai-` prefix

#### Scenario: Preview update fails checks

- **WHEN** a newer branch commit fails its required checks or image build
- **THEN** no slot data, manifest or running preview is overwritten
- **AND** an existing preview continues serving its last green revision

### Requirement: Deployment artifacts and storage remain bounded

The production host MUST receive only digest-pinned images and manifest data,
never a checkout, `node_modules`, Gradle cache, build output or source backup.
The system SHALL enforce preview data/log budgets, bounded image retention and
a host free-space admission floor. Cleanup MUST target only controller-owned
inactive resources and MUST NOT use a broad global prune.

#### Scenario: Preview branch closes

- **WHEN** a preview branch is closed or deleted
- **THEN** the controller stops only that lease's prefixed containers and
  deletes only that slot's data
- **AND** shared active images, dev and production remain intact

### Requirement: Public repository events cannot enter trusted delivery

The system MUST reject fork, issue-comment and other untrusted event paths from
preview, package publication, deployment and secret-bearing jobs. Trusted
delivery workflows SHALL use least-privilege tokens and protected environments.

#### Scenario: External fork opens a pull request

- **WHEN** a pull request head repository differs from the primary repository
- **THEN** no internal CI job executes project code for that event
- **AND** no secret, preview, package write or deploy path is reachable
