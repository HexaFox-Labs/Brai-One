# Agent runtime access

This directory defines a fail-closed host contract for exactly two static
profiles and contains the trusted installers, runtime controller and
acceptance harness used on the Brai runtime host. Installed paths and service
state are recorded in `/home/mark/DEPLOYMENT.md`; repository build/test tasks
never mutate the host implicitly.

## Fixed profiles

- `developer` runs as the real host account `mark`. Preflight requires the
  actual UID/GID of `mark`, `mark:mark` checkout ownership, write access, and a
  successful non-interactive `/usr/bin/sudo -n -l`. The checkout root is an
  exact owner-only `0700` boundary. The complete tree, including `.git`,
  generated output and nested cache contents, is audited recursively:
  entries must be `mark:mark`, have the access required by their policy, pass
  effective `fs.access` checks, and contain no unsafe special entries or
  symlink escape. A source symlink into managed read-only `.agents` or `.codex`
  is rejected. The effective supplementary group set must exactly equal
  `/usr/bin/id -G mark`, the executor umask must be exactly `0077`, and sudo
  output must prove explicit `NOPASSWD: ALL`, not merely permission to execute
  one probe command.
- `user-sandbox` uses one persistent outer environment per user. Every agent
  and every project belonging to that user shares it. The environment sees one
  root-owned, digest-pinned image read-only and exactly one writable bind: that
  user's quota directory mounted at `/data`.

The signed-snapshot launcher seam has no profile argument. After verification,
it passes the complete contract (including `run_id` and generation) and one
statically selected executor to a single injected atomic primitive. That
primitive must claim `run_id`, check generation, launch and register the runtime
under the same per-user generation fence. Replay, stale, forged and unknown
contracts fail closed; there is no check-then-launch gap.

The atomic primitive is a cross-process contract, not an in-memory mutex. A
production implementation must durably claim unique `run_id`, lock the user's
generation, start the selected executor and register the runtime before
releasing that same fence. The in-memory adapter in tests is scoped only to
model interleavings and is not a production implementation. For
`user-sandbox`, the primitive must additionally hold a host-wide launch fence,
freshly measure and admit against `brai-users.slice`, then start the runtime
without a measurement/start gap.

## Storage contract

There is no separate physical disk and there is never a per-user or per-agent
filesystem image. The only storage layout accepted by preflight is:

- one root-owned directory `/srv/brai-storage` (`0700`) on the existing root
  ext4 filesystem;
- one canonical regular backing file
  `/srv/brai-storage/user-data.xfs`, owned by `root:root` with exact mode
  `0600`;
- one finite, root-owned logical ceiling recorded as decimal bytes in
  `/etc/brai-agent-runtime/storage-ceiling-bytes`;
- that one sparse backing file loop-mounted as XFS with `prjquota` at the exact
  canonical path `/srv/brai-user-data`;
- one ordinary XFS project directory and byte/inode hard quota per persistent
  user environment inside that shared mount.

The current aggregate ceiling is 6 GiB. `truncate` sets the maximum logical
size without allocating 6 GiB immediately; `mkfs.xfs` consumes only real XFS
metadata blocks. Preflight measures `stat.size` and `stat.blocks * 512`,
requires allocated bytes to be no greater than the configured logical
ceiling, verifies the exact `/dev/loopN` source through sysfs, and rejects any
other backing path, direct block device, symlink, mutable owner/mode, per-user
image, or unbounded size.

An XFS project quota is an enforceable byte/inode hard ceiling, not reserved
capacity. Assigning a 5 GiB limit does not subtract 5 GiB from free space.
Limits may be overcommitted across users; capacity is consumed only by real
files. The shared backing file's finite logical size is the aggregate user-data
ceiling; individual quota totals are not preallocated or subtracted from ext4.

Every provisioning operation and sandbox launch measures both layers and fails
closed if either the outer root ext4 filesystem or inner XFS pool has less than
10% available. It also requires the pool's still-unallocated possible growth
to fit above that outer 10% floor; an oversized sparse logical ceiling is
rejected even though it has not consumed blocks yet. These checks reserve no
bytes. The finite pool ceiling plus per-user kernel quota are the hard limits;
the dual free-space check prevents new work from starting while either layer
is under pressure. For operations wrapped by the platform, the API reports:

