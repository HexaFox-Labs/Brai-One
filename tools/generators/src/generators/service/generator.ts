import {
  addProjectConfiguration,
  formatFiles,
  names,
  type Tree,
} from "@nx/devkit";

import type { ServiceGeneratorSchema } from "./schema.js";

export default async function serviceGenerator(
  tree: Tree,
  rawOptions: ServiceGeneratorSchema,
): Promise<void> {
  const kind = rawOptions.kind ?? "service";
  const database = rawOptions.database ?? false;
  const normalized = names(rawOptions.name.replace(/^brai-/, "")).fileName;
  if (!/^[a-z][a-z0-9-]*$/.test(normalized)) {
    throw new Error("Service name must normalize to lowercase kebab-case.");
  }

  const databaseSchema = `brai_${normalized.replaceAll("-", "_")}`;
  const databaseRole = `${databaseSchema}_runtime`;
  if (database && databaseRole.length > 63) {
    throw new Error(
      "Database-enabled service name is too long for PostgreSQL identifiers.",
    );
  }

  const directoryName = `brai-${normalized}`;
  const root = `${kind === "worker" ? "workers" : "services"}/${directoryName}`;
  const projectName = `${kind}-${directoryName}`;
  const packageName = `@brai/${normalized}`;
  const containerName = `brai-${normalized}`;

  if (tree.exists(root)) throw new Error(`${root} already exists.`);

  addProjectConfiguration(tree, projectName, {
    root,
    sourceRoot: `${root}/src`,
    projectType: "application",
    tags: [`type:${kind}`, database ? "database:enabled" : "database:none"],
    targets: {},
  });

  tree.write(
    `${root}/package.json`,
    `${JSON.stringify(packageManifest(packageName, projectName, database), null, 2)}\n`,
  );
  tree.write(`${root}/tsconfig.json`, tsconfig());
  tree.write(`${root}/tsconfig.build.json`, buildTsconfig());
  tree.write(`${root}/.env.example`, envExample(database));
  tree.write(`${root}/src/identity.ts`, identitySource(containerName));
  tree.write(`${root}/src/index.ts`, runtimeSource(containerName, database));
  tree.write(`${root}/src/healthcheck.ts`, healthcheckSource(database));
  tree.write(`${root}/src/identity.test.ts`, identityTestSource(containerName));
  tree.write(`${root}/Dockerfile`, dockerfile(root, packageName));
  tree.write(
    `${root}/compose.fragment.yml`,
    composeFragment(containerName, root, database),
  );
  tree.write(`${root}/README.md`, readme(containerName, kind, database));

  if (database) {
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const migrationName = normalized.replaceAll("-", "_");
    tree.write(
      `infrastructure/supabase/migrations/${stamp}_${migrationName}_schema.sql`,
      databaseMigrationStub(normalized),
    );
  }

  await formatFiles(tree);
}

function packageManifest(
  packageName: string,
  projectName: string,
  database = false,
) {
  return {
    name: packageName,
    version: "0.0.0",
    private: true,
    type: "module",
    engines: { node: ">=22.22.3 <23" },
    scripts: {
      start: "node dist/index.js",
      build: "tsc -p tsconfig.build.json",
      lint: "eslint src --max-warnings=0",
      test: "vitest run",
      typecheck: "tsc -p tsconfig.json --noEmit",
    },
    dependencies: {
      "@brai/nats": "workspace:*",
      "@brai/runtime": "workspace:*",
      ...(database ? { pg: "8.16.3" } : {}),
      zod: "4.4.3",
    },
    devDependencies: {
      "@types/node": "catalog:",
      ...(database ? { "@types/pg": "8.15.5" } : {}),
      eslint: "catalog:",
      typescript: "catalog:",
      vitest: "catalog:",
    },
    nx: { name: projectName, targets: {} },
  };
}

function tsconfig(): string {
  return `${JSON.stringify(
    {
      extends: "../../tsconfig.base.json",
      compilerOptions: {
        rootDir: "src",
        outDir: "dist",
        types: ["node"],
      },
      include: ["src/**/*.ts"],
    },
    null,
    2,
  )}\n`;
}

function buildTsconfig(): string {
  return `${JSON.stringify(
    {
      extends: "./tsconfig.json",
      exclude: ["src/**/*.test.ts"],
    },
    null,
    2,
  )}\n`;
}

