<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# NATS

**Категория:** [Прикладной стек](../by-category/application.md)  
**Статус:** active  
**Версия:** client 3.4.0; server host-configured  
**Тип:** messaging  
**Область:** project

**Теги:** messaging, acl, jetstream

## Если коротко

Приватная шина request/reply между Gateway и сервисами Brai New.

## Что это такое

NATS — это message broker и transport для публикации сообщений и request/reply между процессами. Он работает через subjects, пользователей и ACL, поэтому сообщение адресуется не случайным HTTP-портом, а явно определённой capability boundary.

## Зачем это нужно Brai

Brai разделяет web edge и сервисы-владельцы данных и не хочет связывать их прямыми HTTP-вызовами или общей базой. NATS делает межсервисный обмен приватным, версионируемым и проверяемым, а ACL ограничивает, какой сервис может отправить или получить конкретный subject.

## Почему мы выбрали именно этот инструмент

Приватная шина отделяет browser edge от service-owned data и делает межсервисные операции явными subjects.

## Как он работает в нашем контуре

Gateway и сервисы подключаются отдельными пользователями с ACL; команды идут через versioned request/reply subjects.

## Что он даёт

- низколатентный request/reply
- JetStream storage для будущих durable flows
- subject ACL и изоляция сервисов

## Практические сценарии

- провести Activity create от web до Factory
- вернуть Gateway readiness в 503 при остановке брокера
- проверить сохранность данных после restart NATS

## Как мы это используем

Node client и NATS Server работают с versioned subjects, ACL и отдельными service users.

## Где находится

`packages/nats`, `infrastructure/nats` и Compose service `brai-nats`.

## Ограничения

Прямые межсервисные HTTP-вызовы и public NATS port запрещены.

## Типичные ошибки

- открыть NATS host port наружу
- использовать общий user или неверный subject version

## Связанные инструменты

- [Fastify](./fastify.md) — Единственный HTTP edge для Gateway Brai New.
- [Zod](./zod.md) — Runtime-проверка входных данных и контрактов на HTTP/NATS границах.
- [Docker Compose](./docker-compose.md) — Описывает локальный и production-like runtime Brai New как набор сервисов.
- [Supabase / PostgreSQL](./supabase-postgresql.md) — Database platform, в которой сервисы владеют своими схемами и ролями.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**client 3.4.0; server host-configured**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- NATS integration tests
- Gateway readiness NATS round-trip

## Источники и дальнейшее чтение

- [NATS package](../../../packages/nats/package.json)
- [NATS config](../../../infrastructure/nats/nats-server.conf)
- [Topology reference](../../../docs/reference/microservice-topology.md)

[← Вернуться к каталогу стека](../README.md)
