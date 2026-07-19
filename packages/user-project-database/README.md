# `@brai/user-project-database`

Safe v1 database primitives for projects inside one normal user's persistent,
quota-backed environment. The isolated user runtime is active; public Gateway
and core services still do not open user project databases themselves.

## Default: SQLite

```ts
import { openUserProjectDatabase } from "@brai/user-project-database";

using database = openUserProjectDatabase({
  workspaceRoot: "/workspace",
  databaseFile: "projects/example/data/project.sqlite",
});

database.exec(`
  CREATE TABLE IF NOT EXISTS task(
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL
  ) STRICT
`);

database.transaction((transaction) => {
  transaction.run("INSERT INTO task(title) VALUES (?)", "Example");
});

await database.backupTo("backups/example.sqlite");
```

The helper requires Node 22.22.3+ on the Node 22 line and SQLite 3.51.3 or
newer. It creates private `0600` database files, enables WAL, foreign keys,
`synchronous=NORMAL`, a 5-second busy timeout, and bounded synchronous
transactions. It rejects path escapes, symlink aliases, and known network or
userspace filesystems that are unsafe for WAL.

`backupTo()` uses Node's SQLite online backup API, validates the result with
`PRAGMA quick_check`, flushes it, and atomically renames it over the destination.
The guarded `VACUUM INTO` branch is only a compatibility fallback for a runtime
that lacks the backup export. Never copy a live `.sqlite` file with `cp`, a file
API, or an archive tool: committed pages may still be in `-wal`, so a raw copy is
not a database backup.

Quota enforcement is a filesystem concern. This package maps `EDQUOT` and
SQLite's generic `SQLITE_FULL` to `storage_quota_exceeded`, while an explicit
filesystem `ENOSPC` becomes `storage_pool_full`; it does not reserve space or
implement a quota. The database, WAL/SHM files,
temporary files, backups, and rootless-container data must all live on the same
per-user hard-quota filesystem.

Important limitations:

- `DatabaseSync` blocks its Node event loop. Use it in the user's worker/runtime,
  never in the public Gateway event loop.
- The transaction duration limit is a commit guard: over-limit work is rolled
  back, but synchronous JavaScript cannot be preempted while the callback runs.
- Filesystem magic-number checks reject known-unsafe mounts but cannot prove a
  mount's durability. Production must supply the local quota-backed XFS volume.
- All agents inside one user's environment share that user's trust boundary.
  Atomic backup replacement protects consistency, not against the same user
  deliberately racing their own paths.
- The wrapper owns one connection. It does not expose Brai core Supabase and does
  not create schemas, roles, or extensions there.

## Optional: rootless Postgres

[`assets/postgres/compose.yaml`](./assets/postgres/compose.yaml) is the opt-in
template for projects that genuinely need Postgres. SQLite remains the default.
The template has no published host port, attaches Postgres only to a private
internal network, drops all capabilities, uses a read-only container root, and
runs the final process as the image's non-root postgres UID/GID.

Before rendering the template, the runtime must:

1. Prove the engine is the user's rootless engine—not the host engine.
2. Prove its real Docker/Podman data root is below `BRAI_USER_STORAGE_ROOT`.
   The named `postgres-data` volume then counts against the same user quota.
3. Supply an administrator-approved immutable image digest and its postgres
   UID/GID. A mutable tag or an image that needs a root final process fails
   closed.
4. Create `secrets/postgres-password` below the user root with mode `0600`.
   Never place the password in Compose, repository files, command arguments, or
   Brai's core secret store.

Application containers must join the named internal network; host processes and
other users cannot connect. Do not add `ports`, `network_mode: host`, the host
Docker socket, or a core-Supabase credential.

For a consistent backup, pause project writers and stream a custom-format dump
to a private temporary file below the quota root, then rename it atomically:

```sh
umask 077
docker compose exec -T postgres sh -eu -c \
  'export PGPASSWORD="$(cat "$POSTGRES_PASSWORD_FILE")"; exec pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom' \
  > "$BRAI_USER_STORAGE_ROOT/backups/project.dump.partial"
mv "$BRAI_USER_STORAGE_ROOT/backups/project.dump.partial" \
  "$BRAI_USER_STORAGE_ROOT/backups/project.dump"
```

Restore only into an empty/disposable user database after validating the dump
path, with application writers stopped:

```sh
docker compose exec -T postgres sh -eu -c \
  'export PGPASSWORD="$(cat "$POSTGRES_PASSWORD_FILE")"; exec pg_restore --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --clean --if-exists --single-transaction --exit-on-error' \
  < "$BRAI_USER_STORAGE_ROOT/backups/project.dump"
```

The runtime acceptance contract is in
[`assets/postgres/TESTING.md`](./assets/postgres/TESTING.md). Package unit tests
use only temporary local SQLite files and never touch Docker.
