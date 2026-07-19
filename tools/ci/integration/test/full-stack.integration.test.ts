import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  ACTIVITY_CREATE_SUBJECT,
  createActivityHttpResponseSchema,
  httpErrorSchema,
  listActivitiesHttpResponseSchema,
} from "@brai/contracts";
import {
  PermissionViolationError,
  type NatsConnection,
  type Status,
} from "@nats-io/nats-core";
import { Pool } from "pg";
import pino, { type DestinationStream } from "pino";
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGatewayApp } from "../../../../apps/api-gateway/src/app.js";
import { createGatewayMessageBus } from "../../../../apps/api-gateway/src/bus.js";
import type { GatewayConfig } from "../../../../apps/api-gateway/src/config.js";
import {
  connectNats,
  drainNats,
  encodeJson,
} from "../../../../packages/nats/src/index.js";
import { createLogger } from "../../../../packages/runtime/src/index.js";
import { createDatabase } from "../../../../services/brai-factory/src/database.js";
import { FactoryService } from "../../../../services/brai-factory/src/factory-service.js";
import { ActivityRepository } from "../../../../services/brai-factory/src/repository.js";
import { startWorker } from "../../../../services/brai-factory/src/worker.js";
import { readMigrationFiles } from "../../../../infrastructure/supabase/src/migration-files.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const tsxExecutable = resolve(repositoryRoot, "node_modules/.bin/tsx");
const migrationEntrypoint = resolve(
  repositoryRoot,
  "infrastructure/supabase/src/migrate.ts",
);
const roleProvisionerEntrypoint = resolve(
  repositoryRoot,
  "infrastructure/supabase/src/provision-runtime-role.ts",
);
const databaseHardeningPath = resolve(
  repositoryRoot,
  "infrastructure/supabase/hardening/0001_restrict_database_public_defaults.sql",
);
const pgNetHardeningPath = resolve(
  repositoryRoot,
  "infrastructure/supabase/hardening/0001_restrict_pg_net_public_usage.sql",
);
const natsConfigPath = resolve(
  repositoryRoot,
  "infrastructure/nats/nats-server.conf",
);

const POSTGRES_IMAGE = "postgres:17.6-alpine";
const NATS_IMAGE = "nats:2.14.3-alpine";
const POSTGRES_DATABASE = "brai_integration";
const POSTGRES_ADMIN_USER = "postgres";
const POSTGRES_ADMIN_PASSWORD = "brai-integration-postgres-password";
const POSTGRES_RUNTIME_USER = "brai_factory_runtime";
const POSTGRES_RUNTIME_PASSWORD = "brai-integration-runtime-password-32chars";
const POSTGRES_EXISTING_CONSUMER = "authenticated";
const NATS_GATEWAY_USER = "brai_gateway_test";
const NATS_GATEWAY_PASSWORD = "brai-integration-gateway-password";
const NATS_FACTORY_USER = "brai_factory_test";
const NATS_FACTORY_PASSWORD = "brai-integration-factory-password";
const NATS_ACCESS_USER = "brai_access_test";
const NATS_ACCESS_PASSWORD = "brai-integration-access-password";
const NATS_RUNTIME_USER = "brai_runtime_test";
const NATS_RUNTIME_PASSWORD = "brai-integration-runtime-password";
const NATS_FORBIDDEN_SUBJECT = "brai.forbidden.integration.v1";
const NATS_FOREIGN_INBOX = "_INBOX.brai.foreign.reply";
const PUBLIC_ORIGIN = "https://factory.brai.one";

const natsConfig = readFileSync(natsConfigPath, "utf8").replace(
  'store_dir: "/data/jetstream"',
  'store_dir: "/tmp/nats/jetstream"',
);

type JsonObject = Record<string, unknown>;

type HttpResult = {
  body: unknown;
  status: number;
};

type MigrationEvent = {
  applied_count: number;
  event: "migrations_complete";
  level: "info";
};

