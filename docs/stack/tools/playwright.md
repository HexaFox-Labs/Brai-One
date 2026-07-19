<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Playwright

**Категория:** [Качество](../by-category/quality.md)  
**Статус:** active  
**Версия:** 1.60.0  
**Тип:** browser-testing  
**Область:** project

**Теги:** e2e, browser, mobile

## Если коротко

E2E-проверки web-сценариев в desktop и mobile viewport.

## Что это такое

Playwright — это browser automation и end-to-end framework, который управляет настоящим Chromium и наблюдает пользовательские действия, DOM и network flow. В отличие от component test, он может пройти путь от страницы через ingress и Gateway до backend результата.

## Зачем это нужно Brai

Для Brai важно проверять не только React-компонент, но и собранный UI, Caddy, API и сохранение данных вместе. Playwright ловит поломки маршрутизации, responsive layout и пользовательского workflow, которые не видны unit-тесту.

## Почему мы выбрали именно этот инструмент

Реальный браузерный E2E проверяет цепочку UI → Caddy/Gateway → NATS, а не только отдельный компонент.

## Как он работает в нашем контуре

Playwright запускает Chromium сценарии в desktop и Pixel 7 viewports против локального или заданного URL.

## Что он даёт

- browser automation
- desktop/mobile viewport checks
- network-visible user workflows

## Практические сценарии

- создать Activity через published UI
- проверить reload и сохранение данных
- найти mobile overflow

## Как мы это используем

Сценарии используют Chromium, desktop viewport и Pixel 7 profile.

## Где находится

`apps/web/playwright.config.ts` и `apps/web/tests/e2e`.

## Ограничения

Protected production/dev URL дополнительно проверяется Chrome DevTools MCP.

## Типичные ошибки

- тестировать protected route в личном browser profile
- подменять E2E локальным unit test

## Связанные инструменты

- [Next.js](./nextjs.md) — Web-фреймворк, который собирает пользовательский интерфейс Brai New.
- [React](./react.md) — UI-библиотека, из которой собраны интерактивные компоненты Brai New.
- [Chrome DevTools MCP](./chrome-devtools.md) — Основной инструмент глубокой QA-проверки опубликованных защищённых URL.
- [Testing Library](./testing-library.md) — Тестирует UI через поведение пользователя и DOM assertions.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**1.60.0**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `pnpm --dir apps/web e2e`
- `pnpm run ci`

## Источники и дальнейшее чтение

- [Playwright config](../../../apps/web/playwright.config.ts)
- [E2E tests](../../../apps/web/tests/e2e/factory.spec.ts)

[← Вернуться к каталогу стека](../README.md)
