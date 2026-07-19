import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

import {
  ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION,
  ACCESS_AGENT_RUN_CREATE_SUBJECT,
  ACCESS_DEVELOPER_MODE_SET_REQUEST_SCHEMA_VERSION,
  ACCESS_DEVELOPER_MODE_SET_SUBJECT,
  accessAgentRunCreateResponseSchema,
  accessDeveloperModeSetResponseSchema,
  uuidV4Schema,
} from "@brai/contracts";
import { connectNats, drainNats, requestJson } from "@brai/nats";

const NATS_ENV = "/etc/brai-new/nats.env";

function requirePair(
  userId: string | undefined,
  projectId: string | undefined,
): Readonly<{ userId: string; projectId: string }> {
  return {
    userId: uuidV4Schema.parse(userId),
    projectId: uuidV4Schema.parse(projectId),
  };
}

function parseEnvironment(source: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error("Invalid NATS environment file");
    }
    const key = line.slice(0, separator);
    if (values.has(key)) {
      throw new Error(`Duplicate NATS environment key: ${key}`);
    }
    values.set(key, line.slice(separator + 1));
  }
  return values;
}

function required(
  environment: ReadonlyMap<string, string>,
  key: string,
): string {
  const value = environment.get(key);
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${key}`);
  }
  return value;
}

async function main(): Promise<void> {
  if ((process.geteuid?.() ?? -1) !== 0 || process.argv.length !== 7) {
    throw new Error(
      "Run as root: access-runtime-e2e USER_A PROJECT_A USER_B PROJECT_B PLATFORM_ADMIN",
    );
  }
  const first = requirePair(process.argv[2], process.argv[3]);
  const second = requirePair(process.argv[4], process.argv[5]);
  const platformAdminId = uuidV4Schema.parse(process.argv[6]);
  if (first.userId === second.userId) {
    throw new Error("Acceptance users must differ");
  }

  const metadata = await lstat(NATS_ENV);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== 0 ||
    metadata.gid !== 0 ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new Error("Untrusted NATS environment file");
  }
  const environment = parseEnvironment(await readFile(NATS_ENV, "utf8"));
  const connection = await connectNats({
    servers: ["nats://127.0.0.1:4222"],
    user: required(environment, "NATS_GATEWAY_USER"),
    pass: required(environment, "NATS_GATEWAY_PASSWORD"),
    name: "brai-access-runtime-acceptance",
    inboxPrefix: "_INBOX.brai.gateway.acceptance",
  });

  try {
    const launch = async (
      pair: Readonly<{ userId: string; projectId: string }>,
      prompt: string,
    ) => {
      const requestId = randomUUID();
      const raw = await requestJson<unknown, unknown>(
        connection,
        ACCESS_AGENT_RUN_CREATE_SUBJECT,
        {
          schema_version: ACCESS_AGENT_RUN_CREATE_REQUEST_SCHEMA_VERSION,
          request_id: requestId,
          sent_at: new Date().toISOString(),
          payload: {
            authenticated_user_id: pair.userId,
            project_id: pair.projectId,
            prompt,
          },
        },
        { timeoutMs: 120_000 },
      );
      const response = accessAgentRunCreateResponseSchema.parse(raw);
      if (response.request_id !== requestId || !response.payload.ok) {
        throw new Error("Access runtime acceptance launch was rejected");
      }
      return {
        user_id: pair.userId,
        project_id: pair.projectId,
        run_id: response.payload.run_id,
      };
    };
    const setDeveloperMode = async (developerMode: boolean) => {
      const requestId = randomUUID();
      const raw = await requestJson<unknown, unknown>(
        connection,
        ACCESS_DEVELOPER_MODE_SET_SUBJECT,
        {
          schema_version: ACCESS_DEVELOPER_MODE_SET_REQUEST_SCHEMA_VERSION,
          request_id: requestId,
          sent_at: new Date().toISOString(),
          payload: {
            platform_admin_user_id: platformAdminId,
            target_user_id: first.userId,
            developer_mode: developerMode,
          },
        },
        { timeoutMs: 120_000 },
      );
      const response = accessDeveloperModeSetResponseSchema.parse(raw);
      if (response.request_id !== requestId || !response.payload.ok) {
        throw new Error("Developer mode transition was rejected");
      }
      return {
        developer_mode: developerMode,
        changed: response.payload.changed,
        access_generation: response.payload.access_generation,
        terminated_runs: response.payload.runs_to_terminate.length,
      };
    };

    await setDeveloperMode(false);
    const normalLaunches = [];
    for (const pair of [first, second]) {
      normalLaunches.push(
        await launch(
          pair,
          "Brai normal runtime permission acceptance: print OK and exit.",
        ),
      );
    }
    const developerEnabled = await setDeveloperMode(true);
    const developerLaunch = await launch(
      first,
      "Brai developer runtime permission acceptance: print OK and wait.",
    );
    const developerDisabled = await setDeveloperMode(false);
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        normal_launches: normalLaunches,
        developer_enabled: developerEnabled,
        developer_launch: developerLaunch,
        developer_disabled: developerDisabled,
      })}\n`,
    );
  } finally {
    await drainNats(connection);
  }
}

await main();
