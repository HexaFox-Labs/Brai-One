# Brai Factory

Новый микросервисный фундамент Brai.

## Runtime

- `brai-web`: static Next.js UI.
- `brai-api-gateway`: HTTP to NATS edge.
- `brai-nats`: Core NATS with JetStream enabled.
- `brai-factory`: Activity owner backed by the private Supabase schema `brai_factory`.
- `brai-access`: private transactional access state; it has no public HTTP surface.

## Agent access

There are exactly two server-selected profiles: `user-sandbox` and
`developer`. The AI, prompt, client and running process cannot choose or raise
the profile. Developer runs use the host identity `mark` and the same sudo
contract as Codex Desktop. Ordinary runs use one installed sparse XFS
project-quota pool on the existing disk, one immutable sandbox image, per-slot
rootless engines and fail-closed network/cgroup boundaries. Quotas are hard
limits on actual consumption and do not reserve disk space.

The accepted contract is
[`openspec/specs/agent-access/spec.md`](openspec/specs/agent-access/spec.md).
The plain-language guide for owners and operators is
[`docs/permissions-and-isolation.md`](docs/permissions-and-isolation.md).
The detailed installed architecture is
[`docs/agent-access-architecture.md`](docs/agent-access-architecture.md).
Runtime source and operator documentation live under
[`infrastructure/agent-runtime/`](infrastructure/agent-runtime/).

## Commands

- `pnpm run ci` — policy audit, lint, typecheck, build and tests through Nx.
- `pnpm generate:service --name=activity-worker --kind=service --database=false` — scaffold a runtime; replace the name and use `--kind=worker` and/or `--database=true` when needed.
- `docker compose config` — validate the local/manual Compose model.

Production secrets are stored outside this directory under `/etc/brai-new`.
Production CI/CD uses only digest-addressed images and the fixed host receiver
described in `infrastructure/deployment/README.md`; it does not build from or
write into this checkout.

## Agent memory

Persistent project context for agents is maintained in
[`memory-bank/README.md`](memory-bank/README.md). Agents should read it before
work and update the active context after meaningful changes.

## Documentation standard

Documentation and OpenSpec authoring follow the project adaptation of
Diátaxis described in
[`docs/documentation-methodology.md`](docs/documentation-methodology.md). It
explains how agents must separate tutorials, task guides, references and
architectural explanations, how those types map to OpenSpec artifacts, and
which checks are required before declaring documentation or a change complete.

The documentation map, system overview, technology stack and working procedures
are indexed from [`docs/README.md`](docs/README.md). Start there when you need
the repository map, local development guide, service generator workflow or
current stack inventory.

The exact container, network, transport and database-ownership map is in
[`docs/reference/microservice-topology.md`](docs/reference/microservice-topology.md).
The long-lived rationale is recorded in [`docs/decisions/`](docs/decisions/README.md).
