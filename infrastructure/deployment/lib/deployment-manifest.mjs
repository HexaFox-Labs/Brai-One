const DEPLOYMENT_SCHEMA_VERSION = "brai.deployment.images.v1";
const HOST_CONTRACT_VERSION = "brai.production-host.v3";
const IMAGE_NAMES = [
  "web",
  "api-gateway",
  "factory",
  "access",
  "factory-admin",
  "access-admin",
  "nats",
];

const repositoryPattern =
  /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/u;
const revisionPattern = /^[0-9a-f]{40}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

/**
 * @typedef {{
 *   images: Readonly<Record<string, string>>;
 *   sourceRepository: string;
 *   sourceRevision: string;
 * }} DeploymentManifest
 */

/**
 * @param {string} source
 * @param {string} expectedRepository
 * @returns {DeploymentManifest}
 */
export function parseDeploymentManifest(source, expectedRepository) {
  if (!repositoryPattern.test(expectedRepository)) {
    throw new Error("Deployment policy has an invalid expected repository");
  }

  /** @type {unknown} */
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch {
    throw new Error("Deployment manifest is not valid JSON");
  }

  assertExactKeys(
    manifest,
    [
      "schema_version",
      "host_contract_version",
      "source_repository",
      "source_revision",
      "images",
    ],
    "manifest",
  );

  if (manifest.schema_version !== DEPLOYMENT_SCHEMA_VERSION) {
    throw new Error("Deployment manifest schema is not supported");
  }
  if (manifest.host_contract_version !== HOST_CONTRACT_VERSION) {
    throw new Error("Deployment host tooling contract is not supported");
  }
  if (
    typeof manifest.source_repository !== "string" ||
    manifest.source_repository !== expectedRepository
  ) {
    throw new Error("Deployment manifest repository is not allowed");
  }
  if (
    typeof manifest.source_revision !== "string" ||
    !revisionPattern.test(manifest.source_revision)
  ) {
    throw new Error("Deployment manifest revision must be a full Git SHA");
  }

  assertExactKeys(manifest.images, IMAGE_NAMES, "manifest images");

  const imageRoot = `ghcr.io/${expectedRepository.toLowerCase()}`;
  /** @type {Record<string, string>} */
  const images = {};
  for (const name of IMAGE_NAMES) {
    const entry = manifest.images[name];
    assertExactKeys(entry, ["digest", "reference"], `image ${name}`);

    if (typeof entry.digest !== "string" || !digestPattern.test(entry.digest)) {
      throw new Error(`Image ${name} does not have a sha256 digest`);
    }
    const expectedReference = `${imageRoot}@${entry.digest}`;
    if (entry.reference !== expectedReference) {
      throw new Error(
        `Image ${name} reference is not the expected GHCR digest`,
      );
    }
    images[name] = expectedReference;
  }

  return Object.freeze({
    images: Object.freeze(images),
    sourceRepository: manifest.source_repository,
    sourceRevision: manifest.source_revision,
  });
}

/**
 * @param {DeploymentManifest} manifest
 * @returns {string}
 */
export function renderDeploymentEnvironment(manifest) {
  return [
    `BRAI_RELEASE_REVISION=${manifest.sourceRevision}`,
    `BRAI_WEB_IMAGE=${manifest.images.web}`,
    `BRAI_API_GATEWAY_IMAGE=${manifest.images["api-gateway"]}`,
    `BRAI_FACTORY_IMAGE=${manifest.images.factory}`,
    `BRAI_ACCESS_IMAGE=${manifest.images.access}`,
    `BRAI_FACTORY_ADMIN_IMAGE=${manifest.images["factory-admin"]}`,
    `BRAI_ACCESS_ADMIN_IMAGE=${manifest.images["access-admin"]}`,
    `BRAI_NATS_IMAGE=${manifest.images.nats}`,
    "",
  ].join("\n");
}

/**
 * @param {unknown} value
 * @param {readonly string[]} expectedKeys
 * @param {string} description
 * @returns {asserts value is Record<string, unknown>}
 */
function assertExactKeys(value, expectedKeys, description) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object`);
  }
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actualKeys.length !== expected.length ||
    actualKeys.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${description} has an unexpected shape`);
  }
}

export const deploymentManifestConstants = Object.freeze({
  digestPattern,
  imageNames: Object.freeze([...IMAGE_NAMES]),
  repositoryPattern,
  revisionPattern,
  schemaVersion: DEPLOYMENT_SCHEMA_VERSION,
  hostContractVersion: HOST_CONTRACT_VERSION,
});
