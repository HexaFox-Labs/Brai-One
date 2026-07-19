# Принять NATS-центричную микросервисную архитектуру с service-owned данными

- Status: accepted
- Deciders: Сергей Bright, Mark
- Date: 2026-07-19
- Tags: architecture, microservices, nats, supabase, factory

## Контекст

Brai New начался как новый фундамент вместо монолитного продолжения старого
проекта. Первому вертикальному срезу нужны web-интерфейс, публичный HTTP edge,
Activity service и существующий Supabase, но Gateway и web не должны стать
носителями database credentials или произвольных межсервисных HTTP-связей.
Нужен повторяемый паттерн для будущих сервисов и workers.

## Решение

Принята одна базовая топология:

- браузер использует same-origin HTTP через Caddy, а Caddy маршрутизирует
  `/api/*` только в Gateway;
- Gateway является единственным HTTP edge для сервисов и общается с ними только
  через versioned Core NATS request/reply contracts;
- `brai-factory` и `brai-access` не получают публичного HTTP surface;
- каждый владелец данных получает собственную приватную Supabase schema,
  независимые migration/runtime credentials и минимальные SQL grants;
- NATS использует отдельные service users с subject-level ACL. JetStream включён
  с persistent bounded storage, но первая версия Activity не создаёт streams;
- Caddy остаётся единственным внешним ingress, а application sockets доступны
  host только через loopback. Исключение `127.0.0.1:4222` предназначено
  исключительно доверенному root-owned runtime controller, не браузеру.

Подробная фактическая карта находится в
[`docs/reference/microservice-topology.md`](../reference/microservice-topology.md).

## Рассмотренные альтернативы

- **Прямой HTTP между Gateway и сервисами:** отклонён, потому что создаёт
  неявные service-to-service endpoints и размывает transport/ACL boundary.
- **Общая Supabase schema и общий runtime login:** отклонены, потому что одна
  скомпрометированная credential расширяет blast radius на чужой домен данных.
- **Браузер напрямую обращается к Supabase или NATS:** отклонено, потому что
  это раскрывает внутренние credentials и обходит Gateway validation.
- **JetStream для каждой синхронной Activity операции:** отклонено для v1:
  Core request/reply проще соответствует синхронному подтверждению записи;
  durable streams создаются только когда появится отдельный асинхронный кейс.

## Последствия

- Плюс: contracts, ownership и точки доступа становятся явными и проверяемыми.
- Плюс: Gateway/web не имеют database credentials, а runtime role сервиса не
  может выполнять DDL или работать с чужими schemas.
- Плюс: новый сервис повторяет один генераторный и сетевой паттерн.
- Минус: нужно поддерживать NATS users/ACL, отдельные migration paths и
  observability для нескольких контейнеров.
- Ограничение: single-node NATS и отсутствие streams не дают HA или durable
  event workflow; такие свойства требуют отдельного решения и спецификации.

## Проверка

- `compose.yml` фиксирует сети, loopback bindings и отсутствие публичных
  service ports.
- `infrastructure/nats/nats-server.conf` ограничивает subjects отдельными
  credential-парами.
- `openspec/specs/brai-factory/spec.md` требует NATS boundary и least privilege.
- Factory/Gateway unit и integration tests проверяют create/list, idempotency,
  отсутствие responder и ошибки persistence.
- `infrastructure/caddy/README.md` содержит evidence опубликованного
  `factory.brai.one` и browser QA.

## Ссылки

- [`docs/reference/microservice-topology.md`](../reference/microservice-topology.md)
- [`docs/explanation/system-overview.md`](../explanation/system-overview.md)
- [`openspec/specs/brai-factory/spec.md`](../../openspec/specs/brai-factory/spec.md)
- [`openspec/changes/archive/2026-07-18-brai-factory-foundation/design.md`](../../openspec/changes/archive/2026-07-18-brai-factory-foundation/design.md)
- [`infrastructure/nats/README.md`](../../infrastructure/nats/README.md)
- [`infrastructure/supabase/README.md`](../../infrastructure/supabase/README.md)

## Заменяет

Нет.

## Заменено

Нет.
