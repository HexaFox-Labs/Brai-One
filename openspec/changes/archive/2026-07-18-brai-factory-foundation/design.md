# Design

## Runtime topology

`brai-web` и `brai-api-gateway` доступны Caddy только через localhost bindings. Gateway преобразует HTTP create/list в Core NATS request/reply. `brai-factory` — единственный владелец schema `brai_factory` и единственный новый runtime с database credentials.

Project networks:

- `brai-edge`: web и gateway;
- `brai-bus`: gateway, NATS и factory;
- external `brai-supabase`: только factory.

NATS запускается single-node с JetStream volume, но v1 не создаёт streams. Gateway и factory используют отдельные users и subject permissions.

## Contracts

Public HTTP:

- `GET /api/v1/activities`
- `POST /api/v1/activities`
- `GET /health/live`
- `GET /health/ready`

NATS:

- `brai.factory.activity.create.v1`
- `brai.factory.activity.list.v1`

Все contracts versioned, strict и содержат UUID v4 `request_id`. Create требует UUID v4 `Idempotency-Key`.

## Persistence

`brai_factory.activities` хранит UUID, title, description, idempotency key, request id и UTC creation time. Runtime role имеет только `SELECT` и `INSERT`. Миграции применяются отдельно и не выполняются сервисом при старте.

## Delivery

Production использует существующие Docker, Caddy и Supabase. Внешние application ports не открываются. Caddy защищает весь `factory.brai.one` едиными workspace credentials. Rollback удаляет route и останавливает новые containers, но не удаляет schema или NATS volume.