- `storage_quota_exceeded` when the user's byte or inode ceiling would be
  crossed;
- `storage_pool_full` when the pool gate rejects new work or a wrapped write
  returns `ENOSPC`.

An arbitrary user command receives the kernel error directly. Acceptance on
the target kernel confirmed that XFS project-quota exhaustion can be reported
as `ENOSPC` (the test file stopped exactly at the configured hard limit even
with XFS space still available), not only `EDQUOT`. A wrapped platform
operation therefore disambiguates `ENOSPC` with a fresh trusted project-quota
measurement; errno alone must not be presented as proof that the shared pool
is full. No watcher or admission function is claimed to intercept arbitrary
guest writes.

Deleting a file frees the user's XFS project quota immediately, but it does not
by itself guarantee that ext4 deallocates the corresponding blocks of the
sparse backing file. The mount therefore uses explicit `nodiscard` for
predictable write/delete latency and the root-owned
`brai-user-storage-trim.timer` runs `fstrim` daily. Preflight and every
`ExecStartPre` require that `fstrim` exists and the timer is active. The
disposable acceptance harness proves the full chain on this kernel: backing
allocation grows after a real XFS write, then decreases after delete plus
`fstrim`. Until trim runs, `stat.blocks` deliberately remains counted by the
outer-headroom gate; host physical space is not claimed to return immediately
on deletion.

The default per-user contract in `config/runtime.example.json` is a 5 GiB / 500,000
inode hard limit, but each user's persisted access state may select a different
positive byte/inode ceiling. Provisioning binds the allocation, XFS enforcement
and receipt to that exact persisted value. Workspace data, SQLite, user-run Postgres, rootless Docker
layers/volumes, configuration, caches, temporary files, sockets, and logs all
live below `/data` and therefore count toward the same quota.

## Aggregate host resource boundary

Per-environment limits are not a host availability boundary when many users run
in parallel. Every `brai-user-sandbox@` instance therefore belongs to the
root-owned `brai-users.slice`. The reference slice applies aggregate
`MemoryMax`, `MemorySwapMax`, `CPUQuota` and `TasksMax`; the per-environment
reference is separately capped at 4 GiB RAM, 2 GiB swap, 200% CPU and 2,048
tasks.

For the current 31 GiB RAM / 8 GiB swap host, the installed policy uses
24 GiB aggregate RAM, 4 GiB aggregate swap, 600% CPU and 12,288 tasks. This
deliberately leaves roughly 7 GiB RAM, 4 GiB swap and two CPU cores outside the
user-sandbox slice for the OS and Brai platform. These are initial sizing
values, not portable constants. The source policy is
`config/host-resource-policy.example.json`; deployment must render the actual
root-owned policy to `/etc/brai-agent-runtime/host-resource-policy.json` and
generate matching slice settings after host-specific load testing.

`admitSandboxLaunchResources()` accepts only a fresh trusted host cgroup
measurement. It fails closed when the slice is unmeasured, inactive, named
incorrectly, configured with different caps, or lacks the host-owned minimum
RAM/swap/task headroom. Its stable denial codes are returned through the signed
launcher seam. Admission is performed under the host-wide launch fence; the
kernel cgroup is still the race-safe hard boundary. Neither this resource
admission nor the slice reserves, estimates, or changes disk space, and no AI,
prompt, agent, or client may supply its policy or facts.

## No clone per task or agent

The immutable outer image is shared. It is never copied for a user, project,
task, or agent. User persistence is only
`/srv/brai-user-data/<allocated-environment-name>`.
The examples contain exactly one writable bind. They do not mount the Brai
checkout, host root, host Docker socket, Caddy state, platform secrets, NATS
credentials, or core Supabase credentials.

Each allocated slot has one host-level rootless Docker engine. It runs as the
slot's deterministic locked/no-login `brai-eng-<base36-slot>` Linux service
principal; this principal is an OS enforcement identity, not an agent, broker,
or access decision-maker. RootlessKit, dockerd, containerd, runc,
fuse-overlayfs and slirp4netns are copied from the digest-pinned sandbox image
to the root-owned `/srv/opt/brai-user-engine` installation, so every slot uses
one immutable binary set rather than a copied engine tree.

