<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Supabase / PostgreSQL

**Категория:** [Инфраструктура](../by-category/infrastructure.md)  
**Статус:** installed  
**Версия:** host-managed  
**Тип:** database-platform  
**Область:** host

**Теги:** postgres, migrations, ownership

## Если коротко

Database platform, в которой сервисы владеют своими схемами и ролями.

## Что это такое

Supabase/PostgreSQL — это PostgreSQL-хранилище с операционным и migration tooling слоем Supabase. PostgreSQL хранит таблицы, схемы и роли, а service-owned migrations описывают, какие данные принадлежат конкретному доменному сервису.

## Зачем это нужно Brai

Factory и другие доменные части Brai должны владеть своими данными и не раздавать database credentials web или Gateway. PostgreSQL даёт транзакционность и зрелые права доступа, а Supabase упрощает управляемое применение схем и проверку состояния без смешения владельцев.

## Почему мы выбрали именно этот инструмент

PostgreSQL даёт надёжное service-owned хранение, а Supabase предоставляет операционный слой и schema tooling.

## Как он работает в нашем контуре

Каждый database-owning service применяет свои migrations и role grants; web и Gateway не владеют database connection.

## Что он даёт

- schemas и роли PostgreSQL
- миграции с проверяемым состоянием
- least-privilege ownership boundary

## Практические сценарии

- применить Factory migration
- проверить runtime role grants
- сохранить доменные данные через service restart

## Как мы это используем

Factory и Access применяют миграции через infrastructure/supabase; web и Gateway к базе не подключаются.

## Где находится

`infrastructure/supabase` и shared Supabase runtime.

## Ограничения

Database access принадлежит сервису-владельцу и не выносится в shared web layer.

## Типичные ошибки

- дать Gateway database access
- смешать migration role и runtime role

## Связанные инструменты

- [pg](./postgres-client.md) — Node.js PostgreSQL client для сервисов-владельцев данных и миграций.
- [NATS](./nats.md) — Приватная шина request/reply между Gateway и сервисами Brai New.
- [Docker Compose](./docker-compose.md) — Описывает локальный и production-like runtime Brai New как набор сервисов.

## Обновление и жизненный цикл

Статус инструмента: **installed**. Текущая версия или ограничение версии:
**host-managed**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- Supabase migration checks
- Service integration tests

## Источники и дальнейшее чтение

- [Supabase README](../../../infrastructure/supabase/README.md)
- [Factory source](../../../services/brai-factory/src)

[← Вернуться к каталогу стека](../README.md)
