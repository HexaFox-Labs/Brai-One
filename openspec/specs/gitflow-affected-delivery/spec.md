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
A control path in a mixed change MUST NOT remove an Nx-affected runtime
project, image, runtime closure or Preview requirement.

#### Scenario: Web-only change

- **WHEN** a commit affects only the `web` runtime project and no shared
  catalog, lockfile or contract input
- **THEN** CI builds and tests the affected web closure only
- **AND** the manifest reuses every unchanged service image digest

#### Scenario: Documentation-only change

- **WHEN** a commit changes only classified documentation files
- **THEN** CI runs reduced documentation checks only
- **AND** no preview slot, runtime image build or deployment is created

#### Scenario: Control and web changes share an undelivered range

- **WHEN** an undelivered range changes both delivery-control files and the
  `web` Nx project
- **THEN** control checks run while `web` remains in the affected runtime image
  set
- **AND** Dev builds or reuses the exact web image rather than carrying the old
  manifest forward

### Requirement: Git Flow promotion is protected and revision exact

The system SHALL use `dev` as the integration branch, `release/*` as a frozen
release-candidate branch and `main` as production history. Runtime changes MUST
receive a green preview and explicit acceptance of the deployed revision before
the authorized primary agent may request an exact-head squash merge. Production
MUST be promoted only by an explicit protected release action after release
checks are green. A runtime delivery check SHALL remain green only after its
health-gated controller result and exact target manifest have both been
persisted; its job MUST authenticate to GHCR before publishing either Dev or
Preview/release manifest. Every `dev` revision and every promotable `release/*`
revision MUST have an exact immutable manifest even when no runtime image
changed; this carry-forward MUST NOT build or restart runtime. Because a
manifest artifact is a commandless `scratch` image, every workflow reader MUST
supply an explicit inert command when creating its never-started extraction
container and MUST remove that container after copying the manifest. Dev
affected calculation MUST begin at the source revision of the actually
published current Dev manifest and include skipped intermediate commits after a
replaced or failed run. Dev reuse MUST search that whole undelivered range for
the newest exact Preview and validate the controller's canonical image-reference
strings. Release calculation MUST use the frozen Dev merge-base. The protected
`dev` branch MUST require an exact owner-issued `runtime-acceptance` status, so
manual merge cannot bypass Preview. GitHub Actions MUST NOT merge with
`GITHUB_TOKEN` when doing so would suppress normal Dev delivery or Preview
cleanup events.
Production manifests MUST use the receiver's explicit host contract and only
single-package repository-linked digest references. A protected rollback MAY
select a previously persisted exact revision but MUST NOT rebuild its images or
accept a mutable tag. An explicit rollback revision MUST resolve through an
exact Dev manifest, never an unmerged feature Preview.

#### Scenario: Accepted feature revision merges to dev

- **WHEN** Sergey accepts a green runtime preview revision and required checks
  remain green
- **THEN** the authorized primary agent requests a protected squash merge for
  that exact accepted head revision
- **AND** the Dev manifest records the resulting merge revision while reusing
  the exact accepted Preview image digests for affected images

#### Scenario: Preview manifest persistence fails after a healthy deploy

- **WHEN** a Preview/release controller deployment is healthy but its exact
  manifest cannot be persisted in GHCR
- **THEN** the delivery check fails and the revision cannot merge or promote
- **AND** the already activated preview remains intact for diagnosis

#### Scenario: Main receives an ordinary push

- **WHEN** an ordinary push reaches `main`
- **THEN** no production deployment is performed solely because of that push
- **AND** production remains on its prior healthy manifest until promotion

#### Scenario: Non-runtime Dev revision advances source history

- **WHEN** a green Dev merge changes no runtime image
- **THEN** delivery publishes an exact manifest with the preceding seven
  validated digests and the new source revision
- **AND** it does not build an image, invoke the controller or restart a
  container

#### Scenario: A pending Dev run is replaced by a newer merge

- **WHEN** GitHub skips an intermediate pending delivery while an earlier Dev
  run is executing
- **THEN** the surviving run computes affected changes from the last actually
  published Dev revision through its own head
- **AND** it searches the whole undelivered range for the newest exact accepted
  Preview manifest
- **AND** no runtime change from the skipped commit is omitted

#### Scenario: Dev reuses a canonical Preview manifest

- **WHEN** the accepted Preview maps an affected image directly to its
  repository-linked digest reference
- **THEN** Dev validates the reference string and extracts that digest
- **AND** it does not require the production receiver's object transport shape

#### Scenario: Workflow reads a commandless manifest artifact

- **WHEN** a workflow needs `/manifest.json` from its immutable `scratch` image
- **THEN** it creates a never-started temporary container with an explicit
  inert command and copies the file
- **AND** missing image command metadata cannot break extraction

#### Scenario: Protected production rollback selects an exact revision

- **WHEN** the production action is approved with a previously persisted full
  revision
- **THEN** it submits that immutable digest manifest to the fixed receiver
- **AND** no image is rebuilt and no mutable tag enters production

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
The production SSH authorization path MUST remain root-owned and non-writable
by the deploy account while remaining readable by OpenSSH under that account.

#### Scenario: Preview branch closes

- **WHEN** a preview branch is closed or deleted
- **THEN** the controller stops only that lease's prefixed containers and
  deletes only that slot's data
- **AND** shared active images, dev and production remain intact

#### Scenario: OpenSSH reads the forced deployment key

- **WHEN** the locked production deploy account authenticates with its one
  configured Ed25519 key
- **THEN** OpenSSH can traverse the root-owned `.ssh` directory and read the
  root-owned `authorized_keys`
- **AND** the account cannot modify either path or bypass the forced receiver

### Requirement: Public repository events cannot enter trusted delivery

The system MUST reject fork, issue-comment and other untrusted event paths from
preview, package publication, deployment and secret-bearing jobs. Trusted
delivery workflows SHALL use least-privilege tokens and protected environments.

#### Scenario: External fork opens a pull request

- **WHEN** a pull request head repository differs from the primary repository
- **THEN** no internal CI job executes project code for that event
- **AND** no secret, preview, package write or deploy path is reachable

### Requirement: Preview lifecycle authorization uses documented OIDC claims

The controller SHALL authorize preview cleanup and owner acceptance only from
documented GitHub Actions OIDC claims: repository, repository visibility,
workflow reference, event name and a branch-bound trusted ref.
It MUST NOT require GitHub event-payload-only fields that are absent from an
OIDC token. The exact trusted cleanup and acceptance workflows MUST constrain
their respective closed-pull-request and owner-dispatched activities.

#### Scenario: Closed pull request releases its preview with a normal OIDC token

- **WHEN** the trusted cleanup workflow receives a GitHub OIDC token without an
  `action` claim for a closed primary-repository pull request
- **THEN** the controller accepts the branch-bound release request
- **AND** it releases only that branch's current lease

#### Scenario: A differently scoped token requests lifecycle access

- **WHEN** a token has a different repository, workflow, event, cleanup branch
  or acceptance workflow ref
- **THEN** the controller rejects the request before changing preview state or
  reporting an acceptance status