type FactoryLogEntry = {
  msg?: unknown;
  request_id?: unknown;
};

let postgresContainer: StartedTestContainer | undefined;
let natsContainer: StartedTestContainer | undefined;
let postgresStopped = false;
let adminPool: Pool | undefined;
let factoryPool: Pool | undefined;
let gatewayConnection: NatsConnection | undefined;
let factoryConnection: NatsConnection | undefined;
let factoryWorkerLoops: Promise<void>[] = [];
let gatewayApp: Awaited<ReturnType<typeof createGatewayApp>> | undefined;
let gatewayUrl = "";
let firstMigrationAppliedCount = -1;
let secondMigrationAppliedCount = -1;
let expectedMigrationCount = -1;
let factoryLogOutput = "";

function databaseUrl(
  container: StartedTestContainer,
  username: string,
  password: string,
): string {
  const url = new URL("postgresql://localhost");
  url.hostname = container.getHost();
  url.port = String(container.getMappedPort(5_432));
  url.username = username;
  url.password = password;
  url.pathname = `/${POSTGRES_DATABASE}`;
  return url.toString();
}

function natsUrl(container: StartedTestContainer): string {
  return `nats://${container.getHost()}:${container.getMappedPort(4_222)}`;
}

function migrationEnvironment(adminDatabaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BRAI_FACTORY_MIGRATION_DATABASE_SSL: "disable",
    BRAI_FACTORY_MIGRATION_DATABASE_URL: adminDatabaseUrl,
    NODE_ENV: "test",
  };
}

function readJsonEvent<T extends JsonObject>(
  stdout: string,
  eventName: string,
): T {
  for (const line of stdout.trim().split(/\r?\n/u).reverse()) {
    try {
      const value = JSON.parse(line) as unknown;

      if (
        value !== null &&
        typeof value === "object" &&
        "event" in value &&
        value.event === eventName
      ) {
        return value as T;
      }
    } catch {
      // Ignore non-JSON diagnostics emitted by the runner.
    }
  }

  throw new Error(`Не найдено событие ${eventName} в выводе CLI`);
}

async function runMigrationCli(
  adminDatabaseUrl: string,
): Promise<MigrationEvent> {
  const result = await execFileAsync(tsxExecutable, [migrationEntrypoint], {
    cwd: repositoryRoot,
    env: migrationEnvironment(adminDatabaseUrl),
    maxBuffer: 1024 * 1024,
  });

  return readJsonEvent<MigrationEvent>(result.stdout, "migrations_complete");
}

async function provisionRuntimeRole(adminDatabaseUrl: string): Promise<void> {
  await execFileAsync(tsxExecutable, [roleProvisionerEntrypoint], {
    cwd: repositoryRoot,
    env: {
      ...migrationEnvironment(adminDatabaseUrl),
      BRAI_FACTORY_RUNTIME_DATABASE_PASSWORD: POSTGRES_RUNTIME_PASSWORD,
    },
    maxBuffer: 1024 * 1024,
  });
}

function gatewayConfig(server: string): GatewayConfig {
  return {
    accessAuth: null,
    allowLoopbackHosts: true,
    host: "127.0.0.1",
    logLevel: "silent",
    natsInboxPrefix: "_INBOX.brai.gateway",
    natsPassword: NATS_GATEWAY_PASSWORD,
    natsRequestTimeoutMs: 800,
    natsServers: [server],
    natsUser: NATS_GATEWAY_USER,
    nodeEnv: "test",
    port: 3_201,
    publicOrigins: [PUBLIC_ORIGIN],
  };
}

async function postActivity(
  title: string,
  description: string,
  idempotencyKey: string,
  requestId = randomUUID(),
): Promise<HttpResult> {
  const response = await fetch(`${gatewayUrl}/api/v1/activities`, {
    body: JSON.stringify({ description, title }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      origin: PUBLIC_ORIGIN,
      "x-request-id": requestId,
    },
    method: "POST",
  });

  return {
    body: await response.json(),
    status: response.status,
  };
}

