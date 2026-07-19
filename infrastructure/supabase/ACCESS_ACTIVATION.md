# brai_access database activation

This is an operator-run, one-time database/backup activation. It does not use
GitHub, a deploy principal, an AI agent, or `/srv/projects/brai`.

## Preconditions

- `supabase-db` is healthy on the external Docker network `brai-supabase`.
- `/etc/brai/supabase-deploy.env` is a root-owned mode `0600` regular file.
- `brai_access.agent_runs` is empty before applying
  `0002_typed_runtime_lifecycle.sql`; that migration deliberately fails rather
  than inventing typed identities for legacy runs.
- The shared `/srv/opt/brai-db-telegram-backup.sh` is root-owned, executable,
  and not group/world writable.
- `/home/mark/DEPLOYMENT.md` is updated in the same host change because the
  wrapper/drop-in and protected env contract are installed environment support.

Build the reviewed one-off image from the exact source being activated:

```bash
cd /srv/projects/brai-new
sudo docker build \
  --file services/brai-access/Dockerfile.admin \
  --tag brai-access-admin:db-activation \
  .
```

## Ordered activation

1. Install the independent backup wrapper and verify its exact source, owner,
   mode, fixed path, and complete schema list:

   ```bash
   sudo ./infrastructure/supabase/install-access-database-tooling.sh
   sudo ./infrastructure/supabase/status-access-database-tooling.sh
   ```

2. Take and verify a backup before the new migration. The wrapper fails unless
   both `brai_factory` and `brai_access` exist:

   ```bash
   sudo systemctl start brai-db-telegram-backup.service
   sudo systemctl --no-pager --full status brai-db-telegram-backup.service
   ```

3. Generate protected configuration. Re-running this command preserves every
   existing generated value:

   ```bash
   sudo ./infrastructure/docker/provision-production-env.sh
   ```

4. Reapply shared Supabase `PUBLIC`/`pg_net` hardening before creating either
   login:

   ```bash
   sudo ./infrastructure/supabase/apply-runtime-role-hardening.sh
   ```

5. While `brai_access_migrator` does not exist, apply all checked-in foundation
   migrations with the one-time bootstrap credential:

   ```bash
   sudo docker run --rm \
     --network brai-supabase \
     --env-file /etc/brai-new/access-bootstrap.env \
     brai-access-admin:db-activation \
     node dist/bootstrap-foundation.js
   ```

   The command requires the protected PostgreSQL bootstrap login with
   `CREATEROLE` authority (the self-hosted Supabase `postgres` login) and
   permanently refuses to run after the migrator role is created. It does not
   require or store the `supabase_admin` password.

6. Verify the complete checksum ledger, transfer ownership of only
   `brai_access`, create the bounded role as `NOLOGIN`, then provision its
   separate password and audit the final `LOGIN` state:

   ```bash
   sudo docker run --rm \
     --network brai-supabase \
     --env-file /etc/brai-new/access-bootstrap.env \
     brai-access-admin:db-activation \
     node dist/bootstrap-migration-role.js
   sudo docker run --rm \
     --network brai-supabase \
     --env-file /etc/brai-new/access-bootstrap.env \
     brai-access-admin:db-activation \
     node dist/provision-migration-role.js
   sudo docker run --rm \
     --network brai-supabase \
     --env-file /etc/brai-new/access-bootstrap.env \
     brai-access-admin:db-activation \
     node dist/audit-migration-role.js
   ```

7. Prove that the permanent migration path works without an administrator
   credential. It should report zero pending migrations:

   ```bash
   sudo docker run --rm \
     --network brai-supabase \
     --env-file /etc/brai-new/access-migrations.env \
     brai-access-admin:db-activation \
     node dist/migrate.js
   ```

8. Provision and independently audit the runtime login:

   ```bash
   sudo docker run --rm \
     --network brai-supabase \
     --env-file /etc/brai-new/access-bootstrap.env \
     brai-access-admin:db-activation \
     node dist/provision-runtime-role.js
   sudo docker run --rm \
     --network brai-supabase \
     --env-file /etc/brai-new/access-bootstrap.env \
     brai-access-admin:db-activation \
     node dist/audit-runtime-role.js
   ```

9. Take a second successful backup of both schemas. Do not start the access
   service or runtime controller unless all prior commands and the backup pass.

## Failure behavior

Every migration, ownership handoff, and role provisioner uses a transaction
plus an advisory lock. A failed audit rolls its own operation back. After the
ownership handoff, do not guess a reverse migration or manually broaden grants:
keep the access service stopped, preserve the first backup, and diagnose the
failed exact check. Neither recursive filesystem permission repair nor any
change to the old Brai checkout is part of this procedure.
