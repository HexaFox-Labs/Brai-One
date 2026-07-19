# Brai full-stack integration tests

Тесты поднимают только временные контейнеры Testcontainers:

- PostgreSQL `17.6-alpine`;
- NATS `2.14.3-alpine` с теми же subject-level границами, что и production.

Production Compose, существующий Supabase и работающие контейнеры тесты не
изменяют.

Покрыто:

- первый и повторный запуск настоящего migration CLI;
- HTTP Gateway → NATS request/reply → Factory → PostgreSQL;
- `request_id` до строки БД и структурированного лога Factory;
- сортировка и cursor pagination;
- idempotent replay и конфликт ключа;
- `503` без responder и при остановленной БД;
- запрет лишней NATS-публикации и подписки для service users.

NATS сообщает нарушение publish/subscribe ACL асинхронно через status stream
клиента. Проверка ожидает типизированный `PermissionViolationError` и сверяет
операцию и subject. Она не анализирует текст логов брокера, потому что формат
этих строк не является стабильным API.

## Подключение к workspace

Корневой `pnpm-workspace.yaml` должен содержать:

```yaml
packages:
  - tools/ci/integration
```

После добавления workspace-пути нужно обновить единый lockfile:

```bash
pnpm install --no-frozen-lockfile
```

## Проверка

```bash
pnpm --filter @brai/integration-tests lint
pnpm --filter @brai/integration-tests typecheck
pnpm --filter @brai/integration-tests test
```

Для запуска нужен доступ к локальному Docker daemon и возможность получить
зафиксированные тестовые образы. Секреты production не используются.
