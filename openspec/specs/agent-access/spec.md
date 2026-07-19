# agent-access Specification

## Purpose

Определяет постоянные границы Linux-доступа, выбора runtime-профиля,
пользовательской изоляции, хранения, контейнеров и баз данных для агентов Brai
New.

## Requirements

### Requirement: Access profile is selected only by trusted server state

Brai SHALL have exactly two runtime profiles: `user-sandbox` and `developer`.
Trusted backend code SHALL select the profile from the
platform-superadmin-controlled global `developer_mode` value before launch.
Models, prompts, tools, agents, project administrators and client requests
MUST NOT select or raise a profile.

#### Scenario: Ordinary user requests elevated access

- **WHEN** an ordinary user's request or tool input asks for developer or root access
- **THEN** the runtime launches only as `user-sandbox`
- **AND** no broker or AI decision is consulted

#### Scenario: Platform superadmin enables developer mode

- **WHEN** the platform superadmin enables global developer mode for a user
- **THEN** subsequent launches use the `developer` profile
- **AND** project membership remains independently required

### Requirement: Access changes replace runtimes instead of changing live rights

Changing developer mode or revoking membership SHALL increment the server-side
generation, stop all captured live process trees for the affected scope, and
activate the new state only after exact empty-process-tree evidence. A running
process MUST NOT gain or lose rights in place.

#### Scenario: User changes from ordinary to developer mode

- **WHEN** trusted server state changes from normal to developer
- **THEN** new launches remain blocked during transition
- **AND** every old-generation process tree is terminated before the new generation becomes active

#### Scenario: Stale launch is replayed

- **WHEN** a signed launch contract carries an old access generation
- **THEN** launch fails closed without creating a process

### Requirement: Launch authority is immutable and server signed

The launcher SHALL accept only a short-lived server-signed contract bound to
the run, user, project, environment, runtime host, access generation, immutable
job/command digest and selected profile. Untrusted profile or OS identity
fields MUST be rejected.

#### Scenario: Valid launch is claimed

- **WHEN** a current signed contract matches membership, generation and runtime host
- **THEN** the run is durably claimed once
- **AND** typed started/exit/termination receipts remain bound to the same process-tree identity

#### Scenario: Client supplies identity fields

- **WHEN** a client command supplies profile, owner, actor, developer mode, generation or OS identity
- **THEN** schema validation rejects the command

### Requirement: Ordinary users share one persistent isolated environment per user

Each ordinary user SHALL have one persistent OS-isolated environment shared by
all of that user's agents, tasks and projects. Agents and tasks MUST NOT create
separate full environment images, Git clones, worktrees or allocation slots.
Agents of one user are one trust domain; different users and the platform are
separate trust domains.

#### Scenario: Many agents run for one ordinary user

- **WHEN** multiple agents or projects run in parallel for the same user
- **THEN** they use the same persistent environment, storage root and resource limits
- **AND** they consume one allocation slot

#### Scenario: Sandbox inspects the host

- **WHEN** ordinary-user code attempts to access Brai source, host root, host homes, Caddy, platform credentials, core NATS/Supabase credentials or a host container socket
- **THEN** the OS boundary denies access
- **AND** launch never falls back to developer mode

### Requirement: Host identities are deterministic and collision checked

The single-host v1 allocator SHALL reserve the complete
`0x70000000..0x7FFDFFFF` UID/GID pool exactly once behind locked/no-login
`brai-sandbox-map`. It SHALL allocate 2047 fixed 131072-ID persistent
environment slots and SHALL verify passwd, group, subuid, subgid, NSS and
systemd allocator collisions before provisioning and launch.

#### Scenario: Environment slot is provisioned

- **WHEN** the access store durably reserves a slot
- **THEN** UID/GID range, XFS project ID and canonical path derive deterministically from that slot
- **AND** the reservation is never reused after partial provisioning without separately verified teardown

#### Scenario: Host identity facts drift

- **WHEN** the exact pool reservation, locked account state or collision audit differs
- **THEN** ordinary-user provisioning and launch fail closed
- **AND** no recursive ownership repair runs

### Requirement: User storage limits do not reserve disk space

All ordinary users SHALL share one bounded sparse XFS filesystem on the
existing disk, mounted with project quotas. A per-user byte/inode hard limit
SHALL cap actual consumption but MUST NOT preallocate blocks, subtract the
limit from free space or create a disk/image/filesystem per user.

#### Scenario: User receives a five-gigabyte limit

- **WHEN** the platform applies the hard quota
- **THEN** free disk space changes only for metadata and bytes actually written
- **AND** the sum of configured user limits may exceed current physical free space

#### Scenario: User reaches the hard limit

- **WHEN** writes exceed the user's byte or inode quota
- **THEN** the kernel returns quota exhaustion for that user only
- **AND** deleting user data restores writable capacity without releasing a reservation

### Requirement: User containers use only the matching rootless engine

