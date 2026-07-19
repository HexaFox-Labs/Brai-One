import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const catalog = JSON.parse(
  await readFile(resolve(root, "infrastructure/delivery/catalog.json"), "utf8"),
);
const runtimeServices = Object.keys(catalog.runtimeServices).sort();
const images = [
  ...runtimeServices.map((service) => catalog.runtimeServices[service].image),
  ...Object.keys(catalog.adminImages),
].sort();
const builds = images.map((image) => buildFor(image));

process.stdout.write(
  `${JSON.stringify({
    deliveryClass: "runtime",
    affectedProjects: runtimeServices,
    changedRuntimeServices: runtimeServices,
    runtimeServices,
    images,
    builds,
    requiresPreview: false,
  })}\n`,
);

function buildFor(image) {
  for (const service of Object.values(catalog.runtimeServices)) {
    if (service.image === image) {
      return { image, context: ".", dockerfile: service.build.dockerfile };
    }
  }
  const admin = catalog.adminImages[image];
  if (admin) return { image, context: ".", dockerfile: admin.build.dockerfile };
  throw new Error(`Catalog has no build specification for ${image}`);
}
