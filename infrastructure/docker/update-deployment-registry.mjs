import { chown, readFile, rename, stat, writeFile } from "node:fs/promises";

const startMarker = "<!-- BEGIN BRAI FACTORY FOUNDATION -->";
const endMarker = "<!-- END BRAI FACTORY FOUNDATION -->";
const registryPath =
  process.env.DEPLOYMENT_REGISTRY_PATH ?? "/home/mark/DEPLOYMENT.md";
const fragmentPath = new URL("./DEPLOYMENT.fragment.md", import.meta.url);

const [registry, fragment, metadata] = await Promise.all([
  readFile(registryPath, "utf8"),
  readFile(fragmentPath, "utf8"),
  stat(registryPath),
]);

const startIndex = registry.indexOf(startMarker);
const endIndex = registry.indexOf(endMarker);
let updated;

if (startIndex === -1 && endIndex === -1) {
  updated = `${registry.trimEnd()}\n\n${fragment.trim()}\n`;
} else if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
  const afterMarker = endIndex + endMarker.length;
  updated =
    registry.slice(0, startIndex) +
    fragment.trim() +
    registry.slice(afterMarker);
} else {
  throw new Error("DEPLOYMENT.md contains an incomplete Brai Factory marker");
}

const temporaryPath = `${registryPath}.brai-factory.tmp`;
await writeFile(temporaryPath, updated, {
  encoding: "utf8",
  mode: metadata.mode,
});
await chown(temporaryPath, metadata.uid, metadata.gid);
await rename(temporaryPath, registryPath);
console.log("deployment_registry=updated");
