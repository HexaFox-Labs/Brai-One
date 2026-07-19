# Архитектура

Здесь находятся навигация и объяснения границ системы. Нормативные требования
остаются в OpenSpec, а точное поведение подтверждается кодом и тестами.

## Материалы

- [Общая архитектура системы](../explanation/system-overview.md) — роли
  компонентов и путь Activity-запроса.
- [Микросервисная топология](../reference/microservice-topology.md) — точные
  контейнеры, сети, transport и data ownership.
- [Архитектура прав и изоляции](../agent-access-architecture.md) — подробный
  технический документ по access boundary.
- [Права, среды и квоты](../permissions-and-isolation.md) — объяснение для
  владельца продукта, разработчика и оператора.
- [Нормативная спецификация agent access](../../openspec/specs/agent-access/spec.md).
- [Нормативная спецификация Factory](../../openspec/specs/brai-factory/spec.md).

## Правило обновления

Если меняется service boundary, способ выбора профиля, database ownership,
межсервисный транспорт или host isolation, сначала проверяется необходимость
изменения OpenSpec и активной задачи. Нормативная спецификация обновляется
только при изменении обязательного поведения; затем синхронизируются
explanation/reference материалы, ADR и `memory-bank/activeContext.md`.
