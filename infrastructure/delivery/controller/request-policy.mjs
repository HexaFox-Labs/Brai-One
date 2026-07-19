import {
  deliveryContractVersion,
  expectedRepository,
  imageNames,
  runtimeServices,
} from "./constants.mjs";

const revisionPattern = /^[0-9a-f]{40}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const branchPattern =
  /^(feature|fix|release|hotfix)\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;

/**
 * Parses the only runtime-delivery input accepted from GitHub Actions.  The
 * controller owns every path, command and image reference; CI may name only
 * an already published digest belonging to this repository.
 *
 * @param {unknown} input
 * @param {{ expectedRepository?: string }} [options]
 */
export function parseDeliveryRequest(input, options = {}) {
  const repository = options.expectedRepository ?? expectedRepository;
  assertObject(input, "Delivery request");
  assertExactKeys(
    input,
    [
      "schema_version",
      "source_repository",
      "source_revision",
      "branch",
      "target",
      "priority",
      "runtime_services",
      "changed_images",
    ],
    "Delivery request",
  );
  if (input.schema_version !== deliveryContractVersion) {
    throw new Error("Delivery request schema is not supported");
  }
  if (input.source_repository !== repository) {
    throw new Error("Delivery request repository is not allowed");
  }
  if (
    typeof input.source_revision !== "string" ||
    !revisionPattern.test(input.source_revision)
  ) {
    throw new Error("Delivery request revision must be a full Git SHA");
  }
  if (typeof input.branch !== "string") {
    throw new Error("Delivery request branch is invalid");
  }
  if (input.target === "dev") {
    if (input.branch !== "dev" || input.priority !== "normal") {
      throw new Error(
        "Dev delivery must originate from dev with normal priority",
      );
    }
  } else if (input.target === "preview") {
    if (!branchPattern.test(input.branch)) {
      throw new Error("Preview delivery branch is not allowed");
    }
    if (!["normal", "release"].includes(input.priority)) {
      throw new Error("Preview delivery priority is invalid");
    }
    if (
      (input.priority === "release") !==
      input.branch.startsWith("release/")
    ) {
      throw new Error("Only release branches may use release priority");
    }
  } else {
    throw new Error("Delivery request target is not allowed");
  }
  if (
    !Array.isArray(input.runtime_services) ||
    input.runtime_services.length === 0 ||
    !input.runtime_services.every(
      (service) =>
        typeof service === "string" && runtimeServices.includes(service),
    )
  ) {
    throw new Error("Delivery request runtime services are invalid");
  }
  const services = [...new Set(input.runtime_services)].sort();
  if (services.length !== input.runtime_services.length) {
    throw new Error("Delivery request repeats a runtime service");
  }
  assertObject(input.changed_images, "Delivery request changed images");
  const changedImages = {};
  for (const [name, digest] of Object.entries(input.changed_images)) {
    if (!imageNames.includes(name) || typeof digest !== "string") {
      throw new Error("Delivery request contains an unknown image");
    }
    if (!digestPattern.test(digest)) {
      throw new Error("Delivery request image is not digest-pinned");
    }
    changedImages[name] = digest;
  }
  if (Object.keys(changedImages).length === 0) {
    throw new Error("Delivery request must change at least one image");
  }
  return Object.freeze({
    branch: input.branch,
    changedImages: Object.freeze(changedImages),
    priority: input.priority,
    revision: input.source_revision,
    runtimeServices: Object.freeze(services),
    target: input.target,
  });
}

/** @param {unknown} value */
export function parsePreviewReleaseRequest(value) {
  assertObject(value, "Preview release request");
  assertExactKeys(
    value,
    ["schema_version", "operation", "source_repository", "branch"],
    "Preview release request",
  );
  if (
    value.schema_version !== deliveryContractVersion ||
    value.operation !== "release" ||
    value.source_repository !== expectedRepository ||
    typeof value.branch !== "string" ||
    !branchPattern.test(value.branch)
  ) {
    throw new Error("Preview release request is not allowed");
  }
  return Object.freeze({ branch: value.branch });
}

/** @param {string | null} branch */
export function parsePreviewStatusBranch(branch) {
  if (typeof branch !== "string" || !branchPattern.test(branch)) {
    throw new Error("Preview status branch is not allowed");
  }
  return branch;
}

/** @param {unknown} value @param {string} name */
function assertObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

/** @param {object} value @param {readonly string[]} expected @param {string} name */
function assertExactKeys(value, expected, name) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (
    actual.length !== sorted.length ||
    actual.some((entry, index) => entry !== sorted[index])
  ) {
    throw new Error(`${name} has an unexpected shape`);
  }
}
