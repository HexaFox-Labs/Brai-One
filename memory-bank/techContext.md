# Tech Context

## Runtime и сборка

- Node.js: `>=22.22.3 <23`.
- TypeScript: strict, ESM.
- Package manager: pnpm `11.13.1`.
- Workspace: pnpm workspaces.
- Task graph/cache: Nx `23.1.0`; Lerna только делегирует выполнение задач Nx.
- Основной CI-командой проекта является `pnpm run ci`; она запускается с
  `NODE_ENV=test` через `tools/ci/run.mjs`.

## Основные библиотеки

- Web: Next.js `16.2.9`, React `19.2.4`, Tailwind CSS `4.3.1`.
- Gateway: Fastify `5.10.0`, Zod `4.4.3`, JOSE `6.2.3`.
- Messaging: NATS client `@nats-io/nats-core` `3.4.0` и
  `@nats-io/transport-node` `3.4.0`.
- Tests: Vitest `4.1.8`; web E2E — Playwright `1.60.0`.
- Supabase access: PostgreSQL client `pg` `8.16.3`; Supabase schemas и роли
  обслуживаются сервисами/инфраструктурой, а не web или Gateway.

## Полезные команды

```bash
pnpm run ci
pnpm run build
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run preflight:access
pnpm run compose:config
pnpm generate:service --name=<name> --kind=service|worker --database=true|false
```

Для тестов сохраняй `NODE_ENV=test`. Перед production/runtime-проверками
изучи соответствующие README в `infrastructure/` и не подставляй секреты в
репозиторные `.env`-файлы.

## Структура

- `apps/` — web и API Gateway.
- `services/` — владельцы прикладных данных и приватного access state.
- `packages/` — переиспользуемые контракты и runtime-библиотеки.
- `infrastructure/` — runtime, deployment, Caddy, NATS и Supabase.
- `tools/ci/` — policy, integration и repository checks.
- `openspec/` — нормативные спецификации и архивы изменений.
- `memory-bank/` — контекст для агентов; он не хранит executable state.

## Окружение и артефакты

- Репозиторные env-файлы содержат только имена и примеры переменных.
- Production secrets находятся вне checkout, под `/etc/brai-new` согласно
  README deployment-инфраструктуры.
- `dist/`, `.next/`, coverage и Nx cache — производные артефакты; не считай их
  источником проектного решения.
- Не устанавливай helper tooling в checkout: общие инструменты должны жить под
  `/srv/opt/` согласно рабочим правилам.
- OpenSpec CLI `@fission-ai/openspec` версии `1.6.0` установлена глобально под
  `/srv/opt/node-v22.22.3`; команда доступна через
  `/home/mark/.local/bin/openspec`. В проекте `/srv/projects/brai-new`
  используется `openspec/config.yaml`, а Codex-интеграция генерируется в
  `.codex/skills/` и `$CODEX_HOME/prompts/`.
- Autonomous routing для естественно-языковых задач закреплён в
  `/srv/projects/brai-new/AGENTS.md`; OpenSpec CLI и generated skills агент
  запускает сам, без ручных команд пользователя.