The engine unit has its own systemd mount namespace. Only the matching
`/srv/brai-user-data/<environment>` is bind-mounted as `/data`; the project
checkout, host homes, Caddy, runtime credentials and host container sockets are
explicitly inaccessible. Docker data, exec state, layers, build cache, named
volumes, logs and temporary files stay under `/data` and therefore count toward
the same XFS project quota. The socket is owned by the slot UID/GID, lives under
`/run/brai-user-engines/<environment>`, and is bind-mounted only into the
matching nspawn environment at `/run/user/1000/docker.sock`.

The engine service is `Type=simple`; readiness requires a successful `_ping`
and `docker info` proving both rootless mode and `/data/docker` as the data
root. A dedicated AppArmor profile permits only the installed RootlessKit path
needed by this design while
`kernel.apparmor_restrict_unprivileged_userns=1` remains enabled. A systemd
cgroup IP filter allows only slirp's virtual DNS and denies host/private/link
local ranges, the host's exact public address, and IPv6. The ordinary-runtime
acceptance additionally proves public egress and denial of host/private
endpoints from a real nested container.

The outer namespace uses a stable provisioner-assigned range of 131,072 IDs,
not `PrivateUsers=pick`: 65,536 IDs are insufficient for both the outer image
users and the nested rootless Docker mapping. The range, matching data owner,
subordinate ranges and XFS project ID must be allocated atomically and must
never be recomputed at launch. A normal user gets no host login account. The
environment name is only a stable instance/storage label; `/data` uses the
reserved numeric `START+1000` owner. Provisioning scans all host account UIDs
and group GIDs and rejects any collision anywhere in the allocated 131,072-ID
window.

The complete v1 host pool is fixed at
`0x70000000..0x7FFDFFFF` (`1879048192..2147352575`). This is the exact unused
gap after systemd-nspawn's automatic `0x00080000..0x6FFFFFFF` allocation range
and before systemd's `0x7FFE0000..0x7FFEFFFF` foreign-image range, and it stays
below `2^31`. The pool contains 2,047 aligned environment slots
(`0..2046`). A slot belongs to one persistent user environment; any number of
agents and projects inside that environment do not consume more slots.
The current access store makes `allocation_slot` globally unique and does not
store a runtime-host assignment, so foundation v1 is deliberately a
single-user-sandbox-host/global capacity of 2,047 environments. Adding another
runtime host is not implemented by this contract: it requires an explicit
access migration for immutable `runtime_host_id`, composite
`(runtime_host_id, allocation_slot)` uniqueness, and receipt/launch binding to
that host. The v1 pool must never be silently extended into foreign or
signed-32 IDs.

Before any sandbox is enabled, the entire pool must occur exactly once in both
`/etc/subuid` and `/etc/subgid` as
`brai-sandbox-map:1879048192:268304384`. `brai-sandbox-map` is one locked,
no-home, `/usr/sbin/nologin` system principal with an isolated primary group.
This reservation prevents later shadow-utils `useradd` subordinate-range
allocation from taking part of the pool. It is not used as the runtime user.
Every runtime and provisioning receipt re-parses the complete passwd, group,
subuid and subgid databases, requires locally enumerable `files[/systemd]`
NSS, measures the installed systemd container allocator from `systemd.pc`, and
fails closed on malformed, duplicate, overlapping, missing or shifted facts.
This is necessary because systemd-nspawn `pick` coordinates through NSS rather
than `/etc/subuid`; Brai also never uses `pick`, and its pool is outside that
allocator by construction.

The outer systemd example also applies conservative per-environment
memory/swap, task, CPU and IO limits below the aggregate slice. `TMPDIR`,
`SQLITE_TMPDIR`, Docker data/config/temp and all persistent runtime paths stay
under `/data`, so temporary SQLite and build files count toward the same XFS
project quota.

## Stable identity and project allocation

`allocateEnvironment()` is pure and deterministic from a persisted numeric
slot. Repeating the same user/slot/policy produces the same result; no scan for
“the next free UID” occurs during launch. Each slot owns an aligned UID/GID
window of exactly 131,072 IDs. The image account `brai` (`1000:1000`) maps to
host `START+1000`, while its inner rootless-container subordinate UID/GID window
is exactly `START+65536` through `START+131071` (65,536 IDs).

