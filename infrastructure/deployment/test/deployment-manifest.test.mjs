/* global process */

import { spawnSync } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseDeploymentManifest,
  renderDeploymentEnvironment,
} from "../lib/deployment-manifest.mjs";

const repository = "BrightOS/brai-new";
const revision = "a".repeat(40);
const digest = (character) => `sha256:${character.repeat(64)}`;
const imageNames = [
  "web",
  "api-gateway",
  "factory",
  "access",
  "factory-admin",
  "access-admin",
  "nats",
];

function validManifest() {
  return {
    schema_version: "brai.deployment.images.v1",
    host_contract_version: "brai.production-host.v2",
    source_repository: repository,
    source_revision: revision,
    images: Object.fromEntries(
      imageNames.map((name, index) => {
        const imageDigest = digest(String(index + 1));
        return [
          name,
          {
            digest: imageDigest,
            reference: `ghcr.io/brightos/brai-new@${imageDigest}`,
          },
        ];
      }),
    ),
  };
}

describe("immutable deployment manifest", () => {
  it("accepts the exact repository, image set and digest references", () => {
    const parsed = parseDeploymentManifest(
      JSON.stringify(validManifest()),
      repository,
    );
    expect(parsed.sourceRevision).toBe(revision);
    expect(renderDeploymentEnvironment(parsed)).toContain(
      `BRAI_WEB_IMAGE=ghcr.io/brightos/brai-new@${digest("1")}`,
    );
    expect(renderDeploymentEnvironment(parsed)).toContain(
      `BRAI_ACCESS_IMAGE=ghcr.io/brightos/brai-new@${digest("4")}`,
    );
  });

  it.each([
    [
      "tag reference",
      (value) => {
        value.images.web.reference = "ghcr.io/brightos/brai-new:latest";
      },
    ],
    [
      "wrong repository",
      (value) => {
        value.source_repository = "attacker/repository";
      },
    ],
    [
      "wrong host contract",
      (value) => {
        value.host_contract_version = "brai.production-host.v1";
      },
    ],
    [
      "missing image",
      (value) => {
        delete value.images.nats;
      },
    ],
    [
      "extra field",
      (value) => {
        value.command = "sh";
      },
    ],
    [
      "invalid revision",
      (value) => {
        value.source_revision = "main";
      },
    ],
  ])("rejects %s", (_description, mutate) => {
    const value = validManifest();
    mutate(value);
    expect(() =>
      parseDeploymentManifest(JSON.stringify(value), repository),
    ).toThrow();
  });

  it("writes a digest-only manifest with the CI manifest writer", async () => {
    const output = join(
      tmpdir(),
      `brai-production-images-${process.pid}-${Date.now()}.json`,
    );
    const writer = resolve(
      import.meta.dirname,
      "../../../tools/ci/write-image-manifest.mjs",
    );
    const environment = {
      ...process.env,
      BRAI_IMAGE_ROOT: "ghcr.io/brightos/brai-new",
      GITHUB_REPOSITORY: repository,
      GITHUB_SHA: revision,
    };
    for (const [index, name] of imageNames.entries()) {
      environment[`BRAI_${name.toUpperCase().replaceAll("-", "_")}_DIGEST`] =
        digest(String(index + 1));
    }

    const result = spawnSync(process.execPath, [writer, output], {
      encoding: "utf8",
      env: environment,
    });
    expect(result.status).toBe(0);
    const parsed = parseDeploymentManifest(
      await readFile(output, "utf8"),
      repository,
    );
    expect(parsed.images.nats).toMatch(/@sha256:7{64}$/u);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    await unlink(output);
  });
});
