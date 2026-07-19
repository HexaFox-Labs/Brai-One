# brai-access

`@brai/brai-access` is the private transactional authority for agent launch
access. It has no HTTP endpoint and no AI agent participates in authorization.
Trusted server code authenticates the caller; PostgreSQL state selects the
profile and generations; the runtime controller only returns cryptographically
or same-process verified OS receipts.

## Fixed model

- Developer mode is one global boolean per user. Only a platform-superadmin
  context may change it. Project `owner`/`admin` membership cannot grant host
  access.
- Every launch still requires an active membership for the selected project.
  The run stores the membership generation plus immutable `project_id`,
  profile-specific `environment_id`, the single-host
  `brai-runtime-host-1`, a job reference, and the SHA-256 of the exact command
  document. The signed launch contract covers every one of these fields. Its
  insert trigger locks and rechecks membership and access state, closing
  launch/revoke races even if a future membership writer does not use the
  access-service advisory lock.
- Membership revocation is `active -> revoking -> revoked`. Entering
  `revoking` atomically blocks launches and marks every live run in that
  project `termination_requested`; final revocation is rejected until exact OS
  termination receipts have made all of them terminal. Membership rows are
  retained as history and cannot be deleted.
- A mode change locks the global user state, increments `access_generation`,
  captures live runs across every project with the exact process-tree identity,
  and blocks new runs. Server code then sends one exact termination command per
  captured binding to `brai.runtime.agent-run.terminate.v1`, verifies every
  `runtime-termination-v2` Ed25519 receipt, and records the complete one-use
  receipt set before returning success. A retry of the same requested mode
  resumes the persisted transition; an opposite request fails closed. The
  transition ledger records the exact authenticated platform-superadmin user
  who requested the change.
- A normal user has one persistent global environment and one quota. Quota is
  an XFS hard limit, not reserved/preallocated disk. It is stored only on the
  environment and copied to immutable run snapshots. Reserving an allocation
  slot never reserves quota bytes or inodes.

## Environment and quota proof

The canonical allocation policy is fixed to:

- storage root `/srv/brai-user-data`;
- environment/storage label `brai-u-<base36 slot>` (it is not a host login
  account);
- host-wide outer ID pool `1879048192..2147352575`
  (`0x70000000..0x7FFDFFFF`), range `131072` per persistent user
  environment, maximum slot `2046`, image UID/GID offset `1000`;
- `allocation_slot` is globally unique in v1, so current platform capacity is
  2047 persistent user environments on one sandbox runtime host; multi-host
  sharding requires a future immutable host assignment and composite slot
  constraint, and is not implemented;
- inner subordinate offset/range `65536`;
- XFS project ID base `10000`.

Before any host/XFS mutation, `begin provisioning` takes one cross-user
transactional allocation fence and durably reserves the lowest free slot plus
its exact environment name, UID/GID ranges, subordinate IDs, XFS project ID,
storage path, and mount point. Only the committed reservation is returned to
the host. A retry advances the provision/access generation binding but reuses
that exact reservation; it never scans for or chooses another slot.

A first sandbox launch that finds no `ready` environment automatically enters
the deterministic server-side provisioning flow. Parallel first launches for
the same user are coalesced in the access process. `brai-access` reserves the
slot in the database, signs only that exact reservation with the access launch
key, and sends it to
`brai.runtime.user-environment.provision.v1`. The runtime host cannot select a
path, numeric ID or quota. It measures the result and returns an
`environment-provision-v1` receipt signed by its separate runtime receipt key.
Only after the ready-state CAS succeeds does `brai-access` retry the original
immutable launch command.

A sandbox launch still fails closed until provisioning is `ready`. Readiness requires
the complete typed host receipt produced from measured runtime preflight facts:
the already-reserved slot/UID/GID/subids/project/path plus image path and
SHA-256, mount device, project inheritance, quota enforcement, and exact
byte/inode hard limits. These facts are persisted explicitly, not represented
by an arbitrary evidence string. The receipt can only transition the current
`provisioning` row to `ready` when every reserved fact, user/environment ID,
provision generation, active access generation, and configured quota matches
in one SQL compare-and-set; it cannot allocate or change a slot.

Configured quota and verified ready-environment facts are immutable in this
foundation. There is deliberately no live quota-update API: changing a hard
limit later requires a separate fail-closed transition that first changes XFS,
verifies it, and only then changes launch state. Directly changing the database
limit while XFS still enforces another value is rejected.

A failed/stale provisioning attempt does not wedge the user forever. Starting
provisioning again increments `provision_generation`, invalidating every older
receipt while retaining the original reservation. `provisioning`, `ready`, and
`failed` rows all participate in uniqueness and range-exclusion constraints.
Environment rows and reservations cannot be deleted, cleared, or reused in this
foundation. A future teardown feature must first provide verified host cleanup
and only then introduce an explicit release transition.

## Runtime receipt boundary

Gateway commands arrive through the strict versioned subjects
`brai.access.agent-run.create.v1` and
`brai.access.developer-mode.set.v1`. The handler derives an in-process trusted
context only after the Gateway has authenticated the Supabase user or the
platform-superadmin proxy header. Public payloads cannot contain a profile,
generation, job command/digest, Linux IDs, paths, or cgroup data.

For a launch, `brai-access` constructs the canonical Codex command and
prompt-bound job reference server-side, commits the pending run, issues an
Ed25519-signed immutable launch contract, and sends the contract plus prompt
only to `brai.runtime.agent-run.launch.v1`. Gateway/browser credentials cannot
publish or subscribe to that subject, and the public response never contains
the signed contract.

