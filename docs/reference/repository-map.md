# Карта репозитория

**Статус:** `active`

| Каталог                                                                   | Назначение         | Граница ответственности                                    |
| ------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------- |
| [`apps/web`](../../apps/web/)                                             | Static Next.js UI  | Только web-клиент и same-origin API                        |
| [`apps/api-gateway`](../../apps/api-gateway/)                             | Fastify HTTP edge  | HTTP validation и NATS boundary; без database credentials  |
| [`services/brai-factory`](../../services/brai-factory/)                   | Activity service   | Владеет Factory data и schema                              |
| [`services/brai-access`](../../services/brai-access/)                     | Access service     | Владеет access state и runtime lifecycle                   |
| [`packages/contracts`](../../packages/contracts/)                         | Контракты          | Shared schemas/types между boundary                        |
| [`packages/runtime`](../../packages/runtime/)                             | Runtime helpers    | Env, logging, shutdown, UUID                               |
| [`packages/nats`](../../packages/nats/)                                   | NATS adapter       | Client/transport helpers                                   |
| [`packages/agent-access`](../../packages/agent-access/)                   | Access domain      | Launch/access policy contracts                             |
| [`packages/user-project-database`](../../packages/user-project-database/) | User DB            | SQLite default и sandbox Postgres support                  |
| [`packages/user-project-routing`](../../packages/user-project-routing/)   | Routing domain     | Hostname/project routing validation                        |
| [`infrastructure/agent-runtime`](../../infrastructure/agent-runtime/)     | Host runtime       | Sandbox, developer runtime, provisioning, acceptance       |
| [`infrastructure/supabase`](../../infrastructure/supabase/)               | Migrations/roles   | Factory migrations, shared hardening и service-role audits |
| [`infrastructure/deployment`](../../infrastructure/deployment/)           | Delivery           | Immutable release, receiver, migration/rollback policy     |
| [`infrastructure/docker`](../../infrastructure/docker/)                   | Compose/config     | Local and protected runtime configuration                  |
| [`infrastructure/caddy`](../../infrastructure/caddy/)                     | Ingress            | Caddy route lifecycle                                      |
| [`infrastructure/nats`](../../infrastructure/nats/)                       | Messaging infra    | NATS server image and ACL config                           |
| [`tools/ci`](../../tools/ci/)                                             | Policy/CI          | Portable policy, integration suites, CI runner             |
| [`tools/generators`](../../tools/generators/)                             | Scaffolding        | Nx generator для новых сервисов                            |
| [`workers`](../../workers/)                                               | Reserved workspace | Worker projects по мере появления                          |
| [`openspec`](../../openspec/)                                             | Normative specs    | Requirements, scenarios и change history                   |
| [`memory-bank`](../../memory-bank/)                                       | Agent context      | Краткая рабочая память, не runtime state                   |

## Правила чтения

- Для поведения сначала читать source и tests конкретного каталога.
- Для access/security boundary сначала читать `AGENTS.md` и OpenSpec.
- Для deployment сначала читать infrastructure README и host registry.
- Для shared package проверять всех consumers до изменения API.
- Не считать `dist`, `.next`, `out`, coverage и Nx cache источниками решения.
