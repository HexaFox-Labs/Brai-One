import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseDeploymentManifest } from "../../infrastructure/deployment/lib/deployment-manifest.mjs";

const outputPath = process.argv[2];
if (outputPath === undefined) {
  throw new Error(
    "Usage: node tools/ci/write-image-manifest.mjs <output.json> [--base=<manifest.json>]",
  );
}

const imageRoot = requiredEnvironment("BRAI_IMAGE_ROOT");
const sourceRepository = requiredEnvironment("GITHUB_REPOSITORY");
const sourceRevision = requiredEnvironment("GITHUB_SHA");
if (!/^[0-9a-f]{40}$/u.test(sourceRevision)) {
  throw new Error("GITHUB_SHA must be a full Git commit SHA");
}

const imageNames = [
  "web",
  "api-gateway",
  "factory",
  "access",
  "factory-admin",
  "access-admin",
  "nats",
];

const baseArgument = process.argv
  .slice(3)
  .find((argument) => argument.startsWith("--base="));
const affectedImages = new Set(
  (process.env.BRAI_AFFECTED_IMAGES ?? imageNames.join(","))
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);
for (const image of affectedImages) {
  if (!imageNames.includes(image)) {
    throw new Error(`BRAI_AFFECTED_IMAGES contains unknown image ${image}`);
  }
}

const baseManifest = baseArgument
  ? parseDeploymentManifest(
      await readFile(resolve(baseArgument.slice("--base=".length)), "utf8"),
      sourceRepository,
    )
  : undefined;
if (!baseManifest && affectedImages.size !== imageNames.length) {
  throw new Error(
    "A base manifest is required when reusing an unchanged image",
  );
}

const images = Object.fromEntries(
  imageNames.map((name) => {
    if (!affectedImages.has(name)) {
      const reference = baseManifest.images[name];
      const digest = reference.slice(reference.lastIndexOf("@") + 1);
      return [name, { digest, reference }];
    }
    const digestVariable = `BRAI_${name.toUpperCase().replaceAll("-", "_")}_DIGEST`;
    const digest = requiredEnvironment(digestVariable);
    if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) {
      throw new Error(`${digestVariable} must be a sha256 image digest`);
    }
    return [
      name,
      {
        digest,
        reference: `${imageRoot}@${digest}`,
      },
    ];
  }),
);

await writeFile(
  resolve(outputPath),
  `${JSON.stringify(
    {
      schema_version: "brai.deployment.images.v1",
      host_contract_version: "brai.production-host.v2",
      source_repository: sourceRepository,
      source_revision: sourceRevision,
      images,
    },
    null,
    2,
  )}\n`,
  { encoding: "utf8", mode: 0o600 },
);

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}
