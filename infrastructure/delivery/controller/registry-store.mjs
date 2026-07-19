import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRegistry } from "./lease-registry.mjs";

export async function readRegistry(path) {
  try {
    return validateRegistry(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT")
      return createRegistry();
    throw error;
  }
}

export async function writeRegistry(path, registry) {
  const value = validateRegistry(registry);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = resolve(directory, `.${process.pid}.${Date.now()}.json`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function validateRegistry(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.slots) ||
    value.slots.length !== 20 ||
    !Array.isArray(value.queue)
  ) {
    throw new Error("Delivery lease registry has an unexpected shape");
  }
  return value;
}
