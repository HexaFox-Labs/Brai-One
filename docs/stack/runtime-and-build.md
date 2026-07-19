# Runtime и сборка

**Статус:** `active`

## Базовые версии

| Компонент  | Версия/ограничение | Назначение                                                 | Источник                                                                                 |
| ---------- | ------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Node.js    | `>=22.22.3 <23`    | Runtime для приложений, сервисов, workers и tooling        | [`package.json`](../../package.json), package manifests                                  |
| TypeScript | `5.9.3`            | Строгая типизация и сборка ESM                             | [`package.json`](../../package.json), [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) |
| pnpm       | `>=11.13.1 <12`    | Установка зависимостей и workspace-команды                 | [`package.json`](../../package.json)                                                     |
| Nx         | `23.1.0`           | Единственный task graph и cache runner                     | [`package.json`](../../package.json), [`nx.json`](../../nx.json)                         |
| Lerna      | `9.0.7`            | Workspace/release-обвязка; исполнение задач остаётся за Nx | [`package.json`](../../package.json), [`lerna.json`](../../lerna.json)                   |
| ESLint     | `9.39.4`           | Статический анализ JavaScript/TypeScript                   | [`package.json`](../../package.json), [`eslint.config.mjs`](../../eslint.config.mjs)     |
| Prettier   | `3.9.5`            | Форматирование Markdown и исходников                       | [`package.json`](../../package.json), [`.prettierrc.json`](../../.prettierrc.json)       |
| tsx        | `4.23.1`           | Запуск TypeScript CLI и миграций в Node.js                 | [`package.json`](../../package.json)                                                     |

## Правила TypeScript

Корневой [`tsconfig.base.json`](../../tsconfig.base.json) задаёт:

- `module` и `moduleResolution`: `NodeNext`;
- `target` и `lib`: `ES2022`;
- `strict: true`;
- `noUncheckedIndexedAccess` и `exactOptionalPropertyTypes`;
- `noImplicitOverride`, `useUnknownInCatchVariables` и
  `forceConsistentCasingInFileNames`;
- декларации, source maps и JSON modules.

Workspace-проект не должен ослаблять эти правила без отдельного объяснения и
проверяемого исключения.

## Workspace

Корневой [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) включает:

```text
apps/*
services/*
workers/*
packages/*
infrastructure/{supabase,agent-runtime,deployment}
tools/{generators,ci/integration,ci/policy}
```

Общие версии `@types/node`, `eslint`, `typescript` и `vitest` заведены в
pnpm catalog. Локальный store находится в `.pnpm-store`, а
`verifyDepsBeforeRun: error` запрещает незаметно использовать отсутствующие
зависимости.

## Task graph

`nx.json` кэширует `build`, `lint`, `test` и `typecheck`. Для `build` и `test`
учитываются зависимости upstream-проектов. Основные выходы: `dist`, `out`,
`.next`, `coverage` и `test-results`; это производные артефакты и не источники
архитектурных решений.

Стабильные корневые команды:

```bash
pnpm run ci
pnpm run format:check
pnpm run build
pnpm run lint
pnpm run typecheck
pnpm run test
```

Все тесты запускаются с `NODE_ENV=test`; корневой `ci` это делает сам.
