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
revision; the owner-only workflow records `runtime-acceptance`, after which the
authorized primary agent requests a squash merge with the exact accepted head
SHA. GitHub branch protection remains the merge arbiter and rejects a changed
head or a newly failing required check. The workflow does not merge with
`GITHUB_TOKEN`, because GitHub suppresses ordinary downstream workflow events
created by that token; using the agent's owner credential preserves Dev
delivery and Preview cleanup. Sergey only supplies the acceptance decision and
does not perform Git operations manually. Docs/non-runtime changes do not
allocate previews or need acceptance and merge after their reduced required
checks. `release/*` freezes a green dev revision; it gets priority for a preview
only if its runtime manifest differs. `main` is production only and production
promotion is a separate explicit workflow dispatch with protected-environment
approval. Hotfixes branch from `main` and return to `dev` after production
promotion.

Runtime acceptance is a required commit status on `dev`, not merely a
merge convenience. Only an owner-dispatched trusted workflow may write
that status after the controller confirms the exact branch revision. This
prevents a manual squash merge from bypassing Preview and avoids GitHub's
impossible self-review path when the repository owner authored the pull
request. Non-runtime revisions receive the same status automatically after
their reduced delivery plan proves that no Preview is required.
`workflow_dispatch` requires the workflow file to exist on the repository
default branch; the initial repository bootstrap therefore installs this
control-plane workflow on `main` before relying on it, while subsequent runs
execute the trusted `dev` revision.

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

GitHub squash merge creates a new Dev commit SHA. On that push delivery resolves
the merged primary-repository pull requests throughout the undelivered
base-to-head range through GitHub's commit-to-PR API, loads the newest available
exact Preview manifest and reuses the relevant digest(s). This handles a failed
or replaced intermediate Dev run without losing its accepted Preview. The
canonical controller manifest maps every image directly to a repository-linked
digest string; Dev reuse validates that form rather than the separate
production receiver's `{digest, reference}` transport shape. The new Dev
manifest truthfully records its merge SHA while retaining the byte-identical
accepted image(s). Missing or ambiguous PR linkage, or no usable Preview
manifest, falls back to the normal affected build; a malformed linked manifest
fails closed. Production uses an exact release Preview manifest when present
and the exact Dev manifest when a frozen release branch has no runtime
difference. Runtime delivery keeps squash as the sole allowed GitHub merge
method so one Dev push cannot expose only a prefix of a multi-commit accepted
Preview.

Every Dev SHA also receives an immutable manifest, including non-runtime
merges. A non-runtime push copies only the seven validated digest references
from the last exact environment manifest, changes the recorded source revision
and publishes a sub-kilobyte manifest artifact; it does not contact the
controller, restart a container or rebuild an image. A newly created
`release/*` branch resolves against the merge-base with `origin/dev`, so a
frozen Dev revision produces no false full-workspace build. Non-runtime release
revisions use the same manifest-only carry-forward and therefore remain exact
promotion inputs without allocating a Preview slot.

Manifest artifacts use `FROM scratch` and intentionally contain only
`/manifest.json`; they have no runtime command. Every workflow reader therefore
creates its temporary, never-started extraction container with an explicit
inert command override before `docker cp`. The same invariant applies to the
current Dev base, carry-forward source, accepted Preview source and production
promotion source. A workflow-policy regression test enumerates all extraction
sites so a future reader cannot reintroduce commandless `docker create`.

GitHub concurrency can replace an older pending run when several Dev commits
arrive quickly. A Dev push therefore ignores `event.before` as its delivery
base and reads the exact source revision from the validated `dev-current`
manifest. It proves that revision is an ancestor of the new head and computes
the whole accumulated affected range. Thus a later run cannot lose a skipped
intermediate runtime commit. Push runs are not canceled while executing; PR
runs remain cancelable because only their newest head is relevant. Release
runs always compare their head to frozen Dev, trading a possible repeated
affected check for omission-free release composition.

The production receiver accepts only the single repository-linked GHCR package
reference used by delivery,
`ghcr.io/hexafox-labs/brai-one@sha256:<digest>`. Correcting this invariant bumps
the explicit host contract to `brai.production-host.v3`, so an unupdated host
rejects the new manifest instead of interpreting it under obsolete rules.
Admin images are one-off migration tools, not long-lived preview services.
The protected production dispatch accepts an optional exact 40-character
revision, allowing an operator-approved rollback to a previously persisted
trusted Dev manifest without rebuilding an image. Restricting the override to
Dev prevents an accidental promotion of an unmerged feature Preview. An omitted
revision promotes the release branch head from its release Preview or exact Dev
manifest.

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
repository, public visibility, exact workflow filename and event name. Cleanup
also binds the exact head branch; acceptance binds the trusted workflow to the
protected `dev` ref and checks the requested branch against controller state.
They use only claims documented for GitHub Actions OIDC. In particular,
GitHub's event payload field `action` is not an OIDC claim and MUST NOT become
a controller requirement.

The corresponding trusted workflow files constrain the activity themselves:
`preview-cleanup.yml` listens only for closed pull requests and
`enable-runtime-automerge.yml` accepts only an owner-issued dispatch from the
protected `dev` ref. The latter reads the current pull request state through
GitHub's API before it asks the controller about the exact deployed revision.
This preserves the least-privilege boundary without depending on an
undocumented JWT shape. Unit tests use real-contract-shaped claims that
deliberately omit `action` and still reject a different repository, workflow,
event or branch.

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
- [A scratch manifest artifact has no default command] → every temporary
  extraction container supplies the inert `/manifest.json` command explicitly,
  is never started, and is covered across all workflow readers.
- [A lifecycle endpoint depends on an undocumented OIDC field] → bind it only
  to documented claims, keep the narrow event activity in trusted workflow YAML
  and test tokens that omit event-payload-only fields.
- [GitHub replaces a pending Dev delivery during a rapid merge burst] → derive
  the next affected base from the actually published `dev-current` revision,
  verify ancestry and accumulate every skipped commit in the surviving run.
- [The local many-core host makes Turbopack dev compilation exhaust the
  Playwright startup window] → keep production on its normal optimized build,
  but start only the E2E webServer through Next.js's supported `--webpack`
  compatibility mode for deterministic readiness.

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
