# Brai Factory web

Статический Next.js App Router клиент для `factory.brai.one`.

## Команды

```bash
pnpm --dir apps/web dev
pnpm --dir apps/web lint
pnpm --dir apps/web typecheck
pnpm --dir apps/web test
pnpm --dir apps/web build
pnpm --dir apps/web e2e
BRAI_WEB_E2E_BASE_URL=http://127.0.0.1:3200 pnpm --dir apps/web e2e
```

`next build` создаёт каталог `out/`. Runtime-образ раздаёт его через
непривилегированный Nginx на порту `8080`.
Вторая E2E-команда не запускает Next dev server и проверяет уже работающий
static runtime.

## HTTP-контракт

Клиент использует только same-origin адреса:

- `GET /api/v1/activities?limit=50&cursor=...`
- `POST /api/v1/activities`

Для каждого запроса создаётся новый `X-Request-ID` в формате UUID v4. Для
создания также отправляется `Idempotency-Key`. После сетевой или серверной
ошибки ключ сохраняется, пока пользователь не изменит поля формы.

Ожидаемый ответ списка:

```json
{
  "schema_version": "brai.http.activity.list.response.v1",
  "request_id": "uuid-v4",
  "activities": [],
  "next_cursor": null
}
```

Ожидаемый ответ создания:

```json
{
  "schema_version": "brai.http.activity.create.response.v1",
  "request_id": "uuid-v4",
  "activity": {
    "id": "uuid-v4",
    "title": "Заголовок",
    "description": "",
    "created_at": "2026-07-16T12:00:00.000Z"
  },
  "idempotent_replay": false
}
```

Runtime guard проверяет точные публичные `schema_version`, UUID v4 и форму
данных. Ошибка должна содержать `request_id`, `code` и русское `message`.