async function listActivities(
  limit: number,
  cursor: string | null = null,
  requestId = randomUUID(),
): Promise<HttpResult> {
  const url = new URL("/api/v1/activities", gatewayUrl);
  url.searchParams.set("limit", String(limit));

  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  const response = await fetch(url, {
    headers: {
      origin: PUBLIC_ORIGIN,
      "x-request-id": requestId,
    },
  });

  return {
    body: await response.json(),
    status: response.status,
  };
}

function statusWithTimeout(
  iterator: AsyncIterator<Status>,
  timeoutMs: number,
): Promise<IteratorResult<Status>> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(new Error("NATS не сообщил об ACL-ошибке вовремя"));
    }, timeoutMs);

    iterator.next().then(
      (result) => {
        clearTimeout(timer);
        resolvePromise(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    );
  });
}

async function expectPermissionViolation(
  connection: NatsConnection,
  action: () => void,
  expectedOperation: PermissionViolationError["operation"],
  expectedSubject: string,
): Promise<void> {
  const iterator = connection.status()[Symbol.asyncIterator]();

  try {
    action();
    await connection.flush();

    const result = await statusWithTimeout(iterator, 3_000);

    expect(result.done).toBe(false);

    if (result.done || result.value.type !== "error") {
      throw new Error(
        `Ожидалась NATS ACL-ошибка, получено: ${JSON.stringify(result.value)}`,
      );
    }

    expect(result.value.error).toBeInstanceOf(PermissionViolationError);

    const permissionError = result.value.error as PermissionViolationError;
    expect(permissionError.operation).toBe(expectedOperation);
    expect(permissionError.subject).toBe(expectedSubject);
  } finally {
    await iterator.return?.();
  }
}

async function startFactory(server: string): Promise<void> {
  if (factoryConnection) {
    return;
  }

  if (!postgresContainer) {
    throw new Error("PostgreSQL container не запущен");
  }

  const destination: DestinationStream = {
    write(message: string): void {
      factoryLogOutput += message;
    },
  };
  const logger = pino(
    {
      base: null,
      level: "info",
      timestamp: false,
    },
    destination,
  );

  factoryPool = createDatabase(
    {
      application_name: "brai-factory-integration",
      connectionString: databaseUrl(
        postgresContainer,
        POSTGRES_RUNTIME_USER,
        POSTGRES_RUNTIME_PASSWORD,
      ),
      max: 4,
      ssl: false,
    },
    logger,
  );
  factoryConnection = await connectNats({
    connectTimeoutMs: 5_000,
    maxReconnectAttempts: 0,
    name: "brai-factory-integration",
    pass: NATS_FACTORY_PASSWORD,
    servers: server,
    user: NATS_FACTORY_USER,
  });

  const service = new FactoryService(
    new ActivityRepository(factoryPool),
    logger,
  );
  factoryWorkerLoops = startWorker(factoryConnection, service, logger);
  await factoryConnection.flush();
}

function parsedFactoryLogs(): FactoryLogEntry[] {
  return factoryLogOutput
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line) as unknown;
        return value !== null && typeof value === "object"
          ? [value as FactoryLogEntry]
          : [];
      } catch {
        return [];
      }
    });
}

async function truncateActivities(): Promise<void> {
  if (!adminPool) {
    throw new Error("Admin PostgreSQL pool не запущен");
  }

  await adminPool.query("TRUNCATE TABLE brai_factory.activities");
}

