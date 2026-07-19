import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

import { z } from "zod";

export const RUNTIME_HOST_DEFAULT_REGISTRY =
  "/var/lib/brai-agent-runtime/developer-runs";

const environmentSchema = z
  .object({
    BRAI_RUNTIME_NATS_SERVERS: z
      .string()
      .min(1)
      .refine(
        (value) =>
          value
            .split(",")
            .every((server) =>
              /^nats:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}$/u.test(
                server.trim(),
              ),
            ),
        "Runtime NATS must use loopback-only servers",
      ),
    BRAI_RUNTIME_NATS_USER: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_.:@/-]+$/u),
    BRAI_RUNTIME_LAUNCH_KEY_ID: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
    BRAI_RUNTIME_RECEIPT_KEY_ID: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u),
    BRAI_RUNTIME_REGISTRY_ROOT: z
      .string()
      .startsWith("/")
      .default(RUNTIME_HOST_DEFAULT_REGISTRY),
    CREDENTIALS_DIRECTORY: z.string().startsWith("/"),
  })
  .passthrough();

export interface RuntimeHostConfig {
  readonly natsServers: readonly string[];
  readonly natsUser: string;
  readonly launchKeyId: string;
  readonly receiptKeyId: string;
  readonly registryRoot: string;
  readonly credentialsDirectory: string;
}

export interface RuntimeHostCredentials {
  readonly natsPassword: string;
  readonly launchPublicKey: KeyObject;
  readonly receiptPrivateKey: KeyObject;
}

export function readRuntimeHostConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeHostConfig {
  const parsed = environmentSchema.parse(environment);
  return Object.freeze({
    natsServers: Object.freeze(
      parsed.BRAI_RUNTIME_NATS_SERVERS.split(",").map((value) => value.trim()),
    ),
    natsUser: parsed.BRAI_RUNTIME_NATS_USER,
    launchKeyId: parsed.BRAI_RUNTIME_LAUNCH_KEY_ID,
    receiptKeyId: parsed.BRAI_RUNTIME_RECEIPT_KEY_ID,
    registryRoot: parsed.BRAI_RUNTIME_REGISTRY_ROOT,
    credentialsDirectory: parsed.CREDENTIALS_DIRECTORY,
  });
}

async function readCredential(
  directory: string,
  name: string,
): Promise<string> {
  const path = `${directory}/${name}`;
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Runtime credential ${name} is not a regular file.`);
  }
  const value = (await readFile(path, "utf8")).trim();
  if (value === "") {
    throw new Error(`Runtime credential ${name} is empty.`);
  }
  return value;
}

export async function loadRuntimeHostCredentials(
  config: RuntimeHostConfig,
): Promise<RuntimeHostCredentials> {
  const [natsPassword, launchPem, receiptPem] = await Promise.all([
    readCredential(config.credentialsDirectory, "nats-password"),
    readCredential(
      config.credentialsDirectory,
      "launch-contract-public-key.pem",
    ),
    readCredential(
      config.credentialsDirectory,
      "runtime-receipt-private-key.pem",
    ),
  ]);
  const launchPublicKey = createPublicKey(launchPem);
  const receiptPrivateKey = createPrivateKey(receiptPem);
  if (
    launchPublicKey.type !== "public" ||
    launchPublicKey.asymmetricKeyType !== "ed25519" ||
    receiptPrivateKey.type !== "private" ||
    receiptPrivateKey.asymmetricKeyType !== "ed25519"
  ) {
    throw new Error("Runtime host credentials must be Ed25519 keys.");
  }
  return Object.freeze({
    natsPassword,
    launchPublicKey,
    receiptPrivateKey,
  });
}