The same slot deterministically produces a unique environment name, a unique
XFS project ID, and one canonical data path below the configured storage root.
Registry validation rejects duplicate users, slots, environment names and project
IDs; overlapping UID/GID windows; path escape; non-canonical paths; and quota
errors. Per-user hard limits are persisted allocation data and may differ from
the defaults and from one another. Slot ownership is durable service data and
must never be reused for a different user merely because an environment is
stopped.

`install/install-host-id-pool.sh.example` is a fail-closed, idempotent
installation reference. Its packaged checker must report either an already
exact state or a wholly absent and collision-free first-install state. A
partial principal/range, unsupported NSS source, allocator collision, uint32
overflow, or concurrent/manual change aborts installation; post-install audit
must pass before anything can launch. Repository build/test tasks do not
execute the installer or alter host identity databases. Host activation is an
explicit root-owned deployment action. The installer verifies before any
mutation that the host shadow-utils `usermod` exposes
`--add-subuids FIRST-LAST` and `--add-subgids FIRST-LAST`; unsupported versions
fail before creating the principal.

After provisioning, `createProvisioningReceipt()` can produce a JSON-safe
receipt only when all of the following are true:

- the injected preflight passes for `user-sandbox`;
- the whole allocation registry passes uniqueness and overlap checks;
- the target allocation occurs exactly once;
- the complete trusted host-principal scan proves that neither allocated ID
  window intersects `/etc/passwd` or `/etc/group`;
- the real, canonical bind path is a directory, passes effective read/write/
  search checks, and its reserved numeric UID/GID match `START+1000`;
- the allocation quota exactly equals the user's persisted quota state;
- the slot engine's exact `START+65536:65536` subordinate delegation and
  locked/no-login principal match the persisted allocation;
- the immutable image digest, canonical root-ext4 backing file, loop source,
  finite aggregate logical ceiling and shared XFS mount are verified;
- the target tree has the allocated XFS project ID plus project inheritance,
  active enforcement and exact byte/inode hard limits;
- the access generation and injected UTC timestamp are valid.

The receipt records the image SHA-256, loop device/mount, canonical backing
file, aggregate logical ceiling, XFS project ID, verified byte/inode limits,
slot-engine and effective-host identity mapping, access generation and
timestamp.
Persistence and receipt signing belong to the owning service/secret system and
are intentionally outside this host scaffold.

## Preflight

These commands only inspect; they never grant a profile or change the host:

```text
pnpm exec tsx infrastructure/agent-runtime/src/cli.ts \
  --profile developer --checkout /srv/projects/brai-new

pnpm exec tsx infrastructure/agent-runtime/src/cli.ts \
  --profile user-sandbox \
  --environment-name <allocated-environment-name> \
  --storage /srv/brai-user-data \
  --image /srv/opt/brai-agent-runtime/images/user-sandbox-v1.raw
```

Exit status `0` means every invariant passed, `1` means one or more stable
error codes were returned, and `2` means inspection itself could not run. A
missing prerequisite disables `user-sandbox`; it must never trigger a fallback
to developer privileges or to an unquoted directory on the root disk.

The image must be strictly below
`/srv/opt/brai-agent-runtime/images`. Every ancestor from its parent up to and
including `/` must be a real root-owned directory with no group/other write
bits; checking only the configured image root is insufficient because an
ancestor could replace it. Both the image and `<image>.sha256` must be regular non-symlink
`root:root` files with no group/other write bits. Inspection opens both with
`O_NOFOLLOW`; SHA-256 is computed through the opened image descriptor.

Preflight is evidence, not a safe path-to-mount handoff. The production
user-sandbox executor must repeat those checks, retain that exact open image
descriptor, and give the same descriptor to `systemd-nspawn` (for example as
an inherited descriptor referenced through `/proc/self/fd/N`). Reopening the
pathname after verification is forbidden because it recreates a TOCTOU race.

