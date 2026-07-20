import { readFile, writeFile } from "node:fs/promises";

import { overlayManifest } from "../../infrastructure/delivery/controller/image-manifest.mjs";

const [sourcePath, outputPath, revision] = process.argv.slice(2);
if (!sourcePath || !outputPath || !revision) {
  throw new Error(
    "Usage: carry-forward-delivery-manifest <source.json> <output.json> <revision>",
  );
}

const source = JSON.parse(await readFile(sourcePath, "utf8"));
if (
  source === null ||
  typeof source !== "object" ||
  Array.isArray(source) ||
  source.schemaVersion !== "brai.delivery.manifest.v1" ||
  source.repository !== "HexaFox-Labs/Brai-One" ||
  !/^[0-9a-f]{40}$/u.test(source.revision) ||
  source.images === null ||
  typeof source.images !== "object" ||
  Array.isArray(source.images)
) {
  throw new Error("Source delivery manifest has an unexpected shape");
}

const manifest = overlayManifest(source.images, {}, revision);
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o600,
});
