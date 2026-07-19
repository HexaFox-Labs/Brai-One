<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Chrome DevTools MCP

**Категория:** [Браузер и визуальная проверка](../by-category/browser.md)  
**Статус:** installed  
**Версия:** host-managed  
**Тип:** browser-qa  
**Область:** agent-environment

**Теги:** qa, browser, security

## Если коротко

Основной инструмент глубокой QA-проверки опубликованных защищённых URL.

## Что это такое

Chrome DevTools MCP — это изолированный browser-debugging инструмент для DOM/a11y snapshots, console, network, performance и viewport inspection. Он работает с отдельным headless-профилем и позволяет проверить опубликованную страницу теми же сигналами, которыми пользуется разработчик в DevTools.

## Зачем это нужно Brai

Protected Brai URL нельзя считать проверенным по локальному серверу или одному curl: важны Caddy Auth, app login, console errors и сетевые сбои в реальном HTTPS. Этот инструмент даёт воспроизводимое evidence для desktop/mobile QA и не требует доступа к личному Chrome-профилю.

## Почему мы выбрали именно этот инструмент

Для protected preview/dev URL недостаточно локального smoke: нужно проверить реальный HTTPS, Caddy Auth, console и network.

## Как он работает в нашем контуре

Изолированный headless Chrome проходит Caddy Basic Auth, затем app login, после чего снимает DOM/a11y, console и network evidence.

## Что он даёт

- DOM и accessibility snapshots
- console/network inspection
- desktop/mobile viewport QA

## Практические сценарии

- проверить published Factory route
- найти 404 или console error после deploy
- подтвердить отсутствие mobile overflow

## Как мы это используем

Используется только с isolated profile; protected URL проходит Caddy Auth до app login.

## Где находится

`infrastructure/chrome-devtools` и Codex MCP server `chrome-devtools`.

## Ограничения

Нельзя подключать личный Chrome profile или обходить Caddy через backend port.

## Типичные ошибки

- подключить личный Chrome profile
- обойти Caddy и считать backend curl эквивалентом QA

## Связанные инструменты

- [Caddy](./caddy.md) — Единая внешняя точка входа с TLS, redirect, Basic Auth и маршрутизацией.
- [Playwright](./playwright.md) — E2E-проверки web-сценариев в desktop и mobile viewport.
- [agent-browser](./agent-browser.md) — Быстрый браузерный просмотр и простые действия без DevTools-level диагностики.

## Обновление и жизненный цикл

Статус инструмента: **installed**. Текущая версия или ограничение версии:
**host-managed**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- Desktop/mobile DOM snapshot
- Console and network inspection

## Источники и дальнейшее чтение

- [Project browser setup](../../../infrastructure/chrome-devtools/README.md)
- [Infrastructure stack](../../../docs/stack/infrastructure-and-operations.md)

[← Вернуться к каталогу стека](../README.md)
