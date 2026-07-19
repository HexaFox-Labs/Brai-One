# System Patterns

## Границы сервисов

```text
Browser
  -> same-origin HTTP
apps/web / apps/api-gateway
  -> NATS request/reply
services/brai-factory, services/brai-access
  -> private, service-owned Supabase schemas
```

- Gateway — внешняя HTTP/NATS edge; он не получает database credentials.
- Web — UI; он не получает NATS или database credentials.
- `brai-factory` владеет Activity и схемой `brai_factory`.
- `brai-access` владеет приватным состоянием доступа.
- Межсервисный прикладной трафик использует NATS; прямые HTTP-вызовы между
  Gateway, сервисами и workers не добавляются. Browser `/api/*` идёт через
  Caddy в Gateway, а не от `brai-web` к Gateway как service-to-service call.
- `brai-bus` — internal Docker bus. `brai-nats:4222` доступен на host только
  как `127.0.0.1` для доверенного runtime host; это не public/browser endpoint.
- Точная фактическая карта: `docs/reference/microservice-topology.md`; rationale
  первого фундамента: `docs/decisions/20260719-adopt-nats-service-owned-architecture.md`.

## Выбор и смена доступа

- Trusted backend читает глобальное server-side состояние до запуска и выбирает
  `user-sandbox` или `developer`.
- Launch contract подписан сервером и привязан к run, пользователю, проекту,
  среде, host, access generation, профилю и digest команды.
- Смена режима или membership увеличивает generation и завершает старые
  process trees; права не меняются в уже запущенном процессе.
- Клиентские payload-ы не могут передать profile, owner, actor, generation или
  OS identity.

## Изоляция обычного пользователя

- Один пользователь = одна постоянная OS-изолированная среда, storage root,
  quota и host identity slot для всех его агентов и проектов.
- Один slot получает locked/no-login principal и matching host-level rootless
  Docker engine; engine не принимает access decisions.
- Внутри sandbox нельзя получить Brai source tree, host root, host sockets,
  Caddy, platform secrets, core NATS/Supabase credentials или чужие среды.
- Все runtime находятся внутри root-owned `brai-users.slice` и собственных
  resource limits; факты cgroup проверяет trusted code.

## Данные и least privilege

- Каждая database-owning service использует отдельную Supabase schema и
  ограниченные migration/runtime roles.
- SQLite внутри user volume — default для пользовательской проектной БД.
  Postgres разрешён только внутри соответствующей sandbox/quota.
- Core Supabase не принимает произвольные user schemas, roles, extensions или
  DDL от пользовательских проектов.

## Доставка и checkout

- Публичный вход идёт через Caddy на 80/443; app bindings — `127.0.0.1`.
- CI/CD собирает immutable artifacts и не пишет generated files в live checkout.
- Обычные project writes выполняются как `mark:mark`; recursive ownership repair
  не является штатным восстановлением.
- Причины этого разделения зафиксированы в
  `docs/decisions/20260719-adopt-immutable-artifact-delivery.md`.

## Документация и спецификации

- Проект использует Diátaxis по правилам
  `docs/documentation-methodology.md`: Tutorial обучает, How-to ведёт к
  конкретной цели, Reference фиксирует точные факты и контракты, Explanation
  объясняет причины и компромиссы.
- Постоянный OpenSpec `spec.md` остаётся нормативным Reference; `proposal.md` и
  `design.md` описывают проблему и решения, а `tasks.md` хранит проверяемый
  план исполнения. Методология не меняет синтаксис OpenSpec.
- Перед документированием агенты сверяют реализацию, тесты, contracts и
  конфигурацию; состояния «запланировано», «реализовано», «проверено тестами»,
  «установлено» и «проверено в production» не считаются равнозначными.
- ADR-каталог — статический publication, не микросервис: systemd watcher/timer
  собирает Log4brains от `mark`, применяет тёмную тему Brai и атомарно меняет
  `adr-brai-new/current` только после ADR/docs/OpenSpec checks. Он не получает
  Docker, Caddy, NATS, Supabase или application secrets.

## Нормативные источники

Подробные требования и сценарии: `openspec/specs/agent-access/spec.md` и
`openspec/specs/brai-factory/spec.md`. Разъяснение границ изоляции: `docs/`.
Если это резюме расходится с ними, исправь резюме по нормативному источнику.
