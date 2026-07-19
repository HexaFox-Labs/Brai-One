# brai-factory

Headless Node.js 22 service that owns Activity persistence. It has no HTTP
listener and communicates with the API Gateway only through NATS.

Subjects:

- `brai.factory.activity.create.v1`
- `brai.factory.activity.list.v1`

Queue group:

- `brai-factory-v1`

Runtime environment:

```text
NATS_SERVERS=nats://brai-nats:4222
NATS_USER=
NATS_PASSWORD=
DATABASE_URL=
DATABASE_SSL=disable
DATABASE_POOL_MAX=10
DATABASE_CONNECTION_TIMEOUT_MS=3000
DATABASE_QUERY_TIMEOUT_MS=4000
LOG_LEVEL=info
```

`DATABASE_URL` must use the dedicated `brai_factory_runtime` role. That role
has `SELECT` and `INSERT` access only to `brai_factory.activities`.

Database migrations are applied explicitly from
`infrastructure/supabase`; this service never runs migrations at startup.

After building, the container healthcheck can be run manually with:

```bash
node dist/healthcheck.js
```