Each provisioned slot SHALL have one locked/no-login
`brai-eng-<base36-slot>` Linux service principal and one host-level rootless
Docker engine. This principal is only an OS enforcement identity and MUST NOT
act as an agent, broker or access decision-maker. Engine mutable state SHALL
remain inside the matching quota root, and its socket SHALL be mounted only
inside the matching sandbox.

#### Scenario: User builds and runs a container

- **WHEN** ordinary-user code invokes Docker
- **THEN** it reaches only its slot's rootless engine
- **AND** images, layers, build cache, volumes, logs and temporary data count against the same user quota

#### Scenario: Container requests a host bind or private endpoint

- **WHEN** a nested workload requests a Brai source/credential/host-socket bind or connects to host/private/link-local endpoints
- **THEN** the private mount namespace and cgroup/network policies deny it
- **AND** approved public internet egress may remain available

### Requirement: Ordinary runtimes have aggregate and per-user resource boundaries

Every ordinary-user process tree and matching engine SHALL be inside the
root-owned `brai-users.slice` and its per-environment limits. Trusted code SHALL
measure the active cgroup policy before launch; clients and models MUST NOT
supply resource facts.

#### Scenario: Aggregate cgroup policy is absent or wider than expected

- **WHEN** the launcher cannot measure the exact host-owned CPU, memory, swap and task caps
- **THEN** the launch fails closed

### Requirement: Developer web agents have Codex Desktop parity

A developer web-agent SHALL run as the host principal `mark:mark` with fresh
supplementary groups, umask `0077`, working directory
`/srv/projects/brai-new`, writable checkout and the same non-interactive sudo
contract as Codex Desktop. The whole agent MUST NOT run as root.

#### Scenario: Developer edits and builds the project

- **WHEN** a developer web-agent creates or changes ordinary project files
- **THEN** it does so without sudo
- **AND** files remain owned by `mark:mark` and usable by Codex Desktop

#### Scenario: Developer changes host infrastructure

- **WHEN** trusted developer work requires a system change
- **THEN** the process invokes the normal sudo contract of `mark`
- **AND** no special root broker or second project writer is introduced

### Requirement: The Brai checkout has one normal Unix writer

The only normal writer of `/srv/projects/brai-new` SHALL be `mark`. Runtime,
deployment, migrations and ordinary-user services MUST NOT write into the live
checkout. Recursive `chmod`/`chown` repair and foreign-owned caches MUST NOT be
part of the normal workflow.

#### Scenario: Ownership or mode drift is detected

- **WHEN** developer preflight finds a foreign owner, world-writable entry, special file or escaping symlink
- **THEN** launch fails with a stable diagnostic
- **AND** no automatic recursive repair is attempted

### Requirement: User databases stay inside the user boundary

SQLite inside the user quota root SHALL be the default project database. A
user MAY run Postgres through the matching rootless engine, with `PGDATA`,
dumps, temporary files and credentials under the same quota and without a
published host port. User projects MUST NOT receive arbitrary schemas, roles,
extensions, DDL or credentials in Brai's core Supabase.

#### Scenario: User creates a normal project database

- **WHEN** a project needs persistence without an external database
- **THEN** it uses a private SQLite file with WAL, bounded transactions and a safe backup method

#### Scenario: User opts into Postgres

- **WHEN** the user runs a digest-pinned Postgres container
- **THEN** Postgres remains in the user's private network and quota root
- **AND** backup/restore does not touch core Supabase

### Requirement: Core database access is service owned and least privilege

Each database-owning Brai service SHALL use its own schema and separate bounded
migration/runtime roles. Gateway, web, models and user sandboxes MUST NOT
receive core database credentials. Migration and runtime roles SHALL be
auditable for exact grants, connection limits and server-side timeouts.

#### Scenario: Access service runs normally

- **WHEN** `brai-access` connects to Supabase
- **THEN** its runtime role can use only the required `brai_access` objects
- **AND** it cannot create schemas, roles, extensions or migrations

### Requirement: Access capability is accepted only by live boundary tests

Unit tests and templates alone MUST NOT enable a runtime profile. Acceptance
SHALL exercise two real users, developer transitions, quota exhaustion,
container build/network/bind denial and database backup/restore on the
installed host boundary.

#### Scenario: Access foundation is declared complete

- **WHEN** the change is archived
- **THEN** ordinary two-user isolation, developer parity, normal-to-developer-to-normal transition, hard quota recovery, SQLite restore and user Postgres restore have passed
- **AND** `/home/mark/DEPLOYMENT.md` records installed paths, services and verification without secrets

### Requirement: Access implementation excludes unrelated delivery features

The access foundation MUST exclude GitHub repository setup, CI/CD activation,
production user-domain ingress, managed user Postgres and multi-host sharding.
These unrelated delivery features MUST NOT be reported as unfinished
components of the permission system.

#### Scenario: Access foundation is completed before GitHub connection

- **WHEN** the permission and isolation acceptance passes
- **THEN** the change may be archived without a connected GitHub repository or CI/CD deployment
