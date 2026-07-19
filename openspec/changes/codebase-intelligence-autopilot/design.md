## Context

Brai New currently has a global SocratiCode MCP entry, but its lifecycle is
not owned by the project and the checkout has no Graphify graph. The requested
operating model is unattended: agents receive graph-first and semantic context
while systemd maintains, checks and repairs the indices. The public Graphify
surface must remain a protected technical subdomain and no new inbound port is
permitted.

## Goals / Non-Goals

**Goals:**

- Keep Graphify and SocratiCode current after code and documentation changes.
- Make the integration survive agent/session/host restarts and ordinary
  dependency failures without manual commands.
- Keep code and embeddings local, publish Graphify only through authenticated
  HTTPS, and preserve a valid last-known-good graph during failed rebuilds.
- Maintain a tested, explicit upgrade and rollback path.

**Non-Goals:**

- Do not make Graphify or SocratiCode a source of authorization, deployment,
  production application behavior or database access.
- Do not expose an unauthenticated or directly reachable graph/MCP port.
- Do not treat an impossible hardware, operating-system or upstream defect as
  silently solved; retain evidence and the last known-good release instead.

## Decisions

### One project-owned supervisor, independent health timer

`brai-code-intelligence` is a Node 22 project service run by systemd as
`mark:mark`. It starts SocratiCode reconciliation, runs Graphify's native
watch/update mode, writes a compact JSON status record and serializes rebuilds.
A separate timer invokes a deterministic health command, so a hung supervisor
is detected rather than merely restarted after exit.

This reuses SocratiCode's incremental index, graph build, locks and checkpoints
instead of maintaining a second indexer. A single supervisor also prevents
Graphify rebuild storms and converts file changes into one debounced work item.

### Atomic Graphify release root and loopback-only HTTP server

Graphify writes candidate output beneath the managed state root. The supervisor
checks `graph.json` and its input fingerprint, then atomically advances a
`current` symlink. `graphify.serve` receives only that current path and binds
to `127.0.0.1`; a marker-managed Caddy block serves it at
`codegraph.brai.one` with unified Basic Auth, TLS and security headers.

Keeping output outside the working tree avoids generated-file diffs, self-watch
loops and broad write access. Direct HTTP binding or committing a mutable graph
was rejected because it would either expose a non-standard port or couple every
source change to a Git artifact.

### Graphify-first, SocratiCode-second with healthy fallback

Graphify's Codex hook and a concise managed AGENTS rule establish graph-first
discovery. SocratiCode MCP remains the live semantic and context-artifact layer
for exact, current snippets. The hook is strict while Graphify health is green;
when the health record is degraded it does not stop an agent, and repair occurs
in the background.

Using only Graphify was rejected because its graph is a snapshot. Using only
SocratiCode was rejected because it lacks Graphify's directly navigable
cross-domain visualization and graph path workflow. Adding CodeGraph was
rejected because it duplicates both layers and adds a third lifecycle/index.

### Pinned releases with tested promotion and rollback

Tool packages live under `/srv/opt` in versioned release directories. A
maintenance timer may stage a candidate release, run smoke checks against a
disposable fixture and the Brai New health contract, atomically switch to it
only on success, and restore the previous release on failure. The normal
service always uses the `current` symlink.

Unpinned `latest` at process startup was rejected because it makes a working
project depend on unreviewed upstream behavior at every restart.

## Risks / Trade-offs

- [Graph rebuild uses CPU while code changes rapidly] → coalesce events,
  apply systemd CPU/memory limits and retain the prior graph until promotion.
- [A stale graph could mislead an agent] → fingerprint validation, health timer,
  strict hook only when green and SocratiCode fallback.
- [A package update changes internal behavior] → pin releases, run smoke checks
  and automatically roll back to the preserved release.
- [Caddy or certificate failure blocks the browser view] → local health remains
  independent; route helper validates and rolls back Caddy configuration before
  reload.

## Migration Plan

1. Install pinned Graphify and confirm the existing embedding provider used by
   SocratiCode is healthy.
2. Add project context artifacts, graph profile, supervision scripts, tests and
   systemd source units.
3. Build initial Graphify and SocratiCode indices, then enable services and
   health timer.
4. Install the loopback Graphify HTTP unit and publish the protected Caddy
   route only after local acceptance succeeds.
5. Verify real HTTPS desktop/mobile access through isolated Chrome DevTools,
   then register tooling and lifecycle facts.

Rollback removes the Caddy marker block, stops code-intelligence units and
restores the preceding tool-release symlinks. It does not delete the prior
valid graph or SocratiCode index unless explicitly requested.

## Open Questions

- The implementation will verify Graphify's exact current output and service
  flags before selecting the managed state path; no unverified CLI flag is a
  design contract.