The generic CLI intentionally has no authority to mount/inspect the raw image
or query a target XFS project and therefore injects neither guest-runtime nor
project-quota probe facts. A `user-sandbox` CLI run fails closed with a missing
guest-probe code. The installed runtime host uses a root-owned, read-only
integration to supply digest-bound guest facts and actual XFS tree/quota facts.
The production unit names the deployment-owned canonical helper
`/srv/opt/brai-agent-runtime/bin/verified-nspawn`, whose same-descriptor
verification/mount contract is installed and acceptance-tested. A system-path
symlink may exist for convenience, but
`/srv/opt/brai-agent-runtime` remains the source of truth.

The image digest stored in an environment receipt is the provisioning
baseline, not a per-user frozen image copy. A shared-image upgrade stops the
trusted runtime intake and every `brai-user-sandbox@` unit, builds and verifies
one replacement, atomically replaces the canonical image plus sidecar, then
restarts intake and the persistent environments. Every subsequent launch
verifies the current canonical descriptor again. User `/data` survives the
upgrade; no per-user image, database rewrite, recursive ownership repair, or
quota reservation is involved. The canonical builder refuses `--replace`
while intake or any sandbox remains active.

The production **developer** executor must run directly as `mark` with the
verified `initgroups(mark)` set and must not set `NoNewPrivileges=yes` (or an
equivalent flag), because that would silently disable the setuid transition
required by the approved sudo contract. This exception applies only to the
explicit trusted developer profile; it must never be inherited by user
sandboxes. It must set umask `0077` before preflight and preserve it for every
developer child process.

## Developer runtime host

`src/runtime-host-main.ts` is the root-owned, server-only NATS process for the
developer executor. It has no database connection string or database role. Its
only authorities are the access-service launch public key, its own receipt
private key, the exact NATS account permissions, the transient systemd
controller, and its `0700` local registry.

The launch sequence is fixed:

1. parse the strict `brai.runtime.agent-run.launch.v1` request;
2. verify the Ed25519 launch contract, lifetime, `developer` profile, prompt
   digest in the immutable job reference, canonical fixed Codex argv digest,
   runtime host, user and generation bindings;
3. create a `mark` transient unit whose leader is the native
   `/srv/opt/brai-agent-runtime/bin/brai-exec-gate`; systemd opens the
   `root:mark 0440` prompt file as stdin, so neither prompt nor secret gate
   token appears in the target argv and another `mark` process cannot rewrite
   or chmod the gate files;
4. measure boot ID, InvocationID, cgroup path/inode, PID/start time and the
   complete fresh `initgroups(mark)` identity, persist them in the root-owned
   registry, sign a `runtime-claim-v2` receipt and send it to brai-access;
5. release the same PID through `execve` only after brai-access confirms the
   one-use database CAS; any refusal kills the measured gate instead;
6. sign and persist `runtime-started-v2`, then wait until the whole cgroup is
   empty, sign `runtime-exit-v2`, and retain the `RemainAfterExit` unit until
   brai-access acknowledges the exact exit receipt.

Restart recovery reloads only validated `0600` registry entries. A held gate
can repeat the idempotent claim CAS, a claimed gate can be released, an
observed exit can be re-submitted, and an active run can resume its cgroup
monitor. Cancellation-before-start is a durable tombstone, so a delayed launch
with the same run ID cannot cross a completed mode transition.

Exact termination uses `brai.runtime.agent-run.terminate.v1`. The request must
repeat the captured project, user, generation and typed runtime identity. The
host refuses a different boot, InvocationID, cgroup inode, PID/start time or
unit, kills only the recorded cgroup, proves it empty and returns a signed
`runtime-termination-v2` envelope. A null identity is accepted only before a
runtime claim and creates a durable cancellation tombstone.

The runtime NATS client uses `_INBOX.brai.runtime` so its reply subscription can
be limited to `_INBOX.brai.runtime.>`. The access side owns only the receipt
public key; the private key is loaded exclusively into the host unit through a
systemd credential. `install/provision-runtime-host-keys.sh` generates that key
once, derives the canonical SPKI PEM public key and atomically writes only its
base64 form and key ID to the external brai-access env. The same helper reads
the access issuer's canonical base64 PKCS#8 PEM without sourcing the env,
validates canonical encoding and Ed25519 type, derives only the SPKI public key
for the host and immediately removes its root-only temporary decode. It never
persists either private key outside its owning external secret file.

The installation order is:

