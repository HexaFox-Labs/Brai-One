import { expectedRepository, imageNames } from "./constants.mjs";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const revisionPattern = /^[0-9a-f]{40}$/u;

/**
 * Reuses every unchanged image digest. This is the storage and speed boundary:
 * an environment manifest is metadata, never a copied image or source tree.
 *
 * @param {Readonly<Record<string, string>> | undefined} baseImages
 * @param {Readonly<Record<string, string>>} changedImages
 * @param {string} revision
 * @param {{ repository?: string }} [options]
 */
export function overlayManifest(
  baseImages,
  changedImages,
  revision,
  options = {},
) {
  const repository = options.repository ?? expectedRepository;
  if (!revisionPattern.test(revision)) {
    throw new Error("Manifest revision must be a full Git SHA");
  }
  const result = { ...(baseImages ?? {}) };
  for (const [name, digest] of Object.entries(changedImages)) {
    if (!imageNames.includes(name) || !digestPattern.test(digest)) {
      throw new Error("Manifest overlay contains an invalid image digest");
    }
    result[name] = `${imageRoot(repository)}/brai-${name}@${digest}`;
  }
  const missing = imageNames.filter((name) => !(name in result));
  if (missing.length > 0) {
    throw new Error(
      `Initial environment requires all image digests; missing: ${missing.join(", ")}`,
    );
  }
  for (const [name, reference] of Object.entries(result)) {
    if (
      !imageNames.includes(name) ||
      reference !==
        `${imageRoot(repository)}/brai-${name}@${referenceDigest(reference)}`
    ) {
      throw new Error("Manifest contains an invalid immutable image reference");
    }
  }
  return Object.freeze({
    images: Object.freeze(Object.fromEntries(Object.entries(result).sort())),
    repository,
    revision,
    schemaVersion: "brai.delivery.manifest.v1",
  });
}

/** @param {string} reference */
function referenceDigest(reference) {
  const digest = reference.slice(reference.lastIndexOf("@") + 1);
  if (!digestPattern.test(digest)) {
    throw new Error("Manifest image reference is not digest-pinned");
  }
  return digest;
}

/** @param {string} repository */
function imageRoot(repository) {
  return `ghcr.io/${repository.toLowerCase()}`;
}
