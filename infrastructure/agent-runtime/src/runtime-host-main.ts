import { connectNats, drainNats } from "@brai/nats";

import { createHostGatedDeveloperRuntimeController } from "./developer-runtime-gate.js";
import {
  loadRuntimeHostCredentials,
  readRuntimeHostConfig,
} from "./runtime-host-config.js";
import { FilesystemDeveloperRunRegistry } from "./runtime-host-registry.js";
import { NatsRuntimeReceiptSubmitter } from "./runtime-host-receipts.js";
import {
  DeveloperRuntimeHostService,
  type RuntimeHostLogger,
} from "./runtime-host-service.js";
import { startRuntimeHostWorker } from "./runtime-host-worker.js";
import { RuntimeHostRouterService } from "./runtime-host-router.js";
import {
  createSandboxProvisioningExecutor,
  SandboxProvisioningHostService,
} from "./sandbox-provisioning-service.js";
import { runSandboxProvisioningWorker } from "./sandbox-provisioning-worker.js";
import { createHostProvisioningDependencies } from "./trusted-provisioning-host.js";
import { createHostUserSandboxRuntimeController } from "./user-sandbox-runtime.js";
import { FilesystemUserSandboxRunRegistry } from "./user-sandbox-runtime-registry.js";
import { UserSandboxRuntimeHostService } from "./user-sandbox-runtime-service.js";

const logger: RuntimeHostLogger = {
  info: (bindings, message) => {
    process.stdout.write(
      `${JSON.stringify({ level: "info", ...bindings, message })}\n`,
    );
  },
  warn: (bindings, message) => {
    process.stderr.write(
      `${JSON.stringify({ level: "warn", ...bindings, message })}\n`,
    );
  },
  error: (bindings, message) => {
    const safe = { ...bindings };
    for (const key of ["err", "error"] as const) {
      if (key in safe) {
        const error = safe[key];
        safe[key] =
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                ...("code" in error && typeof error.code === "string"
                  ? { code: error.code }
                  : {}),
                ...(error.cause instanceof Error
                  ? {
                      cause: {
                        name: error.cause.name,
                        message: error.cause.message,
                        ...("code" in error.cause &&
                        typeof error.cause.code === "string"
                          ? { code: error.cause.code }
                          : {}),
                      },
                    }
                  : {}),
              }
            : "unknown";
      }
    }
    process.stderr.write(
      `${JSON.stringify({ level: "error", ...safe, message })}\n`,
    );
  },
};

const config = readRuntimeHostConfig();
const credentials = await loadRuntimeHostCredentials(config);
const connection = await connectNats({
  servers: [...config.natsServers],
  user: config.natsUser,
  pass: credentials.natsPassword,
  name: "brai-runtime-host",
  inboxPrefix: "_INBOX.brai.runtime",
});
const developerService = new DeveloperRuntimeHostService({
  controller: createHostGatedDeveloperRuntimeController(),
  registry: new FilesystemDeveloperRunRegistry(config.registryRoot),
  receiptSubmitter: new NatsRuntimeReceiptSubmitter(connection),
  launchKeyId: config.launchKeyId,
  launchPublicKey: credentials.launchPublicKey,
  receiptKeyId: config.receiptKeyId,
  receiptPrivateKey: credentials.receiptPrivateKey,
  logger,
});
const receiptSubmitter = new NatsRuntimeReceiptSubmitter(connection);
const userSandboxService = new UserSandboxRuntimeHostService({
  controller: createHostUserSandboxRuntimeController(),
  registry: new FilesystemUserSandboxRunRegistry(),
  receiptSubmitter,
  launchKeyId: config.launchKeyId,
  launchPublicKey: credentials.launchPublicKey,
  receiptKeyId: config.receiptKeyId,
  receiptPrivateKey: credentials.receiptPrivateKey,
  logger,
});
const runtimeRouter = new RuntimeHostRouterService(
  developerService,
  userSandboxService,
);
const sandboxProvisioningService = new SandboxProvisioningHostService({
  executor: createSandboxProvisioningExecutor(
    createHostProvisioningDependencies(),
  ),
  launchKeyId: config.launchKeyId,
  launchPublicKey: credentials.launchPublicKey,
  receiptKeyId: config.receiptKeyId,
  receiptPrivateKey: credentials.receiptPrivateKey,
  logger,
});

const runtimeWorkers = await startRuntimeHostWorker(
  connection,
  runtimeRouter,
  logger,
);
const workers = Object.freeze([
  ...runtimeWorkers,
  runSandboxProvisioningWorker(connection, sandboxProvisioningService, logger),
]);

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info({ signal }, "Trusted runtime host завершает NATS intake");
  await drainNats(connection);
}

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

await Promise.all(workers);
