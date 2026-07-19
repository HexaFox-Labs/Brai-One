import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const options = parseArguments(process.argv.slice(2));
const impact = parseImpact(await readFile(resolve(options.impact), "utf8"));
const repository = requiredEnvironment("GITHUB_REPOSITORY");
const revision = requiredEnvironment("BRAI_DELIVERY_REVISION");
if (!/^[0-9a-f]{40}$/u.test(revision)) {
  throw new Error("BRAI_DELIVERY_REVISION must be a full Git SHA");
}
assertTargetBranch(options.target, options.branch);

const files = new Set(await readdir(resolve(options.digestDirectory)));
const changedImages = {};
for (const image of impact.images) {
  const fileName = `${image}.digest`;
  if (!files.has(fileName)) {
    throw new Error(`Missing published digest for ${image}`);
  }
  const digest = (
    await readFile(resolve(options.digestDirectory, fileName), "utf8")
  ).trim();
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) {
    throw new Error(`Published digest for ${image} is not a sha256 digest`);
  }
  changedImages[image] = digest;
}

process.stdout.write(
  `${JSON.stringify(
    {
      schema_version: "brai.delivery.request.v1",
      source_repository: repository,
      source_revision: revision,
      branch: options.branch,
      target: options.target,
      priority: options.branch.startsWith("release/") ? "release" : "normal",
      runtime_services: impact.runtimeServices,
      changed_images: changedImages,
    },
    null,
    2,
  )}\n`,
);

function parseArguments(argumentsList) {
  const values = new Map(
    argumentsList.map((argument) => {
      const [key, value] = argument.split("=", 2);
      return [key, value];
    }),
  );
  const impactPath = values.get("--impact");
  const digestDirectory = values.get("--digest-dir");
  const target = values.get("--target");
  const branch = values.get("--branch");
  if (!impactPath || !digestDirectory || !target || !branch) {
    throw new Error(
      "Usage: node tools/ci/write-delivery-request.mjs --impact=<impact.json> --digest-dir=<directory> --target=<dev|preview> --branch=<branch>",
    );
  }
  return { impact: impactPath, digestDirectory, target, branch };
}

function parseImpact(source) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("Delivery impact is not valid JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Delivery impact has an unexpected shape");
  }
  const impact = /** @type {Record<string, unknown>} */ (value);
  if (
    !Array.isArray(impact.images) ||
    !impact.images.every((image) => /^[a-z-]+$/u.test(image)) ||
    !Array.isArray(impact.runtimeServices) ||
    !impact.runtimeServices.every((service) =>
      /^@brai\/[a-z-]+$/u.test(service),
    )
  ) {
    throw new Error("Delivery impact has an unexpected shape");
  }
  return /** @type {{ images: string[]; runtimeServices: string[] }} */ (
    impact
  );
}

function assertTargetBranch(target, branch) {
  if (target === "dev" && branch === "dev") return;
  if (
    target === "preview" &&
    /^(feature|fix|release|hotfix)\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(
      branch,
    )
  ) {
    return;
  }
  throw new Error("Delivery target is not allowed for this branch");
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}