`./trusted-adapter` is an explicit package subpath; receipt/context issuers are
not exported from the main package. WeakSet-issued brands prevent JSON or copied
symbols from becoming trusted inside one process.

For NATS or another process boundary, use the Ed25519 key-bound context and
`verified*FromSignedEnvelope` functions. The signature authenticates exact raw
JSON bytes, receipt purpose, and key ID before parsing. Public keys come from
trusted server configuration, never from request data. Replays are harmless:
every payload is bound to IDs and generations and consumed by a one-row SQL
state transition (`pending -> starting`, `starting -> running/terminal`, or an
exact captured termination row).

The lifecycle is explicit:

- a launch is inserted once as `pending`;
- a verified exact typed process identity claims it once as `starting`. It
  includes the host boot ID, systemd invocation ID and unit, cgroup path and
  inode, leader PID and `/proc` start-time ticks, and the nspawn machine name
  for `user-sandbox` (`null` for `developer`);
- a verified started receipt moves it once to `running`;
- `starting`/`running` becomes `succeeded` or `failed` only when a typed exit
  receipt contains an empty-cgroup proof matching the stored boot, invocation,
  unit, path, and inode;
- a `termination_requested` run becomes `terminated` only with a typed
  cancellation-before-start receipt or a matching process-tree-killed plus
  empty-cgroup receipt.

The database stores the typed JSON receipt documents themselves. It does not
reduce lifecycle facts to an opaque evidence string or hash. JSONB equality,
immutable transition triggers, and status compare-and-set make an identity or
receipt one-use and prevent a receipt for another cgroup from completing a run.

Thus stale-start recovery never marks a possibly living process `failed` merely
because a timeout elapsed.

## Database ownership and deployment

Migrations live in `services/brai-access/migrations`. Factory migrations
explicitly exclude this directory/schema. There are three independent
credentials and none is accepted as a substitute for another:

- `BRAI_ACCESS_BOOTSTRAP_DATABASE_URL` is the protected PostgreSQL bootstrap
  credential. It is used only for the one-time foundation/ownership handoff
  and for provisioning or auditing database roles;
- `BRAI_ACCESS_MIGRATION_DATABASE_URL` authenticates exactly as
  `brai_access_migrator`. The normal migration command checks `current_user`
  before touching the ledger;
- `BRAI_ACCESS_DATABASE_URL` authenticates exactly as
  `brai_access_runtime` and is the only credential available to the service.

On a fresh database, `bootstrap:foundation` applies the checked-in foundation
while the migrator role does not yet exist. The command requires a PostgreSQL
bootstrap credential with `CREATEROLE` (it need not be a superuser) and
permanently refuses to run after the migrator is created.
`bootstrap:migration-role` then compares every checked-in file with every row
in `brai_access.schema_migrations`, rejects missing, changed, or unknown
versions, creates `brai_access_migrator` as bounded `NOLOGIN`, and transfers
ownership of only the `brai_access` schema and its objects. It grants no
`CREATEROLE`, `CREATEDB`, `TEMPORARY`, foreign-schema access, or memberships.
PostgreSQL 17 automatically gives a non-superuser `CREATEROLE` creator an
`ADMIN` membership in a role it creates. The bootstrap removes that implicit
membership immediately, then the same transaction audits both directions of
`pg_auth_members`; any remaining membership rolls the handoff back.

`provision:migration-role` supplies the separately generated password and
changes that bounded role to `LOGIN` with connection limit 1. The strict audit
checks role attributes, timeouts, both membership directions, database/schema
rights, non-expiring SCRAM-SHA-256 authentication, and ownership of every
relation and routine before commit. Thereafter all migrations run only through:

```bash
pnpm --filter @brai/brai-access migrate
```

The runner uses advisory lock `brai-new:brai-access:migrations` and its own
checksum ledger. Re-running it is idempotent; changing an applied migration is
a hard failure.

The immutable non-root one-off image is built from `Dockerfile.admin` and is
intended to be published as `brai-access-admin`; its default command is
`node dist/migrate.js`.

The foundation creates `brai_access_runtime` as `NOLOGIN`. The protected
`provision:runtime-role` command uses only the bootstrap credential to supply
the separate runtime password, changes that same bounded role to `LOGIN`, and
audits it before commit. The role has connection limit 10, short timeouts, no
memberships/TEMP/public/foreign schema access, no callable routines, read-only
membership/policy access, non-expiring SCRAM-SHA-256 authentication, and only
the exact store-table grants.

Production env generation preserves already generated values and writes
separate root-only files:

- `/etc/brai-new/access-bootstrap.env` — bootstrap URL and the two role
  provisioning secrets;
- `/etc/brai-new/access-migrations.env` — only the migrator URL;
- `/etc/brai-new/access.env` — only the runtime URL and access-service NATS
  credential.

The database backup hook is also independent of deployment tooling. The
checked-in installer places a root-owned wrapper at
`/srv/opt/brai-access/bin/pre-migration-backup` and a systemd drop-in that
requires both `brai_factory` and `brai_access`. It never calls a project
checkout and never depends on a CI/deploy principal.

## Runtime integration boundary

This package supplies the fail-closed store, access NATS consumers, signed
launch and provisioning issuance, synchronous developer-mode termination
coordination, and receipt verification. Host mutations remain in the separately
installed trusted runtime service. A database reservation alone never means
that an environment exists: normal launch remains unavailable until the runtime
returns measured signed evidence and the access database accepts it. No
serialized client/model payload can select or raise a profile, choose Linux
identities, or turn an unverified host action into access state.
