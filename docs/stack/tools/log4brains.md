<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Log4brains

**Категория:** [Документация](../by-category/documentation.md)  
**Статус:** active  
**Версия:** 1.1.0  
**Тип:** adr-catalog  
**Область:** project

**Теги:** adr, static-site

## Если коротко

Собирает ADR в searchable static catalog для архитектурных решений.

## Что это такое

Log4brains — это инструмент каталога архитектурных решений (ADR), который собирает Markdown-записи в searchable static site. Он хранит не текущий API-контракт, а объяснение причин, альтернатив и последствий долговечных решений.

## Зачем это нужно Brai

Некоторые решения Brai нельзя понять по коду: почему выбран NATS, где проходит access boundary или зачем нужен immutable artifact. ADR-каталог сохраняет эту rationale-историю отдельно от OpenSpec и помогает будущему агенту не вернуть уже отвергнутую альтернативу.

## Почему мы выбрали именно этот инструмент

Архитектурные решения требуют объяснения причин и альтернатив, чего недостаточно в требованиях или текущей docs.

## Как он работает в нашем контуре

Log4brains строит static ADR catalog из `docs/decisions`, а watcher публикует только после checks.

## Что он даёт

- ADR source catalog
- поиск и static HTML build
- проверяемая rationale history

## Практические сценарии

- зафиксировать новый durable architectural choice
- найти альтернативы решения
- проверить опубликованный ADR site

## Как мы это используем

ADR source лежит в `docs/decisions`, сборка и publication идут project scripts.

## Где находится

`.log4brains.yml`, `docs/decisions` и `infrastructure/adr`.

## Ограничения

ADR не является нормативным OpenSpec и не должен подменять requirements.

## Типичные ошибки

- использовать ADR как замену OpenSpec requirement
- обновлять rationale молча без ссылки на решение

## Связанные инструменты

- [OpenSpec](./openspec.md) — Хранит нормативные требования, сценарии и durable планы изменений.
- [Memory Bank](./memory-bank.md) — Короткий проверяемый handoff-контекст для агентов проекта.
- [Caddy](./caddy.md) — Единая внешняя точка входа с TLS, redirect, Basic Auth и маршрутизацией.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**1.1.0**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `pnpm run adr:check`
- `pnpm run adr:build`

## Источники и дальнейшее чтение

- [Log4brains config](../../../.log4brains.yml)
- [ADR README](../../../infrastructure/adr/README.md)

[← Вернуться к каталогу стека](../README.md)
