<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# jsdom

**Категория:** [Качество](../by-category/quality.md)  
**Статус:** active  
**Версия:** 29.1.1  
**Тип:** test-environment  
**Область:** project

**Теги:** tests, dom

## Если коротко

Browser-like DOM environment для Vitest component tests.

## Что это такое

jsdom — это реализация базовых DOM и browser-like API внутри Node test process. Она позволяет React-компоненту получить document, window и события без запуска полноценного Chromium, но не моделирует настоящий layout, rendering engine и все browser quirks.

## Зачем это нужно Brai

Большинство component tests Brai должны быть быстрыми и изолированными, а для них достаточно DOM environment. jsdom даёт этот слой для Vitest, тогда как layout, network, Caddy и реальный browser workflow остаются задачами Playwright или Chrome DevTools.

## Почему мы выбрали именно этот инструмент

Большинство component tests не требуют полноценного Chromium, но им нужен DOM и базовые browser APIs.

## Как он работает в нашем контуре

Vitest поднимает jsdom environment внутри Node process; настоящая browser behavior проверяется отдельно Playwright.

## Что он даёт

- DOM APIs в Node test process
- быстрый component environment
- изоляция document/window между тестами

## Практические сценарии

- отрендерить React component
- проверить DOM event
- протестировать label, focus и form state

## Как мы это используем

Используется как environment для web Vitest tests.

## Где находится

`apps/web`.

## Ограничения

jsdom не является доказательством поведения настоящего Chromium.

## Типичные ошибки

- считать jsdom полноценным браузером
- добавлять тесты на layout, который jsdom не вычисляет

## Связанные инструменты

- [Vitest](./vitest.md) — Быстрый runner unit и integration тестов.
- [Testing Library](./testing-library.md) — Тестирует UI через поведение пользователя и DOM assertions.
- [Playwright](./playwright.md) — E2E-проверки web-сценариев в desktop и mobile viewport.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**29.1.1**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `pnpm --dir apps/web test`

## Источники и дальнейшее чтение

- [Web manifest](../../../apps/web/package.json)
- [Vitest config](../../../apps/web/vitest.config.ts)

[← Вернуться к каталогу стека](../README.md)
