# brai-access migrations

These migrations are applied only by `@brai/brai-access` using the dedicated
access migration credential, advisory lock, and `brai_access.schema_migrations`
ledger. Factory migrations must never read this directory.

The one-time bootstrap command applies the complete foundation before
`brai_access_migrator` exists. The ownership bootstrap then verifies the exact
checksums of all files listed below and hands only this schema to that bounded
role. After the handoff, the regular migration command refuses an administrator
connection and accepts only `current_user = brai_access_migrator`.

- `0001_initial.sql` owns the initial access state, allocation, membership, and
  historical v1 lifecycle tables. Its checksum is immutable after deployment.
- `0002_typed_runtime_lifecycle.sql` replaces opaque runtime evidence with
  immutable launch/job bindings, typed systemd/cgroup identities, and typed
  JSONB lifecycle receipts. It fails closed if legacy agent runs exist rather
  than fabricating missing command or process-tree facts.
