/* global process */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

const deploymentRoot = resolve(import.meta.dirname, "..");
const composeFile = resolve(deploymentRoot, "compose.production.yml");
const digest = `sha256:${"a".repeat(64)}`;
const imageEnvironment = {
  ...process.env,
  BRAI_API_GATEWAY_IMAGE: `ghcr.io/example/brai-new/brai-api-gateway@${digest}`,
  BRAI_ACCESS_IMAGE: `ghcr.io/example/brai-new/brai-access@${digest}`,
  BRAI_ACCESS_ADMIN_IMAGE: `ghcr.io/example/brai-new/brai-access-admin@${digest}`,
  BRAI_FACTORY_ADMIN_IMAGE: `ghcr.io/example/brai-new/brai-factory-admin@${digest}`,
  BRAI_FACTORY_IMAGE: `ghcr.io/example/brai-new/brai-factory@${digest}`,
  BRAI_NATS_IMAGE: `ghcr.io/example/brai-new/brai-nats@${digest}`,
  BRAI_RELEASE_REVISION: "a".repeat(40),
  BRAI_WEB_IMAGE: `ghcr.io/example/brai-new/brai-web@${digest}`,
};

function loadCompose() {
  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "brai-compose-"));
  const testEnvFile = resolve(temporaryDirectory, "runtime.env");
  const testComposeFile = resolve(temporaryDirectory, "compose.production.yml");

  try {
    writeFileSync(testEnvFile, "", { mode: 0o600 });
    writeFileSync(
      testComposeFile,
      readFileSync(composeFile, "utf8").replaceAll(
        /\/etc\/brai-new\/[^\s]+\.env/g,
        testEnvFile,
      ),
      { mode: 0o600 },
    );
    const result = spawnSync(
      "docker",
      [
        "compose",
        "--profile",
        "*",
        "--file",
        testComposeFile,
        "config",
        "--format",
        "json",
        "--no-env-resolution",
      ],
      {
        cwd: deploymentRoot,
        encoding: "utf8",
        env: imageEnvironment,
      },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr || "docker compose config failed");
    }
    return JSON.parse(result.stdout);
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

describe("production Compose deployment", () => {
  it("uses digest images without build contexts or source bind mounts", () => {
    const configuration = loadCompose();
    expect(Object.keys(configuration.services)).toHaveLength(7);

    for (const service of Object.values(configuration.services)) {
      expect(service.image).toMatch(/@sha256:[0-9a-f]{64}$/u);
      expect(service).not.toHaveProperty("build");
      for (const volume of service.volumes ?? []) {
        expect(volume.type).not.toBe("bind");
      }
    }
    expect(configuration.name).toBe("prod-brai");
    for (const service of Object.values(configuration.services)) {
      expect(service.container_name).toMatch(/^prod-brai-/u);
    }
  });

  it("publishes only required loopback ports", () => {
    const configuration = loadCompose();
    const published = Object.entries(configuration.services).flatMap(
      ([name, service]) =>
        (service.ports ?? []).map((port) => [
          name,
          port.host_ip,
          port.published,
        ]),
    );
    expect(published).toEqual([
      ["brai-api-gateway", "127.0.0.1", "3201"],
      ["brai-nats", "127.0.0.1", "4222"],
      ["brai-web", "127.0.0.1", "3200"],
    ]);
  });

  it("keeps every container non-privileged with a read-only root filesystem", () => {
    const configuration = loadCompose();
    for (const service of Object.values(configuration.services)) {
      expect(service.read_only).toBe(true);
      expect(service.cap_drop).toContain("ALL");
      expect(service.security_opt).toContain("no-new-privileges:true");
      expect(service.privileged ?? false).toBe(false);
    }
  });
});
