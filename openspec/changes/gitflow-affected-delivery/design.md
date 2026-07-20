## Context

Brai New already has digest-pinned production images, a protected host command
and five permanent runtime services. Its GitHub workflow is still deliberately
simple: every pull request runs the broad workspace suite; every `main` push
builds all images and deploys production. The legacy project shows the cost of
this model on the host: copied `source` trees, `node_modules`, Android caches
and old source copies consumed tens of gigabytes per environment.

The repository is public. External users may read and fork the source, but
must never gain compute, credentials, deployment access or a preview in Brai
infrastructure. Sergey accepts runtime pull requests only from the primary
repository and is the human release acceptor.

## Goals / Non-Goals

**Goals:**

- Make CI test, build and publish only the Nx affected project set and its
  declared reverse dependency closure.
- Keep all deployed code in immutable GHCR images addressed by digest; never
  copy a checkout, install packages or build on the host.
- Give each qualifying primary-repository branch a deterministic, isolated
  preview lifecycle with the lowest free `p01`--`p20` slot.
- Preserve a continuously deployed `dev`, an explicit human-gated production
  release and a rollback-safe manifest history.
- Bound disk, CPU, memory, logs, databases and artifact retention before they
  can crowd out dev or production.

**Non-Goals:**

- The change does not take `dev.brai.one` from the legacy project before the
  owner-approved cutover window.
- It does not let forks, public issues or arbitrary GitHub dispatch inputs run
  privileged code.
- It does not publish reusable npm packages or make a permanent staging/release
  environment; a release candidate uses a normal priority preview slot only
  when runtime differences require one.
- It does not guarantee that 20 previews run simultaneously. DNS/database slots
  are a ceiling; the admission controller selects the safe active capacity.

## Decisions

### Git Flow and human gates

`feature/*`, `fix/*` and `docs/*` branch from `dev`. Runtime branches receive
a preview after their first green qualifying commit. Sergey accepts that exact
revision; automation then enables GitHub native auto-merge, which still waits
for required checks. Docs/non-runtime changes do not allocate previews or need
acceptance and merge after their reduced required checks. `release/*` freezes a
green dev revision; it gets priority for a preview only if its runtime manifest
differs. `main` is production only and production promotion is a separate
explicit workflow dispatch with protected-environment approval. Hotfixes branch
from `main` and return to `dev` after production promotion.

This retains GitHub's protected merge mechanism instead of scripting a merge
before checks finish, which was the proven legacy race.

### Impact classification is declarative and fail-closed

An in-repository delivery catalog maps Nx projects, Docker images, runtime
dependencies, e2e trigger classes and non-runtime path classes. CI computes
the merge base and runs `nx show projects --affected` (or its compatible
machine-readable equivalent) against the exact commit. The catalog expands
that set to image owners and reverse runtime dependencies.

Unknown paths, lockfile/toolchain/CI/deployment catalog changes, migrations and
shared contracts are never silently classified as documentation. They select a
conservative policy and cannot auto-deploy until explicitly handled. Pure docs
and reader-only paths run format/link/policy checks only.

### One immutable image manifest per environment revision

Every changed image is built once in GitHub Actions and published to private
GHCR by digest. The image manifest starts from the base environment manifest,
overlays only affected image digests, and records the source SHA. Unchanged
images are referenced, not rebuilt or copied. Preview, dev, release and
production therefore differ only by their manifest, database and container
prefix.

The existing production manifest/host contract is retained and generalized;
admin images are one-off migration tools, not long-lived preview services.

### Terminal manifest persistence is target-neutral

For a `dev`, `preview` or `release/*` delivery, the health-gated controller
response is an intermediate success. The GitHub delivery check becomes green
only after its job has authenticated to GHCR and persisted the exact returned
manifest as the target's tiny OCI artifact. The login is therefore conditioned
only on a deployed response, not on whether the target is `dev` or `preview`.

If manifest publication fails after the controller has activated a healthy
preview, the preview remains available at its last activated revision, but the
workflow remains red. Native auto-merge consequently cannot merge it, and no
release promotion can fetch a missing immutable manifest. A source-level
workflow policy test asserts that the one GHCR login step precedes both
manifest-publishing paths and applies to every deployed target.

### Preview slots are leased, deterministic and disposable

The controller stores `branch`, `slot`, `lease_generation`, `last_deployed_sha`,
manifest digest and activity time in a server-side registry. It scans `p01` to
`p20` in order, choosing the first free slot. Release requests precede ordinary
requests; FIFO applies within each priority. A closed/deleted branch cancels a
queued request. A 72-hour runtime-idle preview is stopped and its data is
cleared; a future qualifying push allocates a fresh lowest free slot.

The slot is a branch-level integration target, so cooperating agents pushing to
the same branch update the same preview. A stale deployment can never release
or overwrite a newer lease generation.

### Preview data and runtime isolation

