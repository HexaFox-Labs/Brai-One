# Immutable production deployment

Production does not run from `/srv/projects/brai-new`. GitHub builds seven OCI
images, records their GHCR digest references in a strict JSON manifest, and
sends only that manifest to a fixed host command. The command has no prompt,
model, agent, plugin or policy broker in its decision path.

The host-owned deployment root is `/srv/opt/brai-new-deploy`:

- `compose.production.yml` has no `build` keys and no source bind mounts;
- production containers are named `prod-brai-*`, isolated from legacy
  `brai-*`, `d-brai-*` and `pNN-brai-*` runtime identities;
- `releases/<git-sha>/manifest.json` and `images.env` are immutable inputs;
- `current` points to the last release that passed all container healthchecks;
- `previous` keeps the immediately preceding healthy digest set for an
  operator-requested rollback; older Brai-only image references are removed
  after the next successful rollout without running a global Docker prune;
- runtime configuration remains in root-owned `/etc/brai-new/*.env`;
- only web and Gateway bind host ports, both on `127.0.0.1`; Caddy remains the
  sole external listener on HTTP/HTTPS.

## Mechanical release sequence

`receive-release` accepts at most 64 KiB on standard input. It rejects unknown
fields, tags, a wrong repository, a partial image set, and every reference that
is not the exact expected GHCR path plus `sha256` digest. It writes no project
file. The explicit `brai.production-host.v3` contract also makes a newer CI
manifest fail closed on older host tooling instead of guessing compatibility.

The locked deploy command then:

1. checks root ownership and non-writable deployment control files;
2. validates Compose and pulls all seven images by digest;
3. requires a successful pre-migration backup containing both service schemas;
4. runs both service-owned migration images to completion;
5. provisions and audits the bounded Factory runtime login before replacing an
   app container; the separately activated least-privilege access runtime role
   is consumed only by `brai-access`;
6. starts the five runtime services with `--no-build --pull never --wait`;
7. switches `current` only after all Docker healthchecks pass;
8. on rollout failure, restores the image set from the previous healthy
   `current` release and waits for health again.

Database migrations are transactional but are not automatically reversed.
The deployment test target pins every foundation migration checksum and
rejects destructive DDL/DML in every later automatic migration. Later changes
must follow expand/contract: deploy additive schema first, remove old readers,
then perform contraction through an explicitly reviewed maintenance path.
Privilege changes, including every `GRANT`, also require that reviewed path;
an automatic migration cannot silently broaden a database role.
Image rollback is automatic; destructive schema rollback is deliberately not
guessed. The mandatory pre-migration backup is recovery evidence, not an
excuse to make automatic migrations destructive.

## One-time activation

Activation is intentionally separate from CI. Do not activate until the
repository exists on GitHub and the production deployment identity is ready.
There is no permission broker or runtime agent in this path. The only SSH
principal is the fixed local system account `brai-new-deploy`; the older host
account named `brai-deploy` is not used and must not receive this key or rule.

The installer is safe to run before credentials exist. It creates, or strictly
audits, a password-locked `brai-new-deploy` account with:

- a non-zero UID and a non-zero dedicated primary group GID;
- no supplementary groups, including `docker`, `sudo` or an administrative
  group;
- `/bin/sh` only because `sshd` needs a shell to execute the forced command;
- a dedicated root-owned, non-writable home
  `/srv/opt/brai-new-deploy-home`, root-owned mode `0755` `.ssh` and root-owned
  mode `0644` `authorized_keys`. These public authorization paths are readable
  because OpenSSH opens them under the locked deploy UID, but that UID cannot
  modify them.

It does not generate, read or install an SSH key. If an existing identity,
home, authorization file or effective sudo grant differs from this contract,
installation stops instead of repairing or broadening it.

An administrator must:

1. install the checked-in tooling without generating credentials:

   ```bash
   sudo /srv/projects/brai-new/infrastructure/deployment/install-host-tooling.sh \
     OWNER/REPOSITORY
   ```

