import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadRuntimeHostCredentials,
  readRuntimeHostConfig,
} from "../src/runtime-host-config.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

async function credentialFixture(algorithm: "ed25519" | "ec" = "ed25519") {
  const root = await mkdtemp(`${tmpdir()}/brai-runtime-credentials-`);
  roots.push(root);
  await mkdir(root, { recursive: true });
  const keys =
    algorithm === "ed25519"
      ? generateKeyPairSync("ed25519")
      : generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  await Promise.all([
    writeFile(`${root}/nats-password`, "test-only-password\n", {
      mode: 0o600,
    }),
    writeFile(
      `${root}/launch-contract-public-key.pem`,
      keys.publicKey.export({ format: "pem", type: "spki" }),
      { mode: 0o600 },
    ),
    writeFile(
      `${root}/runtime-receipt-private-key.pem`,
      keys.privateKey.export({ format: "pem", type: "pkcs8" }),
      { mode: 0o600 },
    ),
  ]);
  return root;
}

function environment(credentialsDirectory: string): NodeJS.ProcessEnv {
  return {
    BRAI_RUNTIME_NATS_SERVERS: "nats://127.0.0.1:4222",
    BRAI_RUNTIME_NATS_USER: "brai-runtime-host",
    BRAI_RUNTIME_LAUNCH_KEY_ID: "launch-key:2026-07",
    BRAI_RUNTIME_RECEIPT_KEY_ID: "runtime-key:2026-07",
    BRAI_RUNTIME_REGISTRY_ROOT: "/var/lib/brai-agent-runtime/developer-runs",
    CREDENTIALS_DIRECTORY: credentialsDirectory,
  };
}

describe("runtime host external configuration", () => {
  it("loads only loopback NATS and separate Ed25519 public/private roles", async () => {
    const directory = await credentialFixture();
    const config = readRuntimeHostConfig(environment(directory));
    const credentials = await loadRuntimeHostCredentials(config);

    expect(config.natsServers).toEqual(["nats://127.0.0.1:4222"]);
    expect(credentials.launchPublicKey.type).toBe("public");
    expect(credentials.receiptPrivateKey.type).toBe("private");
    expect(credentials.natsPassword).toBe("test-only-password");
    expect(config).not.toHaveProperty("database");
  });

  it("rejects externally reachable NATS and non-Ed25519 keys", async () => {
    expect(() =>
      readRuntimeHostConfig({
        ...environment("/run/credentials/test"),
        BRAI_RUNTIME_NATS_SERVERS: "nats://0.0.0.0:4222",
      }),
    ).toThrow(/loopback/u);

    const directory = await credentialFixture("ec");
    await expect(
      loadRuntimeHostCredentials(readRuntimeHostConfig(environment(directory))),
    ).rejects.toThrow(/Ed25519/u);
  });
});