describe.sequential("Brai Factory full-stack", () => {
  beforeAll(async () => {
    postgresContainer = await new GenericContainer(POSTGRES_IMAGE)
      .withEnvironment({
        POSTGRES_DB: POSTGRES_DATABASE,
        POSTGRES_PASSWORD: POSTGRES_ADMIN_PASSWORD,
        POSTGRES_USER: POSTGRES_ADMIN_USER,
      })
      .withExposedPorts(5_432)
      .withHealthCheck({
        interval: 1_000,
        retries: 30,
        startPeriod: 1_000,
        test: [
          "CMD-SHELL",
          `pg_isready -U ${POSTGRES_ADMIN_USER} -d ${POSTGRES_DATABASE}`,
        ],
        timeout: 3_000,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(120_000)
      .start();

    natsContainer = await new GenericContainer(NATS_IMAGE)
      .withEnvironment({
        NATS_ACCESS_PASSWORD,
        NATS_ACCESS_USER,
        NATS_FACTORY_PASSWORD,
        NATS_FACTORY_USER,
        NATS_GATEWAY_PASSWORD,
        NATS_GATEWAY_USER,
        NATS_RUNTIME_PASSWORD,
        NATS_RUNTIME_USER,
      })
      .withCopyContentToContainer([
        {
          content: natsConfig,
          mode: 0o644,
          target: "/etc/nats/brai-integration.conf",
        },
      ])
      .withCommand(["-c", "/etc/nats/brai-integration.conf"])
      .withExposedPorts(4_222)
      .withWaitStrategy(Wait.forLogMessage(/Server is ready/u))
      .withStartupTimeout(120_000)
      .start();

    const adminDatabaseUrl = databaseUrl(
      postgresContainer,
      POSTGRES_ADMIN_USER,
      POSTGRES_ADMIN_PASSWORD,
    );
    const bootstrapPool = new Pool({
      application_name: "brai-integration-bootstrap",
      connectionString: adminDatabaseUrl,
      max: 1,
    });
    await bootstrapPool.query(`
      CREATE ROLE ${POSTGRES_EXISTING_CONSUMER} NOLOGIN;
      CREATE SCHEMA net;
      CREATE TABLE net.http_request_queue (id bigint PRIMARY KEY);
      CREATE SEQUENCE net.http_request_queue_id_seq;
      CREATE FUNCTION net.http_get()
        RETURNS bigint
        LANGUAGE sql
        AS 'SELECT 1::bigint';
      GRANT USAGE ON SCHEMA net TO PUBLIC;
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA net TO PUBLIC;
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA net TO PUBLIC;
    `);

    expectedMigrationCount = (await readMigrationFiles()).length;
    const firstMigration = await runMigrationCli(adminDatabaseUrl);
    await bootstrapPool.query(readFileSync(databaseHardeningPath, "utf8"));
    await bootstrapPool.query(readFileSync(pgNetHardeningPath, "utf8"));
    await bootstrapPool.end();
    const secondMigration = await runMigrationCli(adminDatabaseUrl);
    firstMigrationAppliedCount = firstMigration.applied_count;
    secondMigrationAppliedCount = secondMigration.applied_count;
    await provisionRuntimeRole(adminDatabaseUrl);

    adminPool = new Pool({
      application_name: "brai-integration-admin",
      connectionString: adminDatabaseUrl,
      max: 2,
    });
    adminPool.on("error", () => undefined);

    const server = natsUrl(natsContainer);
    gatewayConnection = await connectNats({
      connectTimeoutMs: 5_000,
      inboxPrefix: "_INBOX.brai.gateway",
      maxReconnectAttempts: 0,
      name: "brai-api-gateway-integration",
      pass: NATS_GATEWAY_PASSWORD,
      servers: server,
      user: NATS_GATEWAY_USER,
    });
    gatewayApp = await createGatewayApp({
      bus: createGatewayMessageBus(gatewayConnection, 800),
      config: gatewayConfig(server),
      logger: createLogger({
        level: "silent",
        name: "brai-api-gateway-integration",
      }),
    });
    gatewayUrl = await gatewayApp.listen({
      host: "127.0.0.1",
      port: 0,
    });
  });

  afterAll(async () => {
    if (gatewayApp) {
      await gatewayApp.close().catch(() => undefined);
    } else if (gatewayConnection) {
      await drainNats(gatewayConnection).catch(() => undefined);
    }

    if (factoryConnection) {
      await drainNats(factoryConnection).catch(() => undefined);
      await Promise.allSettled(factoryWorkerLoops);
    }

    await factoryPool?.end().catch(() => undefined);
    await adminPool?.end().catch(() => undefined);

    if (natsContainer) {
      await natsContainer.stop().catch(() => undefined);
    }
    if (postgresContainer && !postgresStopped) {
      await postgresContainer.stop().catch(() => undefined);
    }
  });

  it("повторно применяет migration без дубликатов", async () => {
    expect(firstMigrationAppliedCount).toBe(expectedMigrationCount);
    expect(secondMigrationAppliedCount).toBe(0);

    const result = await adminPool?.query<{
      migration_count: string;
    }>(
      `
        SELECT count(*)::text AS migration_count
        FROM brai_factory.schema_migrations
      `,
    );

    expect(result?.rows[0]?.migration_count).toBe(
      String(expectedMigrationCount),
    );
  });

  it("изолирует runtime-роль без отзыва прежнего доступа у существующих ролей", async () => {
    const result = await adminPool?.query<{
      consumer_net_function_access: boolean;
      consumer_net_schema: boolean;
      consumer_net_table_access: boolean;
      consumer_public_schema: boolean;
      consumer_temporary: boolean;
      runtime_net_function_access: boolean;
      runtime_net_schema: boolean;
      runtime_net_table_access: boolean;
      runtime_public_schema: boolean;
      runtime_temporary: boolean;
    }>(
      `
        SELECT
          has_database_privilege(
            $1,
            current_database(),
            'TEMPORARY'
          ) AS runtime_temporary,
          has_schema_privilege(
            $1,
            'public',
            'USAGE'
          ) AS runtime_public_schema,
          has_schema_privilege(
            $1,
            'net',
            'USAGE'
          ) AS runtime_net_schema,
          (
            has_schema_privilege($1, 'net', 'USAGE')
            AND has_table_privilege(
              $1,
              'net.http_request_queue',
              'SELECT'
            )
          ) AS runtime_net_table_access,
          (
            has_schema_privilege($1, 'net', 'USAGE')
            AND has_function_privilege(
              $1,
              'net.http_get()',
              'EXECUTE'
            )
          ) AS runtime_net_function_access,
          has_database_privilege(
            $2,
            current_database(),
            'TEMPORARY'
          ) AS consumer_temporary,
          has_schema_privilege(
            $2,
            'public',
            'USAGE'
          ) AS consumer_public_schema,
          has_schema_privilege(
            $2,
            'net',
            'USAGE'
          ) AS consumer_net_schema,
          (
            has_schema_privilege($2, 'net', 'USAGE')
            AND has_table_privilege(
              $2,
              'net.http_request_queue',
              'SELECT'
            )
          ) AS consumer_net_table_access,
          (
            has_schema_privilege($2, 'net', 'USAGE')
            AND has_function_privilege(
              $2,
              'net.http_get()',
              'EXECUTE'
            )
          ) AS consumer_net_function_access
      `,
      [POSTGRES_RUNTIME_USER, POSTGRES_EXISTING_CONSUMER],
    );

    expect(result?.rows[0]).toEqual({
      consumer_net_function_access: true,
      consumer_net_schema: true,
      consumer_net_table_access: true,
      consumer_public_schema: true,
      consumer_temporary: true,
      runtime_net_function_access: false,
      runtime_net_schema: false,
      runtime_net_table_access: false,
      runtime_public_schema: false,
      runtime_temporary: false,
    });
  });

  it("возвращает 503, когда у NATS request нет responder", async () => {
    const requestId = randomUUID();
    const result = await postActivity(
      "Нет responder",
      "",
      randomUUID(),
      requestId,
    );
    const error = httpErrorSchema.parse(result.body);

    expect(result.status).toBe(503);
    expect(error).toMatchObject({
      code: "service_unavailable",
      request_id: requestId,
    });
  });

  it("запрещает service users лишние NATS subjects", async () => {
    if (!gatewayConnection || !natsContainer) {
      throw new Error("NATS test infrastructure не запущена");
    }

    const gateway = gatewayConnection;

    await expectPermissionViolation(
      gateway,
      () => {
        gateway.publish(NATS_FORBIDDEN_SUBJECT, encodeJson({ denied: true }));
      },
      "publish",
      NATS_FORBIDDEN_SUBJECT,
    );

    let deniedSubscription: ReturnType<NatsConnection["subscribe"]> | undefined;
    await expectPermissionViolation(
      gateway,
      () => {
        deniedSubscription = gateway.subscribe(ACTIVITY_CREATE_SUBJECT);
      },
      "subscription",
      ACTIVITY_CREATE_SUBJECT,
    );
    deniedSubscription?.unsubscribe();

    let deniedInboxSubscription:
      ReturnType<NatsConnection["subscribe"]> | undefined;
    await expectPermissionViolation(
      gateway,
      () => {
        deniedInboxSubscription = gateway.subscribe(NATS_FOREIGN_INBOX);
      },
      "subscription",
      NATS_FOREIGN_INBOX,
    );
    deniedInboxSubscription?.unsubscribe();

    const factoryAclConnection = await connectNats({
      connectTimeoutMs: 5_000,
      maxReconnectAttempts: 0,
      name: "brai-factory-acl-integration",
      pass: NATS_FACTORY_PASSWORD,
      servers: natsUrl(natsContainer),
      user: NATS_FACTORY_USER,
    });

    try {
      await expectPermissionViolation(
        factoryAclConnection,
        () => {
          factoryAclConnection.publish(
            ACTIVITY_CREATE_SUBJECT,
            encodeJson({ denied: true }),
          );
        },
        "publish",
        ACTIVITY_CREATE_SUBJECT,
      );

      await expectPermissionViolation(
        factoryAclConnection,
        () => {
          factoryAclConnection.publish(
            NATS_FOREIGN_INBOX,
            encodeJson({ denied: true }),
          );
        },
        "publish",
        NATS_FOREIGN_INBOX,
      );
    } finally {
      await drainNats(factoryAclConnection).catch(() => undefined);
    }
  });

  it("создаёт Activity и проводит request_id через HTTP, NATS, Factory, БД и лог", async () => {
    if (!natsContainer || !adminPool) {
      throw new Error("Integration infrastructure не запущена");
    }

    await startFactory(natsUrl(natsContainer));
    await truncateActivities();
    factoryLogOutput = "";

    const requestId = randomUUID();
    const result = await postActivity(
      "Сквозной запрос",
      "HTTP → NATS → PostgreSQL",
      randomUUID(),
      requestId,
    );
    const response = createActivityHttpResponseSchema.parse(result.body);

    expect(result.status).toBe(201);
    expect(response.request_id).toBe(requestId);

    const persisted = await adminPool.query<{
      created_request_id: string;
    }>(
      `
        SELECT created_request_id::text
        FROM brai_factory.activities
        WHERE id = $1
      `,
      [response.activity.id],
    );

    expect(persisted.rows[0]?.created_request_id).toBe(requestId);
    expect(
      parsedFactoryLogs().some((entry) => entry.request_id === requestId),
    ).toBe(true);
  });

  it("возвращает ту же Activity при replay и 409 при конфликте ключа", async () => {
    await truncateActivities();

    const idempotencyKey = randomUUID();
    const first = await postActivity(
      "Идемпотентная Activity",
      "Одинаковое содержимое",
      idempotencyKey,
    );
    const replay = await postActivity(
      "Идемпотентная Activity",
      "Одинаковое содержимое",
      idempotencyKey,
    );
    const conflict = await postActivity(
      "Другое содержимое",
      "Одинаковый ключ",
      idempotencyKey,
    );

    const created = createActivityHttpResponseSchema.parse(first.body);
    const replayed = createActivityHttpResponseSchema.parse(replay.body);
    const conflictError = httpErrorSchema.parse(conflict.body);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replayed.activity).toEqual(created.activity);
    expect(replayed.idempotent_replay).toBe(true);
    expect(conflict.status).toBe(409);
    expect(conflictError.code).toBe("idempotency_conflict");

    const count = await adminPool?.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM brai_factory.activities",
    );
    expect(count?.rows[0]?.count).toBe("1");
  });

  it("не создаёт дубль при двух одновременных POST", async () => {
    await truncateActivities();

    const idempotencyKey = randomUUID();
    const [left, right] = await Promise.all([
      postActivity(
        "Параллельная Activity",
        "Одинаковое содержимое",
        idempotencyKey,
      ),
      postActivity(
        "Параллельная Activity",
        "Одинаковое содержимое",
        idempotencyKey,
      ),
    ]);
    const responses = [
      createActivityHttpResponseSchema.parse(left.body),
      createActivityHttpResponseSchema.parse(right.body),
    ];

    expect([left.status, right.status].sort()).toEqual([200, 201]);
    expect(responses[0]?.activity).toEqual(responses[1]?.activity);

    const count = await adminPool?.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM brai_factory.activities",
    );
    expect(count?.rows[0]?.count).toBe("1");
  });

  it("сортирует от новых к старым и продолжает список по cursor", async () => {
    if (!adminPool) {
      throw new Error("Admin PostgreSQL pool не запущен");
    }

    await truncateActivities();

    const oldest = createActivityHttpResponseSchema.parse(
      (await postActivity("Старая", "", randomUUID())).body,
    );
    const middle = createActivityHttpResponseSchema.parse(
      (await postActivity("Средняя", "", randomUUID())).body,
    );
    const newest = createActivityHttpResponseSchema.parse(
      (await postActivity("Новая", "", randomUUID())).body,
    );

    await Promise.all([
      adminPool.query(
        "UPDATE brai_factory.activities SET created_at = $2 WHERE id = $1",
        [oldest.activity.id, "2026-07-16T10:00:00.000Z"],
      ),
      adminPool.query(
        "UPDATE brai_factory.activities SET created_at = $2 WHERE id = $1",
        [middle.activity.id, "2026-07-16T11:00:00.000Z"],
      ),
      adminPool.query(
        "UPDATE brai_factory.activities SET created_at = $2 WHERE id = $1",
        [newest.activity.id, "2026-07-16T12:00:00.000Z"],
      ),
    ]);

    const firstPageResult = await listActivities(2);
    const firstPage = listActivitiesHttpResponseSchema.parse(
      firstPageResult.body,
    );

    expect(firstPageResult.status).toBe(200);
    expect(firstPage.activities.map((activity) => activity.id)).toEqual([
      newest.activity.id,
      middle.activity.id,
    ]);
    expect(firstPage.next_cursor).not.toBeNull();

    const secondPageResult = await listActivities(2, firstPage.next_cursor);
    const secondPage = listActivitiesHttpResponseSchema.parse(
      secondPageResult.body,
    );

    expect(secondPageResult.status).toBe(200);
    expect(secondPage.activities.map((activity) => activity.id)).toEqual([
      oldest.activity.id,
    ]);
    expect(secondPage.next_cursor).toBeNull();
  });

  it("возвращает 503, когда PostgreSQL недоступен", async () => {
    if (!postgresContainer) {
      throw new Error("PostgreSQL container не запущен");
    }

    await adminPool?.end();
    adminPool = undefined;
    await postgresContainer.stop();
    postgresStopped = true;

    const result = await postActivity("БД выключена", "", randomUUID());
    const error = httpErrorSchema.parse(result.body);

    expect(result.status).toBe(503);
    expect(error.code).toBe("service_unavailable");
  });
});
