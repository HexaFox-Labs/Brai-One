# Прикладной стек

**Статус:** `active`

## Web

| Компонент                  | Версия            | Роль                              | Где                                                                          |
| -------------------------- | ----------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| Next.js                    | `16.2.9`          | App Router и static export        | [`apps/web/package.json`](../../apps/web/package.json)                       |
| React / React DOM          | `19.2.4`          | UI runtime                        | [`apps/web/package.json`](../../apps/web/package.json)                       |
| Tailwind CSS               | `4.3.1`           | Utility-first стили               | [`apps/web/package.json`](../../apps/web/package.json), `postcss.config.mjs` |
| Radix UI                   | `1.6.0`           | Базовые accessible UI primitives  | [`apps/web/package.json`](../../apps/web/package.json)                       |
| `lucide-react`             | `1.21.0`          | Иконки                            | [`apps/web/package.json`](../../apps/web/package.json)                       |
| `geist`                    | `1.7.2`           | Шрифтовые assets                  | [`apps/web/package.json`](../../apps/web/package.json)                       |
| `clsx` / `tailwind-merge`  | `2.1.1` / `3.6.0` | Сборка и нормализация class names | [`apps/web/package.json`](../../apps/web/package.json)                       |
| `class-variance-authority` | `0.7.1`           | Варианты UI-компонентов           | [`apps/web/package.json`](../../apps/web/package.json)                       |

Next настроен на `output: "export"`, `trailingSlash: true` и отключённую
оптимизацию изображений. Результат собирается в `apps/web/out` и раздаётся
непривилегированным Nginx из runtime-образа.

Web общается с Gateway только через same-origin HTTP. Он не получает NATS- или
database credentials.

## Gateway и сервисы

| Компонент | Версия   | Роль                                                               |
| --------- | -------- | ------------------------------------------------------------------ |
| Fastify   | `5.10.0` | HTTP edge в `apps/api-gateway`                                     |
| Zod       | `4.4.3`  | Runtime validation и контракты                                     |
| JOSE      | `6.2.3`  | Работа с JWT/подписанными структурами в Gateway                    |
| Pino      | `10.3.1` | Структурированные логи                                             |
| `pg`      | `8.16.3` | PostgreSQL client только для владельцев данных и migration tooling |

Gateway принимает HTTP и публикует разрешённые NATS request/reply subjects.
`brai-factory` и `brai-access` не получают публичный HTTP surface; прямые
межсервисные HTTP-вызовы запрещены правилами проекта.

## Messaging

| Компонент                 | Версия                       | Роль                           |
| ------------------------- | ---------------------------- | ------------------------------ |
| `@nats-io/nats-core`      | `3.4.0`                      | NATS client                    |
| `@nats-io/transport-node` | `3.4.0`                      | Node.js transport              |
| NATS Server               | задаётся образом/host config | Core request/reply и JetStream |

Обёртка находится в [`packages/nats`](../../packages/nats). Доступ выдаётся
отдельными credential-парами Gateway, Factory, Access и runtime-controller;
точные subject ACL находятся в
[`infrastructure/nats/nats-server.conf`](../../infrastructure/nats/nats-server.conf).

## Внутренние пакеты

| Пакет                         | Назначение                                                     |
| ----------------------------- | -------------------------------------------------------------- |
| `@brai/contracts`             | Версионируемые схемы и межграничные типы                       |
| `@brai/runtime`               | Общий runtime, env, logger, shutdown и UUID helpers            |
| `@brai/nats`                  | Клиент и настройки NATS                                        |
| `@brai/agent-access`          | Домен доступа и launch contracts                               |
| `@brai/user-project-database` | SQLite по умолчанию и пользовательский Postgres внутри sandbox |
| `@brai/user-project-routing`  | Проверка custom-domain/project routing boundary                |

Новый shared package добавляется только если ownership и API boundary понятны.
Случайную общую утилиту не следует выносить до появления повторного
использования и тестируемого контракта.
