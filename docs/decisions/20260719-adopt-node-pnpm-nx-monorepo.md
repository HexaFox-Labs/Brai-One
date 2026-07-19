# Принять Node 22, pnpm workspaces и Nx как основу Brai New monorepo

- Status: accepted
- Deciders: Сергей Bright, Mark
- Date: 2026-07-19
- Tags: architecture, monorepo, nodejs, pnpm, nx

## Контекст

Brai New содержит web, Gateway, несколько сервисов, workers, shared contracts
и infrastructure tooling. Им нужны единые версии, один lockfile, воспроизводимые
build/test targets и возможность добавлять пакеты без ручного связывания
репозиториев. При этом первоначальный проект не должен требовать Git, remote,
Nx Cloud или package publication.

## Решение

Использовать package-based monorepo на Node.js 22, strict TypeScript и ESM.

- pnpm workspaces управляет dependency graph и единым lockfile;
- Nx является единственным task graph/cache runner для build, lint, typecheck
  и test;
- Lerna остаётся установленным для будущего independent versioning, но
  делегирует task execution Nx и не запускает второй runner;
- Nx Cloud не подключается;
- каждый app/service/package имеет явный manifest и Nx targets;
- сервисы и workers создаются project generator-ом, чтобы новый runtime сразу
  получил Node 22, TypeScript, NATS bootstrap, env schema, Dockerfile, tests и
  README.

## Рассмотренные альтернативы

- **Отдельные репозитории для каждого сервиса:** отклонены для начального
  фундамента: shared contracts и coordinated changes стали бы тяжелее, а
  инфраструктурная проверка — менее воспроизводимой.
- **Lerna как второй task runner:** отклонено из-за дублирования dependency
  graph, cache semantics и непонятного источника запуска.
- **npm/Yarn без workspace task graph:** отклонены, потому что не дают
  выбранную модель зависимых targets и локального cache.
- **Nx Cloud с первого дня:** отклонён: локального cache достаточно, пока нет
  отдельной потребности в удалённом CI cache.

## Последствия

- Плюс: единый lockfile и понятная ownership-карта делают изменения contracts,
  сервисов и инфраструктуры согласованными.
- Плюс: команды CI и generator повторяемы на Node 22 без global project tools.
- Плюс: будущая публикация пакетов может использовать Lerna, не заменяя Nx.
- Минус: workspace требует дисциплины manifest/target boundaries и совместимых
  версий пакетов.
- Ограничение: Git-dependent versioning/publish сознательно не выполняется,
  пока Сергей явно не включит Git workflow.

## Проверка

- `package.json`, `pnpm-workspace.yaml`, `nx.json`, `lerna.json` и
  `tsconfig.base.json` задают top-level contract.
- `pnpm run ci` запускает repository checks через `tools/ci/run.mjs`.
- `tools/generators` содержит Nx generator и tests generated projects.
- [Каталог runtime/build](../stack/runtime-and-build.md) содержит читаемую
  текущую версию toolchain.

## Ссылки

- [`README.md`](../../README.md)
- [`docs/stack/runtime-and-build.md`](../stack/runtime-and-build.md)
- [`docs/stack/tooling-and-quality.md`](../stack/tooling-and-quality.md)
- [`tools/generators/generators.json`](../../tools/generators/generators.json)
- [`openspec/changes/archive/2026-07-18-brai-factory-foundation/proposal.md`](../../openspec/changes/archive/2026-07-18-brai-factory-foundation/proposal.md)

## Заменяет

Нет.

## Заменено

Нет.
