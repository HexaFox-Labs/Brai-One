<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# agent-browser

**Категория:** [Браузер и визуальная проверка](../by-category/browser.md)  
**Статус:** installed  
**Версия:** host-managed  
**Тип:** browser-automation  
**Область:** agent-environment

**Теги:** qa, scraping, browser

## Если коротко

Быстрый браузерный просмотр и простые действия без DevTools-level диагностики.

## Что это такое

agent-browser — это CLI для быстрой навигации, простых действий и просмотра уже отрисованной web-страницы. Он удобен как лёгкий lookup-инструмент, но не заменяет DevTools-level диагностику с network, console и performance evidence.

## Зачем это нужно Brai

Агенту часто нужно быстро открыть документацию или проверить видимый результат без тяжёлого trace. agent-browser сокращает путь для таких задач, а разделение с Chrome DevTools сохраняет правильный уровень строгости для protected preview и release QA.

## Почему мы выбрали именно этот инструмент

Быстрый просмотр и простые действия не всегда требуют тяжёлого DevTools-level trace.

## Как он работает в нашем контуре

CLI работает в отдельном browser runtime/cache и выполняет разрешённые navigation/action workflows.

## Что он даёт

- быстрая навигация
- простые клики и ввод
- rendered-page inspection

## Практические сценарии

- посмотреть страницу по URL
- собрать видимый текст
- выполнить короткий незащищённый lookup workflow

## Как мы это используем

Перед применением загружается matching browser workflow; runtime/cache живёт под `/srv/opt/agent-browser`.

## Где находится

Команда `/home/mark/.local/bin/agent-browser`.

## Ограничения

Для console/network/performance QA опубликованного protected URL используется Chrome DevTools MCP.

## Типичные ошибки

- использовать его вместо обязательного DevTools QA protected URL
- подключить личные cookies или profile

## Связанные инструменты

- [Chrome DevTools MCP](./chrome-devtools.md) — Основной инструмент глубокой QA-проверки опубликованных защищённых URL.
- [Playwright](./playwright.md) — E2E-проверки web-сценариев в desktop и mobile viewport.
- [Kroki](./kroki.md) — Локально рендерит текстовые диаграммы в SVG и другие форматы.

## Обновление и жизненный цикл

Статус инструмента: **installed**. Текущая версия или ограничение версии:
**host-managed**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `agent-browser --help`
- Isolated page inspection

## Источники и дальнейшее чтение

- [Infrastructure stack](../../../docs/stack/infrastructure-and-operations.md)
- [Host registry](/home/mark/DEPLOYMENT.md)

[← Вернуться к каталогу стека](../README.md)
