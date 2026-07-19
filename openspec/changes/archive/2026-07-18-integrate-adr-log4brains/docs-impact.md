# Documentation impact

## Audience and surfaces

- Developers and agents: `AGENTS.md`, `openspec/config.yaml`, the shared
  `documentation-governance` skill adapter, and the repository commands.
- Readers: `docs/README.md`, `docs/decisions/README.md`, the stack and command
  references, and the published `adr.brai.one` knowledge base.
- Operators: `infrastructure/adr/README.md`, the staged host release root, and
  the Caddy cutover/rollback procedure.
- Project memory: `memory-bank/activeContext.md` and
  `memory-bank/progress.md`.

## Source boundary

The canonical source is the Brai New repository's `docs/decisions/` directory.
No files, generated pages, or history from `/srv/projects/brai/docs/adr` are
copied into this project. The legacy static root remains separate and is kept
for rollback.

## Evidence required before completion

- `pnpm run adr:check`
- `pnpm run docs:check`
- `openspec validate --all --strict`
- local static build and staged publication smoke checks
- authenticated HTTPS smoke check after Caddy cutover
- host registry and Memory Bank updates without secrets

## ADR/OpenSpec division

OpenSpec remains the normative change and implementation contract. ADR records
capture durable architectural rationale and consequences. The governance
workflow must evaluate ADR impact for every durable change, including changes
that arrive without an OpenSpec Change, and must record an explicit no-ADR
reason when no decision record is warranted.
