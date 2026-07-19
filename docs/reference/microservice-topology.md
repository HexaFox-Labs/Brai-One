# Микросервисная топология Brai New

**Статус:** `active`  
**Тип:** reference  
**Проверено по:** `compose.yml`, `infrastructure/nats/nats-server.conf`,
`infrastructure/caddy/factory.caddy`, сервисным README, миграциям и контрактам
на `2026-07-19` UTC

Этот документ описывает фактические границы первого микросервисного фундамента.
Нормативные сценарии Activity находятся в
[`openspec/specs/brai-factory/spec.md`](../../openspec/specs/brai-factory/spec.md),
а причины выбора — в
[ADR о NATS-центричной архитектуре](../decisions/20260719-adopt-nats-service-owned-architecture.md).

## Внешний путь запроса

Для `factory.brai.one` браузер всегда обращается к одному origin.

| Путь                     | Caddy направляет в                    | Назначение                                            |
| ------------------------ | ------------------------------------- | ----------------------------------------------------- |
| Все пути, кроме `/api/*` | `127.0.0.1:3200` → `brai-web`         | static Next.js export через непривилегированный Nginx |
| `/api/*`                 | `127.0.0.1:3201` → `brai-api-gateway` | валидация HTTP и NATS edge                            |

Caddy принимает внешний HTTP/HTTPS, перенаправляет HTTP на HTTPS, применяет
unified Basic Auth и удаляет его `Authorization` header перед каждым upstream.
Ни web, ни Gateway не имеют публичного host binding: оба опубликованных
container socket доступны только на loopback.

## Контейнеры и ответственность

| Контейнер            | Роль                                           | Получает                                                       | Не получает                         |
| -------------------- | ---------------------------------------------- | -------------------------------------------------------------- | ----------------------------------- |
| `brai-web`           | Static UI                                      | same-origin HTTP API                                           | NATS и database credentials         |
| `brai-api-gateway`   | Единственный browser-facing HTTP edge          | Gateway NATS credentials                                       | credentials схем Factory/Access     |
| `brai-nats`          | Core NATS request/reply, JetStream storage     | отдельные service users и ACL                                  | внешний публичный порт              |
| `brai-factory`       | Владелец Activity                              | Factory NATS user и runtime role своей схемы                   | публичный HTTP и чужие schemas      |
| `brai-access`        | Владелец состояния доступа и lifecycle runtime | Access NATS user и role своей схемы                            | выбор profile из клиента или модели |
| `brai-factory-admin` | One-off Factory migrations/role provisioning   | административный migration credential только в profile `admin` | постоянный runtime surface          |

## Сети и прослушиваемые адреса

| Сеть                       | Участники                      | Назначение                                                                                   |
| -------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| `brai-edge`                | `brai-web`, `brai-api-gateway` | путь Caddy к двум loopback-bound приложениям                                                 |
| `brai-bus` (internal)      | Gateway, NATS, Factory, Access | единственная Docker-сеть прикладного межсервисного трафика                                   |
| `brai-host-loopback`       | NATS                           | техническая сеть, позволяющая root-owned runtime host подключаться только к `127.0.0.1:4222` |
| `brai-supabase` (external) | Factory, Access, one-off admin | доступ только владельцев данных к существующему Supabase                                     |

`brai-nats` публикует `127.0.0.1:4222` не для браузера и не для другого
микросервиса, а для доверенного host runtime controller. Monitoring port `8222`
в host не публикуется. Внешними ingress-портами остаются только Caddy `80/443`
и SSH `22` по host policy.

## Activity: транспорт и подтверждение записи

1. Web-код формирует same-origin `GET` или `POST /api/v1/activities`.
2. Caddy направляет `/api/*` в Gateway.
3. Gateway валидирует HTTP-форму, `X-Request-ID` и для create
   `Idempotency-Key`, затем выполняет Core NATS request/reply.
4. Factory слушает subject через queue group `brai-factory-v1`, подтверждает
   фактическую запись в `brai_factory.activities` и отвечает в Gateway inbox.
5. Gateway возвращает HTTP-ответ. При отсутствии responder или сбое записи он
   не выдаёт ложный успех.

| Операция         | NATS subject                      | Версия request/response schema                                                         |
| ---------------- | --------------------------------- | -------------------------------------------------------------------------------------- |
| Создать Activity | `brai.factory.activity.create.v1` | `brai.factory.activity.create.request.v1` / `brai.factory.activity.create.response.v1` |
| Получить список  | `brai.factory.activity.list.v1`   | `brai.factory.activity.list.request.v1` / `brai.factory.activity.list.response.v1`     |

Публичные HTTP envelopes имеют отдельные versioned schema names. Все service
credentials ограничены subject ACL в
[`infrastructure/nats/nats-server.conf`](../../infrastructure/nats/nats-server.conf).
JetStream включён и его `brai-nats-data` volume persistent, но streams для
Activity первой версии не создаются.

## Владение данными и миграции

| Домен                   | Владелец       | Schema / credentials                                        | Порядок изменения                                       |
| ----------------------- | -------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| Activity                | `brai-factory` | `brai_factory`, отдельные migration и runtime roles         | Явная one-off migration; runtime старт не выполняет DDL |
| Access state            | `brai-access`  | `brai_access`, независимые migration/runtime roles и ledger | Свой bootstrap и regular migration path                 |
| Пользовательский проект | user sandbox   | SQLite по умолчанию или Postgres внутри quota               | Не создаёт schemas, roles или DDL в core Supabase       |

`brai_factory_runtime` получает только `CONNECT`, `USAGE`, `SELECT` и `INSERT`
на нужной таблице, серверные connection/time limits и не получает migration
privileges, `UPDATE`, `DELETE`, `TEMPORARY`, public/foreign schema access или
Supabase Data API. Подробная процедура находится в
[`infrastructure/supabase/README.md`](../../infrastructure/supabase/README.md).

## Статусы реализации

- Factory vertical slice реализован, проверен тестами и опубликован на
  `factory.brai.one`; production QA и Caddy route описаны в
  [`infrastructure/caddy/README.md`](../../infrastructure/caddy/README.md).
- `brai-access` и host runtime имеют собственные нормативные требования и
  operator evidence. Их наличие в общей топологии не означает, что любой
  будущий access/ingress capability уже активирован в production.
- Production delivery через digest-addressed artifacts является отдельной
  архитектурной политикой и требует отдельной host activation; см.
  [ADR о immutable delivery](../decisions/20260719-adopt-immutable-artifact-delivery.md)
  и [`infrastructure/deployment/README.md`](../../infrastructure/deployment/README.md).
