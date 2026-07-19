# Local Compose and protected runtime configuration

Runtime containers:

- `brai-web` — static Next.js export on `127.0.0.1:3200`.
- `brai-api-gateway` — Fastify on `127.0.0.1:3201`.
- `brai-nats` — private NATS and JetStream storage; `127.0.0.1:4222` is
  reserved for the trusted runtime host only.
- `brai-factory` — internal Activity worker with private database access.
- `brai-access` — internal access-state and runtime-lifecycle service with
  private database access.

Protected configuration lives in `/etc/brai-new` and is created idempotently:

```bash
sudo ./infrastructure/docker/provision-production-env.sh
```

Re-running the generator preserves every existing generated Factory, access,
runtime, and NATS username/password. It writes atomically with root ownership
and mode `0600`. Access database authority is split across
`access-bootstrap.env`, `access-migrations.env`, and `access.env`; the normal
migration and runtime files never contain the PostgreSQL bootstrap URL.
`nats.env` contains separate gateway, Factory, access-service, and runtime-
controller credential pairs. Their subject ACLs remain in the NATS server
configuration, never in a client-supplied payload.

The root `compose.yml` is a local/manual development model. It has build
contexts and must not be used by CI/CD on the production host.

Apply migrations, harden shared PostgreSQL/Supabase defaults, and provision
the runtime role as separate one-off bootstrap operations:

```bash
docker compose --profile admin build brai-factory-admin
docker compose --profile admin run --rm --name brai-factory-migrations brai-factory-admin
sudo ./infrastructure/supabase/apply-runtime-role-hardening.sh
docker compose --profile admin run --rm --name brai-factory-role-provisioner \
  brai-factory-admin node dist/provision-runtime-role.js
```

The access schema has a one-time bootstrap followed by a permanent
least-privilege migration path:

1. run `bootstrap:foundation` with `access-bootstrap.env`;
2. run `bootstrap:migration-role` and `provision:migration-role` with that same
   protected bootstrap file;
3. run every regular `migrate` with only `access-migrations.env`;
4. provision and audit `brai_access_runtime` with `access-bootstrap.env`;
5. give the service only `access.env`.

The regular runner verifies that its database `current_user` is exactly
`brai_access_migrator`; putting an administrator URL in
`access-migrations.env` therefore fails closed.

For a local/manual build, start the five runtime containers:

```bash
docker compose up -d --build brai-web brai-api-gateway brai-nats brai-factory brai-access
```

No service port may be published on a non-loopback host address.

Production uses the digest-only Compose model and fixed receiver documented in
`../deployment/README.md`. That path never builds from or writes to the live
project checkout.