1. build the bundle and run `install/install-runtime-host.sh <source-root>`;
2. run `/srv/opt/brai-agent-runtime/bin/provision-runtime-host-keys
<receipt-key-id> /etc/brai-new/access.env`;
3. provision the separate `nats-password` systemd credential, verify the exact
   NATS ACL and only then enable/start `brai-agent-runtime-host.service`.

The installer deliberately does not enable or start the service and does not
invent a NATS password.

The developer handler rejects `user-sandbox` contracts before gate creation.
Ordinary user environments require their own nspawn executor and can never
fall back to this host-`mark` path.

## Deployment boundary

The files under `systemd/` and `nspawn/` are source templates. Host deployment
renders and installs root-owned copies. A complete activation must:

1. create exactly one bounded sparse
   `/srv/brai-storage/user-data.xfs` on root ext4, install its immutable
   logical-ceiling file, mount it at `/srv/brai-user-data` through the
   canonical systemd loop-XFS `prjquota` unit, and pass both outer and inner
   10% free-space gates;
2. install the canonical verified launcher below
   `/srv/opt/brai-agent-runtime/bin`, plus the immutable image and digest below
   its trusted root-owned chain through `/`, then mount only the same
   `O_NOFOLLOW` descriptor that was hashed;
3. persist a unique allocation slot, then provision its exact locked/no-login
   engine service principal, collision-free aligned 131,072-ID outer mapping,
   65,536-ID subordinate range, XFS project ID, canonical data path, and
   per-user hard quota limits;
4. install and verify the exact locked `brai-sandbox-map` whole-pool
   subuid/subgid reservation, then run preflight and stop on any error code;
5. size and install the root-owned host resource policy and matching
   `brai-users.slice`, verify its active measured kernel caps, and keep every
   sandbox template below it;
6. install generated units/config as `root:root`, mode `0644`, through a trusted
   deployment process;
7. let only the signed-snapshot launcher admit and start a specific template
   instance under both the per-user generation fence and host-wide resource
   fence.

The storage scripts are explicit host-deployment artifacts and are not run by
repository build/test tasks:

- `install/install-user-storage.sh LOGICAL_BYTES` creates/formats the one
  backing file only when absent, refuses in-place size changes, requires the
  canonical units to be installed, mounts them, and performs a full status
  check. Repeating it with the exact same state is idempotent.
- `install/status-user-storage.sh` verifies root ownership/modes, the root ext4
  parent, finite/sparse bounds, XFS signature, unique loop mapping, project
  quota option, both free-space floors, and the enabled/active trim timer.
  `--backing-only` is the setup unit's pre-mount check.
- `install/uninstall-user-storage.sh` disables and unmounts the runtime but
  deliberately retains the backing file and all user data. Data deletion is a
  separate audited teardown and is never hidden in uninstall.
- `install/provision-project-quota.sh` creates one canonical allocation
  directory without recursive ownership repair, applies project inheritance
  and exact byte/inode hard limits, then calls the read-only
  `measure-project-quota.sh` verifier.
- `acceptance/one-disk-project-quota.sh` is an explicit root-only, disposable
  `/tmp` harness. It creates one 1 GiB sparse file, mounts it through loop XFS,
  applies an 8 MiB project limit, proves a 9 MiB write stops at exactly 8 MiB,
  deletes the file, runs `fstrim`, proves allocated backing blocks decrease,
  and unmounts/removes its own temporary state. It never touches `/etc` or
  production paths.

The current host deployment installs these scripts below
`/srv/opt/brai-agent-runtime/bin` as root-owned executables, installs
`brai-user-storage-setup.service` and the escaped
`srv-brai\x2duser\x2ddata.mount`, plus
`brai-user-storage-trim.service/.timer`, and only then invokes the installer. The
repository never modifies `/etc`, formats storage, attaches a loop device, or
starts a unit during build/test.

The reference veth is not an authorization boundary by itself. Activation also
requires the installed and tested host firewall/egress policy that blocks host
services, core Docker networks and cross-user traffic while allowing approved
internet egress and platform-controlled ingress flows. Filesystem preflight
alone can never enable `user-sandbox`.

No runtime profile is accepted from a command, URL, request body, prompt, model,
tool call, or environment variable. Developer-mode changes invalidate the old
snapshot generation and terminate its live runtime; rights are never changed in
place.
