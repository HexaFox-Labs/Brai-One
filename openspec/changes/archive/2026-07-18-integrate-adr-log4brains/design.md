## Context

The old Brai project already publishes a Log4brains static site at
`adr.brai.one`, but its source, wrapper, generated output, and deployment
ownership belong to `/srv/projects/brai`. Brai New uses Node.js 22, pnpm
workspaces, OpenSpec, a Diátaxis documentation layout, and a different
deployment boundary. It currently has one Brai New ADR-style decision under
`docs/decisions/`, but no Log4brains installation or agent governance lane.

The migration must not copy the old ADR records or generated site into Brai
New. The old checkout is read-only for this task and the old static root must
remain available until the new route is verified.

## Goals / Non-Goals

**Goals:**

- Install a pinned, project-local Log4brains dependency under pnpm.
- Use `docs/decisions/` as the new project's ADR source so the existing Brai
  New documentation taxonomy remains intact.
- Provide list, preview, build, and deterministic check commands for agents.
- Add a new Brai New bootstrap ADR without importing legacy ADR data.
- Make ADR impact part of the autonomous OpenSpec/documentation workflow.
- Publish a new static release and switch `adr.brai.one` while preserving the
  legacy static root as rollback material.

**Non-Goals:**

- Migrating or re-writing any ADR from `/srv/projects/brai/docs/adr`.
- Deleting the old project, its source records, or its generated site.
- Changing DNS; the canonical hostname and server IP already exist.
- Opening a new public port or weakening the existing Caddy Basic Auth.
- Replacing OpenSpec with ADR or duplicating normative requirements in ADRs.
- Automatically deploying every documentation edit to production without an
  explicit deployment workflow.

## Decisions

### Keep `docs/decisions/` as the source folder

Use the current Brai New ADR folder instead of introducing a second
`docs/adr/` tree. This avoids duplicate records and preserves the existing
Diátaxis navigation. Log4brains supports a configured ADR folder, so the
legacy folder name is not required.

### Pin Log4brains locally

Add Log4brains `1.1.0` to the root devDependencies and resolve it through pnpm.
This preserves the version already used by the working legacy publication but
removes the new project's dependency on the old wrapper and checkout. A global
installation is explicitly excluded.

### Use a deterministic check plus a Codex skill

The repository checker owns mechanical validation: metadata, source folder,
Log4brains listing/build, and OpenSpec validation. The
`documentation-governance` skill adapter owns agent reasoning: classify ADR
impact, choose audit/sync/backfill/finalize mode, update artifacts, and report
evidence. The repository's `AGENTS.md`, OpenSpec context and scripts remain the
universal enforcement layer, so the mechanism is usable outside Codex Desktop
and from any development agent.

The adapter is installed in the shared Codex skill directory because the
project `.codex/skills` mount is environment-managed and read-only in this
workspace. It does not hold the policy: the policy and executable checks stay
versioned in this repository.

The access-policy checker also permits owner-attributed, read-only regular files
inside `node_modules`, while continuing to reject unsafe writes, set-id bits,
foreign ownership, and unsafe links. This is required for pnpm's immutable
package cache shipped with Log4brains and does not make project source
directories permissive.

### Publish into a new host root

Build releases under `/srv/projects/brai-envs/prod/adr-brai-new/` with a stable
`current` root. The existing `/srv/projects/brai-envs/prod/adr` is left
untouched. Caddy continues to use the existing `/srv/projects` read-only
mount, so no new external port or Caddy container mount is needed. The
canonical route changes only its static root and keeps the existing unified
authentication block.

### Keep the old site as rollback

The cutover is a route-root change after the Brai New site has been built and
checked. If the new route fails, Caddy can be reloaded with the old root. No
legacy data is copied into the new source or publication.

## Risks / Trade-offs

- **[Risk]** Log4brains 1.1.0 brings an older/transitive dependency tree. → Pin
  it in the lockfile, run the project audit/CI checks, and keep ADR Markdown
  usable independently of the renderer.
- **[Risk]** Caddy is currently managed from the old project's host setup. →
  Record the new route root in Brai New deployment documentation and verify the
  live Caddy config before/after reload; do not modify the old checkout.
- **[Risk]** The new site starts without the legacy history. → Make the clean
  catalog explicit in the site/index and preserve the old static root for
  rollback; historical migration remains a separate, explicit decision.
- **[Risk]** Agents may update OpenSpec but forget ADR rationale. → Make ADR
  impact evidence a completion requirement and run it from the project-local
  governance skill and deterministic check.
- **[Risk]** Static output may be partially replaced during publication. →
  stage into a new release and promote through an atomic directory switch.

## Migration Plan

1. Add OpenSpec artifacts and project-local ADR governance rules.
2. Add the pinned dependency, config, scripts, template, and new bootstrap ADR.
3. Build and validate the clean Brai New site locally.
4. Stage a new host release under the Brai New ADR root without touching the
   legacy root.
5. Update the live Caddy ADR root, reload and validate authentication, HTTPS,
   title, search, and the new ADR.
6. If verification fails, restore the old Caddy root and leave the new release
   inactive.
7. Update project documentation, Memory Bank, and the host registry.

## Open Questions

- The long-term Caddy source-of-truth should eventually move from the old
  project's Ansible tree into the new project's deployment ownership. This
  change performs the safe route cutover but does not edit the old checkout.
- Legacy ADR history is intentionally excluded. A future explicit migration
  may decide whether selected historical records are copied into a separate
  archived namespace.
