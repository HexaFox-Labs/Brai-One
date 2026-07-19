<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# pg

**Категория:** [Работа с данными](../by-category/data.md)  
**Статус:** active  
**Версия:** 8.16.3  
**Тип:** database-client  
**Область:** project

**Теги:** postgres, node

## Если коротко

Node.js PostgreSQL client для сервисов-владельцев данных и миграций.

## Что это такое

`pg` — это Node.js-клиент PostgreSQL, который открывает соединения, выполняет parameterized queries и управляет pool. Это библиотека для backend и migration tooling, а не клиент, который должен попадать в browser bundle.

## Зачем это нужно Brai

Сервису-владельцу данных нужен прямой и ограниченный доступ к своей схеме для миграций и доменных операций. `pg` даёт этот доступ из service process, позволяя сохранить Gateway и web вне database boundary и использовать отдельную runtime role.

## Почему мы выбрали именно этот инструмент

Сервисам нужен прямой, но ограниченный клиент PostgreSQL для migrations и операций своей схемы.

## Как он работает в нашем контуре

`pg` импортируется database-owning packages и не попадает в browser-facing web/Gateway boundary.

## Что он даёт

- pooling и parameterized queries
- подключение migration tooling
- Node.js integration с PostgreSQL

## Практические сценарии

- применить migration one-off job
- записать Activity в Factory schema
- проверить service-owned role

## Как мы это используем

Клиент используется только в database-owning packages и migration tooling.

## Где находится

Service and infrastructure package manifests.

## Ограничения

Gateway и web не должны импортировать database client.

## Типичные ошибки

- использовать superuser в runtime
- подключить клиент в web package

## Связанные инструменты

- [Supabase / PostgreSQL](./supabase-postgresql.md) — Database platform, в которой сервисы владеют своими схемами и ролями.
- [TypeScript](./typescript.md) — Строгий язык и компилятор, который описывает контракты Brai New до запуска.
- [Vitest](./vitest.md) — Быстрый runner unit и integration тестов.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**8.16.3**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- Migration tests
- `pnpm run typecheck`

## Источники и дальнейшее чтение

- [Workspace manifests](../../../package.json)
- [Supabase infrastructure](../../../infrastructure/supabase/package.json)

[← Вернуться к каталогу стека](../README.md)
