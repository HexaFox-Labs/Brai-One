# brai-api-gateway

Единственная HTTP-точка входа Brai Factory. Gateway принимает запросы web-клиента,
проверяет их и передаёт в `brai-factory` только через Core NATS request/reply.
Подключения к Supabase и прямых HTTP-вызовов микросервисов здесь нет.

## HTTP

- `GET /api/v1/activities`
- `POST /api/v1/activities`
- `POST /api/v1/agent-runs` — только проверенный Supabase Bearer JWT;
- `POST /api/v1/admin/users/:user_id/developer-mode` — только защищённый
  platform-superadmin proxy header;
- `GET /health/live`
- `GET /health/ready`

Для `POST` обязательны `Content-Type: application/json` и
`Idempotency-Key: <UUID v4>`. `X-Request-ID` принимается только как UUID v4;
при отсутствии или неверном формате Gateway создаёт новый идентификатор.

Access routes включаются только через `ACCESS_API_ENABLED=true`. Публичный
launch body содержит ровно `project_id` и `prompt`; идентичность пользователя
берётся из проверенного JWT. Admin body содержит только boolean
`developer_mode`, а target user связан параметром URL. Ни один HTTP-клиент не
может передать access profile, generation, job command/digest, UID/GID, путь
хранилища или cgroup. Gateway не имеет credentials базы `brai-access` и
общается с ним только через Core NATS.
