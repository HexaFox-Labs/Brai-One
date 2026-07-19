<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Fastify

**Категория:** [Прикладной стек](../by-category/application.md)  
**Статус:** active  
**Версия:** 5.10.0  
**Тип:** http-framework  
**Область:** project

**Теги:** api, http

## Если коротко

Единственный HTTP edge для Gateway Brai New.

## Что это такое

Fastify — это Node.js web framework для HTTP-сервисов с routing, lifecycle hooks и плагинной моделью. В Brai он используется как лёгкий edge framework: принимает HTTP, выполняет boundary-проверки и передаёт разрешённые операции дальше.

## Зачем это нужно Brai

Gateway должен быть тонким и предсказуемым входом, а не местом хранения доменных данных или прямых database connections. Fastify даёт быстрый request lifecycle, явные ответы и расширяемые hooks, сохраняя service-owned архитектуру и NATS как межсервисный транспорт.

## Почему мы выбрали именно этот инструмент

Gateway нужен лёгкий и явный HTTP edge, который не смешивает transport boundary с владением доменными данными.

## Как он работает в нашем контуре

Fastify принимает HTTP, запускает validation/auth hooks и публикует разрешённые NATS request/reply subjects.

## Что он даёт

- HTTP routing и lifecycle hooks
- проверка request/response
- структурированные readiness/error responses

## Практические сценарии

- добавить browser-facing endpoint
- проверить idempotency и auth boundary
- вернуть 503 при недоступном NATS

## Как мы это используем

Fastify работает в `apps/api-gateway`; отдельные доменные сервисы не получают public HTTP surface.

## Где находится

`apps/api-gateway`.

## Ограничения

Gateway не владеет прикладной базой и не вызывает сервисы по HTTP.

## Типичные ошибки

- подключить базу к Gateway
- добавить прямой HTTP-вызов между domain services

## Связанные инструменты

- [Zod](./zod.md) — Runtime-проверка входных данных и контрактов на HTTP/NATS границах.
- [NATS](./nats.md) — Приватная шина request/reply между Gateway и сервисами Brai New.
- [JOSE](./jose.md) — Работа с JWT и подписанными структурами на Gateway boundary.
- [Pino](./pino.md) — Структурированные логи для приложений и сервисов.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**5.10.0**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- Gateway integration tests
- `pnpm run typecheck`

## Источники и дальнейшее чтение

- [Gateway manifest](../../../apps/api-gateway/package.json)
- [Topology reference](../../../docs/reference/microservice-topology.md)

[← Вернуться к каталогу стека](../README.md)
