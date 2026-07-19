import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(new URL("../..", import.meta.url).pathname);
const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const catalogPath = resolve(
  workspaceRoot,
  "infrastructure/delivery/catalog.json",
);

/**
 * Resolves the smallest safe delivery class for a changed revision.
 * Unknown paths intentionally become control changes instead of bypassing CI.
 *
 * @param {readonly string[]} paths
 * @param {DeliveryCatalog} catalog
 */
export function classifyPaths(paths, catalog) {
  if (paths.length === 0) return "none";
  if (paths.every((path) => matchesAny(path, catalog.documentationPaths))) {
    return "documentation";
  }
  if (paths.some((path) => matchesAny(path, catalog.controlPaths))) {
    return "control";
  }
  return "runtime";
}

/**
 * @param {readonly string[]} affectedProjects
 * @param {DeliveryCatalog} catalog
 */
export function resolveRuntimeServices(affectedProjects, catalog) {
  const services = new Set();
  const changedServices = resolveChangedRuntimeServices(
    affectedProjects,
    catalog,
  );

  for (const project of changedServices) {
    addServiceClosure(project, catalog, services);
  }

  return [...services].sort();
}

/**
 * Returns image owners whose source changed. Runtime dependencies are started
 * from the base manifest but must not be rebuilt merely because they are part
 * of a preview's dependency closure.
 *
 * @param {readonly string[]} affectedProjects
 * @param {DeliveryCatalog} catalog
 */
export function resolveChangedRuntimeServices(affectedProjects, catalog) {
  if (
    affectedProjects.some((project) =>
      catalog.sharedRuntimeProjects.includes(project),
    )
  ) {
    return Object.keys(catalog.runtimeServices).sort();
  }
  return affectedProjects
    .filter((project) => project in catalog.runtimeServices)
    .sort();
}

/**
 * @param {{ paths: readonly string[]; affectedProjects: readonly string[] }} input
 * @param {DeliveryCatalog} catalog
 */
export function resolveImpact(input, catalog) {
  const deliveryClass = classifyPaths(input.paths, catalog);
  const changedRuntimeServices =
    deliveryClass === "runtime"
      ? resolveChangedRuntimeServices(input.affectedProjects, catalog)
      : [];
  const runtimeServices =
    deliveryClass === "runtime"
      ? resolveRuntimeServices(input.affectedProjects, catalog)
      : [];

  const adminImages = Object.entries(catalog.adminImages)
    .filter(([, admin]) => changedRuntimeServices.includes(admin.migrationFor))
    .map(([name]) => name);
  const images = [
    ...new Set([
      ...changedRuntimeServices.map(
        (service) => catalog.runtimeServices[service].image,
      ),
      ...adminImages,
    ]),
  ].sort();

  return {
    deliveryClass,
    affectedProjects: [...input.affectedProjects].sort(),
    changedRuntimeServices,
    runtimeServices,
    images,
    builds: images.map((image) => resolveImageBuild(image, catalog)),
    requiresPreview: deliveryClass === "runtime" && runtimeServices.length > 0,
  };
}

function resolveImageBuild(image, catalog) {
  for (const service of Object.values(catalog.runtimeServices)) {
    if (service.image === image) {
      return { image, context: ".", dockerfile: service.build.dockerfile };
    }
  }
  const admin = catalog.adminImages[image];
  if (admin) {
    return { image, context: ".", dockerfile: admin.build.dockerfile };
  }
  throw new Error(`Delivery catalog has no build specification for ${image}`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const catalog = /** @type {DeliveryCatalog} */ (
    JSON.parse(await readFile(catalogPath, "utf8"))
  );
  const isInitialRevision = /^0{40}$/u.test(options.base);
  const paths = gitLines([
    "diff",
    "--name-only",
    "--no-renames",
    isInitialRevision ? emptyTree : options.base,
    options.head,
  ]);
  const affectedProjects =
    paths.length === 0
      ? []
      : isInitialRevision
        ? nxProjects([])
        : nxProjects([
            "--affected",
            `--base=${options.base}`,
            `--head=${options.head}`,
          ]);
  process.stdout.write(
    `${JSON.stringify(resolveImpact({ paths, affectedProjects }, catalog))}\n`,
  );
}

function nxProjects(argumentsList) {
  return JSON.parse(
    execFileSync(
      "pnpm",
      ["exec", "nx", "show", "projects", ...argumentsList, "--json"],
      { cwd: workspaceRoot, encoding: "utf8" },
    ),
  );
}

function parseArguments(argumentsList) {
  const values = new Map(
    argumentsList.map((value) => {
      const [key, entry] = value.split("=", 2);
      return [key, entry];
    }),
  );
  const base = values.get("--base");
  const head = values.get("--head");
  if (!base || !head) {
    throw new Error(
      "Usage: node tools/ci/delivery-impact.mjs --base=<sha> --head=<sha>",
    );
  }
  return { base, head };
}

function gitLines(argumentsList) {
  const output = execFileSync("git", argumentsList, {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  return output.split("\n").filter(Boolean);
}

function addServiceClosure(project, catalog, services) {
  if (services.has(project) || !(project in catalog.runtimeServices)) return;
  services.add(project);
  for (const dependency of catalog.runtimeServices[project]
    .runtimeDependencies) {
    addServiceClosure(dependency, catalog, services);
  }
}

function matchesAny(path, prefixes) {
  return prefixes.some((prefix) =>
    prefix.startsWith("*.")
      ? path.endsWith(prefix.slice(1))
      : path === prefix || path.startsWith(prefix),
  );
}

/**
 * @typedef {{
 *   documentationPaths: string[];
 *   controlPaths: string[];
 *   sharedRuntimeProjects: string[];
 *   runtimeServices: Record<string, { image: string; root: string; build: { dockerfile: string }; runtimeDependencies: string[]; e2e: string }>;
 *   adminImages: Record<string, { root: string; migrationFor: string; build: { dockerfile: string } }>;
 * }} DeliveryCatalog
 */

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
