<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Docker Compose

**Категория:** [Инфраструктура](../by-category/infrastructure.md)  
**Статус:** active  
**Версия:** Compose v2  
**Тип:** runtime-orchestration  
**Область:** project

**Теги:** containers, runtime

## Если коротко

Описывает локальный и production-like runtime Brai New как набор сервисов.

## Что это такое

Docker Compose — это декларативное описание набора контейнеров, их сетей, volumes, environment и healthchecks. Он превращает несколько отдельных процессов Brai в видимый service graph, который можно поднять и проверить как единое окружение.

## Зачем это нужно Brai

Для Brai важно видеть не только код, но и реальные связи web, Gateway, NATS, PostgreSQL и доменных сервисов. Compose делает эти связи повторяемыми для local/protected runtime, позволяет проверить readiness и удерживает внутренние порты за loopback и Caddy.

## Почему мы выбрали именно этот инструмент

Compose даёт видимую модель сервисов, сетей, volumes и healthchecks для локального и protected runtime.

## Как он работает в нашем контуре

Корневой compose связывает web, Gateway, NATS и доменные сервисы; application ports привязаны к loopback.

## Что он даёт

- декларативный service graph
- isolated networks и persistent volumes
- healthchecks и restart policy

## Практические сценарии

- поднять Factory vertical slice локально
- проверить итоговую compose config
- перезапустить один сервис и наблюдать readiness

## Как мы это используем

Compose запускается с корневым `compose.yml`; наружу привязаны только нужные loopback endpoints.

## Где находится

`compose.yml`, `infrastructure/docker` и production compose config.

## Ограничения

Приложения не публикуют внешние порты напрямую.

## Типичные ошибки

- запустить production workflow из live checkout
- публиковать внутренний NATS или database port

## Связанные инструменты

- [Caddy](./caddy.md) — Единая внешняя точка входа с TLS, redirect, Basic Auth и маршрутизацией.
- [NATS](./nats.md) — Приватная шина request/reply между Gateway и сервисами Brai New.
- [Nginx](./nginx.md) — Непривилегированный static server внутри web runtime image.
- [Supabase / PostgreSQL](./supabase-postgresql.md) — Database platform, в которой сервисы владеют своими схемами и ролями.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**Compose v2**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `pnpm run compose:config`
- `docker compose ps`

## Источники и дальнейшее чтение

- [Compose file](../../../compose.yml)
- [Docker README](../../../infrastructure/docker/README.md)

[← Вернуться к каталогу стека](../README.md)
