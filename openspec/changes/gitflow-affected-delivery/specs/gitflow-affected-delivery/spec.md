## ADDED Requirements

### Requirement: Delivery classifies exact affected runtime scope

The delivery system SHALL derive affected Nx projects from the exact commit and
its merge base, expand them through a checked-in runtime dependency catalog,
and run only the required lint, typecheck, build, unit, contract and declared
e2e checks. Documentation-only changes SHALL NOT build runtime images, create a
preview or run runtime test suites. Unknown or shared delivery inputs MUST use
a conservative declared policy and MUST NOT be treated as documentation.

#### Scenario: Web-only change

- **WHEN** a commit affects only the `web` runtime project and no shared
  catalog, lockfile or contract input
- **THEN** CI builds and tests the affected web closure only
- **AND** the manifest reuses every unchanged service image digest

#### Scenario: Documentation-only change

- **WHEN** a commit changes only classified documentation files
- **THEN** CI runs the reduced documentation checks only
- **AND** no preview slot, runtime image build or deployment is created

### Requirement: Git Flow promotion is protected and revision exact

The system SHALL use `dev` as the integration branch, `release/*` as a frozen
release-candidate branch and `main` as production history. Runtime changes MUST
receive a green preview and explicit acceptance of the deployed revision before
their GitHub auto-merge can be enabled. Production MUST be promoted only by an
explicit protected release action after all release checks are green. A runtime
delivery check SHALL remain green only after its health-gated controller result
and exact target manifest have both been persisted; its job MUST authenticate
to GHCR before publishing either Dev or Preview/release manifest.
Every `dev` revision and every promotable `release/*` revision MUST have an
exact immutable manifest even when the revision changes no runtime image; such
a manifest-only carry-forward MUST NOT rebuild or restart runtime services.
Because an immutable manifest artifact is a commandless `scratch` image,
every workflow path that extracts it MUST supply an explicit inert command when
creating the temporary container, MUST NOT start that container and MUST remove
it after copying the manifest.
Dev affected calculation MUST start from the source revision of the actually
published current Dev manifest and MUST include skipped intermediate commits
after a replaced pending workflow run. Release affected calculation MUST use
the frozen Dev merge-base.
The protected `dev` branch MUST require an exact owner-issued runtime
acceptance status for Preview-requiring revisions and MUST NOT permit a manual
merge to bypass that status. After the workflow succeeds, the authorized
primary agent MUST request a protected squash merge with the exact accepted
head revision; GitHub branch protection MUST remain authoritative for all
required checks and normal merge-triggered workflows MUST remain enabled.
The manually dispatched workflow MUST already exist on the default branch
before the acceptance path is activated. Production manifests MUST use the explicit host
contract version installed on the receiver and MUST accept only the
repository-linked single-package GHCR digest form. A protected production
rollback MAY select a previously persisted exact environment revision but MUST
NOT rebuild its images or accept a mutable tag. An explicit rollback revision
MUST resolve through an exact Dev manifest, never an unmerged feature Preview.

#### Scenario: Accepted feature revision merges to dev

- **WHEN** Sergey accepts a green runtime preview revision and its required
  checks remain green
- **THEN** the owner-only workflow records acceptance and the authorized
  primary agent requests a protected squash merge for that exact head revision
- **AND** the dev manifest deploys only the affected image changes

#### Scenario: Non-runtime Dev revision advances source history

- **WHEN** a green Dev merge changes no runtime image
- **THEN** delivery publishes an exact Dev manifest containing the preceding
  seven validated image digests and the new Dev source revision
- **AND** it does not build an image, invoke the controller or restart a
  container

#### Scenario: Workflow reads a commandless manifest artifact

- **WHEN** Dev, Preview reuse, manifest carry-forward or production promotion
  needs `/manifest.json` from its immutable `scratch` image
- **THEN** the workflow creates a never-started temporary container with an
  explicit inert command and copies the file
- **AND** commandless image metadata cannot make manifest extraction fail

#### Scenario: Newly created release branch freezes Dev

- **WHEN** a `release/*` branch is created at an exact Dev revision and GitHub
  reports an all-zero previous SHA
- **THEN** affected calculation uses the exact Dev base and selects no runtime
  rebuild
- **AND** the release remains promotable through an exact manifest

#### Scenario: A pending Dev run is replaced by a newer merge

- **WHEN** GitHub skips an intermediate pending delivery while a prior Dev run
  is still executing
- **THEN** the surviving run reads the last actually published Dev revision
  and computes affected changes through its own head
- **AND** it searches the entire undelivered commit range for the newest exact
  accepted Preview manifest
- **AND** every runtime change from the skipped commit is still built or reused

#### Scenario: Dev reuses a canonical Preview manifest

- **WHEN** an accepted Preview manifest maps an affected image to a canonical
  repository-linked digest string
- **THEN** Dev validates that string, extracts its digest and reuses the image
- **AND** it does not require the production receiver's transport object shape

#### Scenario: Preview manifest persistence fails after a healthy deploy

- **WHEN** a Preview/release controller deployment is healthy but its exact
  manifest cannot be persisted in GHCR
- **THEN** the delivery check fails and the revision cannot merge or promote
- **AND** the already activated preview remains intact for diagnosis

#### Scenario: Main receives an ordinary push

- **WHEN** an ordinary push reaches `main`
- **THEN** no production deployment is performed solely because of that push
- **AND** production remains on its prior healthy manifest until explicit
  release promotion

#### Scenario: Operator rolls production back to a persisted revision

- **WHEN** the protected production action is explicitly approved with a
  previously persisted exact 40-character revision
- **THEN** it submits that revision's immutable digest manifest to the fixed
  receiver
- **AND** no image is rebuilt and no mutable image tag enters production

### Requirement: Preview slots are isolated, ordered and recoverable

The system SHALL allocate qualifying runtime branches the lowest free slot from
`p01` through `p20`, retain branch ownership through a lease generation, and
use release-priority FIFO queuing when no capacity is available. Each slot MUST
use `pNN-brai-*` containers, a separate database identity seeded from the
latest verified dev snapshot, an isolated network and a protected Caddy route.

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
The system SHALL enforce configured preview data/log budgets, bounded image
retention and a host free-space admission floor. Cleanup MUST target only
controller-owned inactive resources and MUST NOT use a broad global prune.

#### Scenario: Preview branch closes

- **WHEN** a preview branch is closed or deleted
- **THEN** the controller stops only that lease's prefixed containers and
  deletes only that slot's data
- **AND** shared active images, dev and production remain intact

#### Scenario: Disk admission floor is reached

- **WHEN** starting a new preview would violate the configured host free-space
  floor
- **THEN** the request remains queued with a diagnostic
- **AND** the controller does not delete a healthy active environment

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