function envExample(database: boolean): string {
  return [
    "NATS_SERVERS=nats://brai-nats:4222",
    "NATS_USER=",
    "NATS_PASSWORD=",
    database ? "DATABASE_URL=" : null,
    database ? "DATABASE_SSL=disable" : null,
    database ? "DATABASE_POOL_MAX=10" : null,
    database ? "DATABASE_CONNECTION_TIMEOUT_MS=3000" : null,
    database ? "DATABASE_QUERY_TIMEOUT_MS=4000" : null,
    database ? "DATABASE_LOCK_TIMEOUT_MS=2000" : null,
    database ? "DATABASE_IDLE_TRANSACTION_TIMEOUT_MS=5000" : null,
    "LOG_LEVEL=info",
    "",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function identitySource(containerName: string): string {
  return `export const SERVICE_IDENTITY = ${JSON.stringify(containerName)};\n`;
}

function runtimeSource(containerName: string, database: boolean): string {
  return `import { connectNats, drainNats } from "@brai/nats";
import {
  createLogger,
  installGracefulShutdown,
  requireEnv,
} from "@brai/runtime";
import { z } from "zod";
${database ? 'import pg from "pg";\n' : ""}

import { SERVICE_IDENTITY } from "./identity.js";

const environmentSchema = z.object({
  NATS_SERVERS: z.string().min(1),
  NATS_USER: z.string().min(1),
  NATS_PASSWORD: z.string().min(1),
  ${database ? 'DATABASE_URL: z.string().min(1),\n  DATABASE_SSL: z.enum(["disable", "require", "verify-full"]).default("disable"),\n  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(10).default(10),\n  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(3000),\n  DATABASE_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).max(4000).default(4000),\n  DATABASE_LOCK_TIMEOUT_MS: z.coerce.number().int().min(100).max(2000).default(2000),\n  DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(5000).default(5000),\n  ' : ""}LOG_LEVEL: z.string().min(1).default("info"),
});

const environment = requireEnv(environmentSchema);
const logger = createLogger({
  name: SERVICE_IDENTITY,
  level: environment.LOG_LEVEL,
});
const connection = await connectNats({
  servers: environment.NATS_SERVERS.split(",").map((value) => value.trim()),
  user: environment.NATS_USER,
  pass: environment.NATS_PASSWORD,
  name: SERVICE_IDENTITY,
});

${
  database
    ? `const database = new pg.Pool({
  application_name: SERVICE_IDENTITY,
  connectionString: environment.DATABASE_URL,
  connectionTimeoutMillis: environment.DATABASE_CONNECTION_TIMEOUT_MS,
  idle_in_transaction_session_timeout: environment.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
  lock_timeout: environment.DATABASE_LOCK_TIMEOUT_MS,
  max: environment.DATABASE_POOL_MAX,
  query_timeout: environment.DATABASE_QUERY_TIMEOUT_MS,
  statement_timeout: environment.DATABASE_QUERY_TIMEOUT_MS,
  ssl: environment.DATABASE_SSL === "disable"
    ? false
    : { rejectUnauthorized: environment.DATABASE_SSL === "verify-full" },
});
database.on("error", (error) => {
  logger.error({ err: error }, "database_idle_connection_error");
});
await database.query("SELECT 1");
`
    : ""
}installGracefulShutdown({
  logger,
  shutdown: async () => {
    ${database ? "await Promise.all([drainNats(connection), database.end()]);" : "await drainNats(connection);"}
  },
});

// Register versioned NATS handlers here. Direct service-to-service HTTP is forbidden.
logger.info({ service: SERVICE_IDENTITY }, "service_ready");
`;
}

function healthcheckSource(database: boolean): string {
  return `import { connectNats } from "@brai/nats";
import { requireEnv } from "@brai/runtime";
import { z } from "zod";
${database ? 'import pg from "pg";\n' : ""}

const environmentSchema = z.object({
  NATS_SERVERS: z.string().min(1),
  NATS_USER: z.string().min(1),
  NATS_PASSWORD: z.string().min(1),
  ${database ? 'DATABASE_URL: z.string().min(1),\n  DATABASE_SSL: z.enum(["disable", "require", "verify-full"]).default("disable"),\n  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(3000),\n  DATABASE_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).max(4000).default(4000),\n  DATABASE_LOCK_TIMEOUT_MS: z.coerce.number().int().min(100).max(2000).default(2000),\n  DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(5000).default(5000),\n  ' : ""}
});
const environment = requireEnv(environmentSchema);

const connection = await connectNats({
  servers: environment.NATS_SERVERS.split(",").map((value) => value.trim()),
  user: environment.NATS_USER,
  pass: environment.NATS_PASSWORD,
  name: "healthcheck",
  connectTimeoutMs: 2000,
  maxReconnectAttempts: 0,
});

${
  database
    ? `const pool = new pg.Pool({
  connectionString: environment.DATABASE_URL,
  connectionTimeoutMillis: environment.DATABASE_CONNECTION_TIMEOUT_MS,
  idle_in_transaction_session_timeout: environment.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
  lock_timeout: environment.DATABASE_LOCK_TIMEOUT_MS,
  max: 1,
  query_timeout: environment.DATABASE_QUERY_TIMEOUT_MS,
  statement_timeout: environment.DATABASE_QUERY_TIMEOUT_MS,
  ssl: environment.DATABASE_SSL === "disable"
    ? false
    : { rejectUnauthorized: environment.DATABASE_SSL === "verify-full" },
});
await pool.query("SELECT 1");
await pool.end();
`
    : ""
}await connection.drain();
`;
}

function identityTestSource(containerName: string): string {
  return `import { describe, expect, it } from "vitest";

import { SERVICE_IDENTITY } from "./identity.js";

describe("service identity", () => {
  it("uses the required container prefix", () => {
    expect(SERVICE_IDENTITY).toBe(${JSON.stringify(containerName)});
    expect(SERVICE_IDENTITY.startsWith("brai-")).toBe(true);
  });
});
`;
}

function dockerfile(root: string, packageName: string): string {
  return `FROM node:22.22.3-alpine3.23@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.13.1 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml nx.json tsconfig.base.json ./
COPY packages ./packages
COPY ${root} ./${root}
RUN pnpm install --frozen-lockfile --filter ${packageName}...
RUN pnpm --filter @brai/runtime build \\
  && pnpm --filter @brai/nats build \\
  && pnpm --filter ${packageName} build \\
  && pnpm --filter ${packageName} deploy --prod --legacy /opt/runtime

FROM node:22.22.3-alpine3.23@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /opt/runtime ./
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD ["node", "dist/healthcheck.js"]
CMD ["node", "dist/index.js"]
`;
}

function composeFragment(
  containerName: string,
  root: string,
  database: boolean,
): string {
  return `# Review this fragment before merging it into production compose.yml.
services:
  ${containerName}:
    image: ${containerName}:0.0.1
    container_name: ${containerName}
    build:
      context: .
      dockerfile: ${root}/Dockerfile
    env_file:
      - path: \${BRAI_CONFIG_DIR:-/etc/brai-new}/${containerName}.env
        required: false
    restart: unless-stopped
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=32m
    networks:
      - brai-bus${database ? "\n      - brai-supabase" : ""}
    healthcheck:
      test: ["CMD", "node", "dist/healthcheck.js"]
`;
}

function readme(
  containerName: string,
  kind: "service" | "worker",
  database: boolean,
): string {
  return `# ${containerName}

Generated Brai ${kind}.

- Communication: NATS only.
- Database: ${database ? "enabled; use only the generated private Supabase schema and runtime role" : "disabled"}.
- Public ports: none.

Add versioned subjects and strict contracts before registering this runtime in production Compose.
Review \`compose.fragment.yml\`; the generator never edits production Compose automatically.
${database ? "The generated migration creates a NOLOGIN runtime role with a 10-connection limit and server-enforced timeouts. Add tables and explicit per-table grants to that migration, then provision the role password through protected deployment tooling; never run migrations from service startup.\n" : ""}
`;
}

function databaseMigrationStub(name: string): string {
  const schema = `brai_${name.replaceAll("-", "_")}`;
  const role = `${schema}_runtime`;
  return `-- Generated private schema and bounded runtime-role policy.
-- Apply with the protected migration runner; never from service startup.
CREATE SCHEMA IF NOT EXISTS ${schema};

REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;

DO $role$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = '${role}'
  ) THEN
    CREATE ROLE ${role}
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION
      NOBYPASSRLS
      CONNECTION LIMIT 10;
  END IF;
END
$role$;

DO $role_safety$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = '${role}'
      AND (
        rolcanlogin
        OR rolsuper
        OR rolcreatedb
        OR rolcreaterole
        OR rolinherit
        OR rolreplication
        OR rolbypassrls
        OR rolconnlimit <> 10
      )
  ) THEN
    RAISE EXCEPTION '${role} has unsafe role attributes';
  END IF;
END
$role_safety$;

DO $memberships$
DECLARE
  granted_role name;
BEGIN
  FOR granted_role IN
    SELECT parent.rolname
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS parent
      ON parent.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS member
      ON member.oid = membership.member
    WHERE member.rolname = '${role}'
  LOOP
    EXECUTE format('REVOKE %I FROM ${role}', granted_role);
  END LOOP;
END
$memberships$;

ALTER ROLE ${role}
  SET search_path TO ${schema}, pg_catalog;
ALTER ROLE ${role}
  SET statement_timeout TO '4s';
ALTER ROLE ${role}
  SET lock_timeout TO '2s';
ALTER ROLE ${role}
  SET idle_in_transaction_session_timeout TO '5s';

REVOKE ALL ON SCHEMA ${schema} FROM ${role};
REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM PUBLIC, ${role};
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM PUBLIC, ${role};
REVOKE ALL ON ALL ROUTINES IN SCHEMA ${schema} FROM PUBLIC, ${role};

DO $grant_connect$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO ${role}',
    current_database()
  );
END
$grant_connect$;

GRANT USAGE ON SCHEMA ${schema} TO ${role};

-- Define tables above, then grant only the operations the runtime needs.
-- Example: GRANT SELECT, INSERT ON TABLE ${schema}.items TO ${role};

ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  REVOKE ALL ON ROUTINES FROM PUBLIC;
`;
}
