# Supabase migrations for Brai Factory

This package owns the private PostgreSQL schema `brai_factory`.
Migrations are an explicit deployment step and are never run by the
`brai-factory` service at startup.

Required administrator environment:

```text
BRAI_FACTORY_MIGRATION_DATABASE_URL=
BRAI_FACTORY_MIGRATION_DATABASE_SSL=disable
```

Apply pending **Brai Factory-owned** migrations. The runner deliberately
ignores migrations owned by other services:

```bash
pnpm --filter @brai/supabase-migrations migrate
```

`brai-access` has its own migration image, credential, advisory lock, and
`brai_access.schema_migrations` ledger under `services/brai-access`; never add
access-schema DDL to this Factory runner.

PostgreSQL and Supabase grant database `TEMPORARY`, `public` schema access and
`pg_net` schema access through `PUBLIC`. Before provisioning a Brai service
login, apply the idempotent server-side hardening. It materializes the current
access for existing non-service roles, preserves the standard Supabase roles,
and excludes every generated `brai_*_runtime` role:

```bash
sudo ./infrastructure/supabase/apply-runtime-role-hardening.sh
```

The first migration creates a locked, non-login role named
`brai_factory_runtime`. Provision or rotate its login password separately:

```text
BRAI_FACTORY_RUNTIME_DATABASE_PASSWORD=
```

```bash
pnpm --filter @brai/supabase-migrations provision:runtime-role
```

Role provisioning performs a fail-fast privilege audit. The same audit can be
run independently:

```bash
pnpm --filter @brai/supabase-migrations audit:runtime-role
```

The next migration applies database-side safety limits to every runtime
session, independently of application configuration:

- at most 10 concurrent connections for `brai_factory_runtime`;
- a 4-second statement timeout;
- a 2-second lock wait timeout;
- a 5-second idle-in-transaction timeout.

The role audit fails if any limit is absent, changed, or overridden for an
individual database.

The commands never print the password. Application
credentials belong in the protected server environment, never in this
directory or source control.

The schema is intentionally not added to Supabase/PostgREST exposed schemas.
No grants are made to `anon`, `authenticated`, `authenticator`, or
`service_role`.

The access database replaces the earlier Factory-only backup hook with an
independent host-owned wrapper:

```bash
sudo ./infrastructure/supabase/install-access-database-tooling.sh
sudo ./infrastructure/supabase/status-access-database-tooling.sh
```

The idempotent installer writes only
`/srv/opt/brai-access/bin/pre-migration-backup` and
`/etc/systemd/system/brai-db-telegram-backup.service.d/zz-brai-access.conf`.
The `zz-` ordering makes this access-owned replacement remain authoritative
even if older Factory/deployment tooling is reinstalled later.
The drop-in invokes that fixed wrapper and requires both `brai_factory` and
`brai_access` to exist before the shared backup program runs. The wrapper
filters the configured list against measured database schemas, checks the
shared backup executable's ownership/mode, disables its legacy checkout hook,
and never reads a deploy/CI credential.

The older `brai-factory-backup.conf` remains only as historical source for a
Factory-only installation. If older tooling reinstalls it, the later
`zz-brai-access.conf` still supplies the effective command and the complete
schema contract.
