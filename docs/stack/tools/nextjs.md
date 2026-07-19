<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Next.js

**Категория:** [Прикладной стек](../by-category/application.md)  
**Статус:** active  
**Версия:** 16.2.9  
**Тип:** web-framework  
**Область:** project

**Теги:** web, app-router

## Если коротко

Web-фреймворк, который собирает пользовательский интерфейс Brai New.

## Что это такое

Next.js — это React-фреймворк, который добавляет routing, сборку приложения, conventions для страниц и подготовку production output. Он управляет тем, как UI-компоненты превращаются в доступное браузеру приложение, а не является базой данных или межсервисным транспортом.

## Зачем это нужно Brai

Brai нужен единый web boundary с App Router, статической выдачей и понятным маршрутом `/api/*` через Caddy в Gateway. Next.js позволяет собрать web в воспроизводимый artifact, который можно отдавать через Nginx без отдельного публичного application runtime.

## Почему мы выбрали именно этот инструмент

Next.js даёт Brai web routing и production build, а static export позволяет держать web runtime простым.

## Как он работает в нашем контуре

`apps/web` собирает App Router в static export; браузер обращается к same-origin `/api/*`, который Caddy направляет в Gateway.

## Что он даёт

- App Router и page composition
- production build и static export
- интеграция React, CSS и browser tests

## Практические сценарии

- добавить экран Factory
- проверить responsive route через Playwright
- собрать статический web image для Nginx

## Как мы это используем

Web использует App Router, `output: export` и same-origin `/api/*`.

## Где находится

`apps/web`.

## Ограничения

Web не получает NATS- или database-доступ; API идёт через Gateway.

## Типичные ошибки

- вызывать domain service напрямую из браузера
- ожидать server-only database/NATS access в static web output

## Связанные инструменты

- [React](./react.md) — UI-библиотека, из которой собраны интерактивные компоненты Brai New.
- [Tailwind CSS](./tailwind-css.md) — Utility-first слой стилей для интерфейса Brai New.
- [Nginx](./nginx.md) — Непривилегированный static server внутри web runtime image.
- [Playwright](./playwright.md) — E2E-проверки web-сценариев в desktop и mobile viewport.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**16.2.9**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `pnpm --dir apps/web build`
- Playwright web scenarios

## Источники и дальнейшее чтение

- [Web manifest](../../../apps/web/package.json)
- [Web config](../../../apps/web/next.config.ts)

[← Вернуться к каталогу стека](../README.md)