2. put the one intended Ed25519 public key in a temporary root-owned mode
   `0600` file. The file may contain the usual key comment; activation
   canonicalizes only the key type and key body. Do not print it from an
   activation script:

   ```bash
   sudo chown root:root /root/brai-new-deploy.pub
   sudo chmod 0600 /root/brai-new-deploy.pub
   ```

3. finalize activation through the installed, fixed tool:

   ```bash
   sudo /srv/opt/brai-new-deploy/bin/finalize-deploy-activation \
     /root/brai-new-deploy.pub
   sudo /srv/opt/brai-new-deploy/bin/audit-deploy-principal active
   ```

   Finalization holds the deployment lock, installs sudo before SSH
   authorization, and removes all three managed authorization files if its
   final audit fails. Re-running it with the same key is idempotent; it refuses
   an in-place key replacement. The audit enumerates the account's effective
   `sudo -l`, so a broad rule inherited from any other sudoers file or group is
   rejected even when the managed file itself is correct.

4. configure the GitHub Environment named `production`, restrict it to
   `release/*`, require approval, and add only:
   `BRAI_PRODUCTION_DEPLOY_PRIVATE_KEY` and
   `BRAI_PRODUCTION_SSH_KNOWN_HOSTS`;
5. confirm
   `/etc/brai-new/{gateway,factory,nats,migrations,access,access-migrations}.env`, the
   external `brai-supabase` network, Docker Compose, Caddy and the core database
   are already healthy; confirm a successful
   `brai-db-telegram-backup.service` run covers both `brai_factory` and
   `brai_access`; if GHCR packages are private, install a host-side read-only
   GHCR credential for the root Docker client used by the receiver.

The only authorized-key option prefix is
`restrict,command="sudo -n /srv/opt/brai-new-deploy/bin/receive-release.mjs"`.
The corresponding and only effective sudo command is exactly
`brai-new-deploy ALL=(root) NOPASSWD: /srv/opt/brai-new-deploy/bin/receive-release.mjs`.
The root receiver also verifies the intrinsic `SUDO_USER`, `SUDO_UID`,
`SUDO_GID` and `SUDO_COMMAND` values against that local account before reading
a manifest, then reruns the complete active-principal audit on every release
submission. Consequently, a later extra authorized key, supplementary group,
or broad matching rule from any sudoers include makes deployment fail closed
before the submitted manifest is read. The receiver deliberately does not rely
on `SSH_*` variables, because sudo's default environment filtering does not
promise to retain them.

The host key secret must contain a pinned `known_hosts` entry for
`157.254.223.221`; CI never uses `StrictHostKeyChecking=no`. Missing secrets,
missing env files, a missing external network, a manifest mismatch, a failed
migration or an unhealthy service all stop deployment.

The installed backup service uses the fixed `pre-migration-backup` wrapper.
It includes every configured schema that already exists, so a genuinely fresh
database can be backed up before the first service schema is created; after
creation, subsequent backups automatically include that schema. The wrapper
also disables the shared backup script's optional legacy status hook, so a
new-project deployment never executes code from `/srv/projects/brai`.

Every change to an installed receiver, deploy script, backup wrapper, manifest
parser or production Compose contract must bump `HOST_CONTRACT_VERSION` and be
installed on the host as an explicit administrator change. The manifest path
must never update its own root-owned tooling. Until that activation is done,
the version mismatch intentionally blocks deployment.

The first digest deployment has no previous digest release to restore. Perform
that one transition in a maintenance window and verify it before relying on
automatic image rollback for subsequent releases.

The protected promotion workflow normally uses the selected release branch
head. Its optional `revision` input is only for an approved rollback to a
previously persisted exact Dev manifest and never reads an unmerged feature
Preview for that override. It rejects a short or
non-lowercase SHA, never rebuilds an image, and still passes through the same
production Environment and fixed receiver.

Installing or changing this host tooling is an environment change and must be
recorded in `/home/mark/DEPLOYMENT.md` in the same host change. Merely keeping
this uninstalled source scaffold does not change that registry.