There are twenty persistent empty database identities, one per slot. Allocating
a slot restores the latest verified compressed `dev` snapshot, excluding
attachments, file objects, logs, caches, migration ledgers and immutable
migration-owned seed records; branch migrations recreate those seeds before
the remaining runtime data is restored to that slot. A new snapshot atomically replaces the prior snapshot after a
healthy runtime dev deployment. Each preview has an isolated Docker network,
named containers `pNN-brai-*`, Caddy route and scoped credentials. It reuses
the immutable images of the minimum runtime closure but never network-connects
to dev or production.

### Capacity and storage admission

Images are shared Docker layers; a preview stores neither a checkout nor
dependencies. Initial per-preview persistent budget is 200 MB database data,
10 MB logs and 20 MB miscellaneous writable state, with a 250 MB hard limit.
The target dev snapshot is 100 MB compressed; alert at 80 MB and block new
preview allocation at 200 MB until the data growth is investigated. Shared
runtime image retention is active references plus two healthy rollback
versions; no global prune is permitted.

The controller preserves a 20 GiB host free-space floor and reserves CPU/RAM
for production and dev. At the initial five-preview limit, the 250 MiB slot
hard budget plus 10 MiB logs and 20 MiB miscellaneous state totals at most
1.37 GiB, leaving at least 2.6 GiB above that floor on the measured 24 GiB
host baseline. The floor is a guardrail, not a cleanup trigger: admission
failure queues a preview and never deletes a healthy active environment. The
active limit may rise only through a measured load test.

The host installer inspects only the existing managed Caddy block. If that
block already contains `dev.brai.one`, it validates and reapplies the combined
Dev-and-Preview route; otherwise it performs the initial preview-only route
installation. Reinstalling the controller therefore cannot roll back an
approved Dev cutover.

### Public repository trust boundary

Only branch events whose head repository equals `HexaFox-Labs/Brai-One` are
eligible for CI that executes project code. Fork PRs are ignored by internal
workflows. Privileged workflows use no `pull_request_target`, issue-comment or
untrusted `workflow_run` code path; default tokens are read-only and individual
jobs receive only the explicit package or deployment permission needed. The
production SSH key is exposed only to a protected production promotion job;
the host deploy account accepts only the fixed manifest command.

### Lifecycle authorization uses the published OIDC contract

The preview cleanup and owner-acceptance endpoints bind a token to the expected
repository, public visibility, exact workflow filename, event name and exact
head branch; acceptance additionally binds the base branch to `dev`. They use
only claims documented for GitHub Actions OIDC. In particular, GitHub's event
payload field `action` is not an OIDC claim and MUST NOT become a controller
requirement.

The corresponding trusted workflow files constrain the activity themselves:
`preview-cleanup.yml` listens only for closed pull requests and
`enable-runtime-automerge.yml` only for submitted reviews. This preserves the
least-privilege boundary without depending on an undocumented JWT shape. Unit
tests use real-contract-shaped claims that deliberately omit `action` and still
reject a different repository, workflow, event or branch.

## Risks / Trade-offs

- [Incorrect dependency catalog under-starts a preview] → catalog validation,
  compose rendering tests and a conservative full runtime closure for unknown
  project classes.
- [Public workflow code tries to exfiltrate secrets] → forks run nothing,
  protected branches and environments gate all secrets, no privileged PR
  trigger checks out untrusted code.
- [A database snapshot grows unexpectedly] → explicit size checks, no files in
  snapshots, alert before hard allocation block and an operator runbook.
- [Host capacity is lower than domain count] → queue plus capacity admission;
  DNS slots do not imply active leases.
- [Cutover failure] → legacy remains untouched until a separate verified dev
  cutover; manifest rollback retains the last two healthy releases.
- [A post-deploy manifest step omits a target-specific prerequisite] → keep
  target-neutral authentication next to the shared terminal gate, assert it in
  the workflow policy test, and validate Dev plus a real Preview before merge.
- [A lifecycle endpoint depends on an undocumented OIDC field] → bind it only
  to documented claims, keep the narrow event activity in trusted workflow YAML
  and test tokens that omit event-payload-only fields.

## Migration Plan

1. Add catalog, affected CI, image manifest composition and unit tests without
   activating any new host route.
2. Apply GitHub repository settings, branch protections, environment approvals,
   secrets and GHCR package access; connect the empty remote.
3. Install the least-privilege preview/dev host controller and Caddy templates
   under a separate root without touching legacy paths; verify with an internal
   synthetic slot.
4. Retire the legacy dev runtime in an owner-approved maintenance window,
   perform capacity baseline and move `dev.brai.one` atomically only after the
   new dev health checks pass.
5. Enable five preview leases, verify a real feature branch's HTTPS route,
   terminal GHCR manifest, merge-triggered cleanup, release candidate and
   rollback, then enable production promotion from a protected release.

Rollback stops only the new prefixed containers/routes, restores the preceding
manifest and leaves legacy paths untouched until the approved cutover has
completed.

## Open Questions

- The actual first `dev` snapshot size and post-legacy host capacity must be
  measured at cutover; these are operational gates, not design ambiguities.
- The migration window for taking `dev.brai.one` requires an explicit owner
  decision because it changes live legacy traffic.
