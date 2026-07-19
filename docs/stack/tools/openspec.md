<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# OpenSpec

**Категория:** [Документация](../by-category/documentation.md)  
**Статус:** installed  
**Версия:** 1.6.0  
**Тип:** specification-workflow  
**Область:** project

**Теги:** requirements, workflow

## Если коротко

Хранит нормативные требования, сценарии и durable планы изменений.

## Что это такое

OpenSpec — это нормативный workflow для описания требований, сценариев, дизайна и задач изменения до и во время реализации. Он разделяет то, как система должна вести себя, от текущей docs и rationale архитектурных решений.

## Зачем это нужно Brai

Brai развивается несколькими агентами, поэтому одной переписки недостаточно, чтобы сохранить обязательные инварианты и не потерять контекст. OpenSpec даёт проверяемый источник требований, связывает реализацию с задачами и позволяет завершить изменение только после валидации.

## Почему мы выбрали именно этот инструмент

Durable requirements нужны, чтобы implementation, docs и agent workflow не расходились с принятым поведением.

## Как он работает в нашем контуре

Агент создаёт Change из natural-language задачи, затем синхронизирует permanent specs после проверок.

## Что он даёт

- нормативные requirements и scenarios
- proposal/design/tasks для Change
- strict validation и archive workflow

## Практические сценарии

- оформить новый feature contract
- продолжить активный Change
- проверить все specs перед handoff

## Как мы это используем

Агент сам создаёт и применяет Change; постоянные specs находятся в `openspec/specs`.

## Где находится

`openspec/`, `/srv/opt/node-v22.22.3` и project-local Codex integration.

## Ограничения

OpenSpec не заменяет документацию текущего устройства и ADR rationale.

## Типичные ошибки

- копировать rationale в normative spec
- редактировать архивный Change вместо нового

## Связанные инструменты

- [Memory Bank](./memory-bank.md) — Короткий проверяемый handoff-контекст для агентов проекта.
- [Log4brains](./log4brains.md) — Собирает ADR в searchable static catalog для архитектурных решений.
- [Prettier](./prettier.md) — Автоматически приводит Markdown, JSON и исходники к одному формату.

## Обновление и жизненный цикл

Статус инструмента: **installed**. Текущая версия или ограничение версии:
**1.6.0**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `openspec validate --all --strict`
- `openspec doctor`

## Источники и дальнейшее чтение

- [OpenSpec config](../../../openspec/config.yaml)
- [Documentation methodology](../../../docs/documentation-methodology.md)

[← Вернуться к каталогу стека](../README.md)
