<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Vitest

**Категория:** [Качество](../by-category/quality.md)  
**Статус:** active  
**Версия:** 4.1.8  
**Тип:** test-runner  
**Область:** project

**Теги:** tests, unit

## Если коротко

Быстрый runner unit и integration тестов.

## Что это такое

Vitest — это быстрый test runner для unit и integration тестов в TypeScript/JavaScript workspace. Он запускает тестовые файлы в Node-процессе, умеет работать с DOM environment и показывает, какой контракт или поведение нарушено.

## Зачем это нужно Brai

Brai нужно быстро проверять helpers, contracts, service behavior и генератор до дорогих Compose и browser checks. Vitest даёт короткий feedback loop, но не притворяется полноценным браузером или доказательством работы всей опубликованной цепочки.

## Почему мы выбрали именно этот инструмент

Быстрые unit/integration tests дают обратную связь до более дорогих Compose и browser checks.

## Как он работает в нашем контуре

Vitest запускается Nx с `NODE_ENV=test`; web использует Testing Library и jsdom где нужен DOM.

## Что он даёт

- unit и integration tests
- быстрый TypeScript transform
- watch/cache-friendly developer workflow

## Практические сценарии

- проверить Zod или NATS helper
- покрыть React component behavior
- добавить regression test для generator

## Как мы это используем

Тестовые targets запускаются через Nx с `NODE_ENV=test`.

## Где находится

Project package manifests и `vitest.config.ts`.

## Ограничения

Unit tests не заменяют published URL QA и full-stack сценарии.

## Типичные ошибки

- проверять implementation details вместо behavior
- считать Vitest заменой настоящего Chromium или full-stack test

## Связанные инструменты

- [Testing Library](./testing-library.md) — Тестирует UI через поведение пользователя и DOM assertions.
- [jsdom](./jsdom.md) — Browser-like DOM environment для Vitest component tests.
- [Playwright](./playwright.md) — E2E-проверки web-сценариев в desktop и mobile viewport.
- [Nx](./nx.md) — Task graph и cache runner для сборки, тестов и проверок монорепозитория.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**4.1.8**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `pnpm run test`
- Focused `node --test` checks

## Источники и дальнейшее чтение

- [Web Vitest config](../../../apps/web/vitest.config.ts)
- [Package manifest](../../../package.json)

[← Вернуться к каталогу стека](../README.md)
