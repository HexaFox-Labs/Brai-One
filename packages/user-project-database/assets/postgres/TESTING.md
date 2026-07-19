# Postgres template acceptance specification

These are runtime acceptance checks for the isolated user environment. They are
not unit tests and must never run against the host Docker daemon from CI.

1. Refuse startup unless the container engine reports rootless mode and its real
   data root is below the user's quota-backed storage root.
2. Render the Compose model and assert that `postgres` has no `ports` entries,
   that its only network has `internal: true`, and that all required variables
   and the password secret resolve without printing the secret.
3. Pull only an administrator-approved immutable image digest. Inspect its
   configured postgres UID/GID, start it with those IDs, and assert that the
   final database process is not UID 0 in the container.
4. Assert that no host socket listens on PostgreSQL port 5432. Connect only from
   a test application container attached to the same per-user internal network.
5. Create data larger than one WAL segment and verify that the database volume,
   WAL, temporary files, and backups all increase the same user's quota usage.
6. Stop application writers, make a custom-format `pg_dump`, restore into an
   empty database with `--single-transaction --exit-on-error`, and compare row
   counts plus application invariants.
7. Exhaust a disposable test quota and verify failure remains inside that user
   environment, does not consume Brai core database connections, and is surfaced
   as `storage_quota_exceeded` by the calling product layer where detectable.
8. Restart the rootless runtime and host; verify the named volume remains under
   the same quota root and Postgres recovers without ownership repair.

Do not accept a deployment that needs recursive `chown`/`chmod`, a published
database port, the host container socket, host root, or credentials for Brai's
core Supabase.
