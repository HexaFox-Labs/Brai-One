# Project Brief

## Название

Brai New / Brai Factory.

## Цель

Построить безопасный микросервисный фундамент Brai с изолированным доступом
агентов и первым вертикальным срезом Factory. Система должна проводить
прикладной трафик через Gateway и NATS, оставляя базы данных во владении
конкретных сервисов, а права runtime выбирать только из доверенного серверного
состояния.

## Текущий охват репозитория

- `apps/web` — статический Next.js web-интерфейс.
- `apps/api-gateway` — HTTP-вход и граница NATS.
- `services/brai-factory` — владелец Activity и своей схемы Supabase.
- `services/brai-access` — приватное транзакционное состояние доступа.
- `packages/` — общие runtime, NATS, контракты, routing, agent-access и
  пользовательская БД.
- `infrastructure/` — NATS, Supabase, deployment, Caddy и runtime изоляции.
- `tools/ci` и `tools/generators` — проверки политики, интеграционные тесты и
  генераторы сервисов.

## Первый продуктовый вертикальный срез

Защищённый web должен позволять создавать и просматривать Activity. Успех
создания подтверждается `brai-factory` после записи в его приватную схему;
повтор с тем же idempotency key не создаёт дубликат, а список выдаётся с
ограниченной cursor-пагинацией. Нормативный контракт находится в
[`openspec/specs/brai-factory/spec.md`](../openspec/specs/brai-factory/spec.md).

## Границы доступа агентов

Существуют ровно два серверно выбранных профиля: `user-sandbox` и `developer`.
Обычный пользователь получает одну постоянную изолированную среду, общую для
его агентов и проектов; developer-runtime работает как `mark` с контрактом
Codex Desktop. Модель, prompt, клиент, project admin и сам процесс не могут
выбрать или повысить профиль. Нормативный контракт находится в
[`openspec/specs/agent-access/spec.md`](../openspec/specs/agent-access/spec.md).

## Что не следует считать частью этой цели

В foundation доступа отдельно исключены подключение GitHub, активация CI/CD,
production ingress пользовательских доменов, managed Postgres и multi-host
sharding. Их отсутствие не является незавершённостью модели прав; см.
разделы scope в OpenSpec.
