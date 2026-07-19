import {
  cp,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(readOption("--source") ?? "dist/adr");
const target = resolve(
  readOption("--target") ??
    process.env.BRAI_ADR_TARGET ??
    "/srv/projects/brai-envs/prod/adr-brai-new",
);
const releaseId =
  readOption("--release") ??
  process.env.BRAI_RELEASE_REVISION ??
  new Date().toISOString().replace(/[^0-9]/gu, "");

const sourceMetadata = await lstat(source);
if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()) {
  throw new Error(`ADR build output must be a real directory: ${source}`);
}
const sourceEntries = await readdir(source);
if (!sourceEntries.includes("index.html")) {
  throw new Error(`ADR build output has no index.html: ${source}`);
}

const releases = resolve(target, "releases");
await mkdir(target, { recursive: true, mode: 0o755 });
await chmod(target, 0o755);
await mkdir(releases, { recursive: true, mode: 0o755 });
await chmod(releases, 0o755);
const staging = await mkdtemp(resolve(target, `.incoming-${releaseId}-`));
const release = resolve(releases, releaseId);
const current = resolve(target, "current");
let promoted = false;
let releaseStaged = false;

try {
  if (await exists(release)) {
    throw new Error(`ADR static release already exists: ${release}`);
  }
  for (const entry of sourceEntries) {
    await cp(resolve(source, entry), resolve(staging, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
  await normalizeStaticTree(staging);
  if (await exists(current)) {
    await normalizeStaticTree(current);
  }
  await rename(staging, release);
  releaseStaged = true;
  await renameIfPresent(current, resolve(releases, `previous-${releaseId}`));
  await rename(release, current);
  promoted = true;
} finally {
  if (!promoted) {
    await rm(staging, { force: true, recursive: true });
    if (releaseStaged) {
      await rm(release, { force: true, recursive: true });
    }
  }
}

console.log(`ADR static release promoted: ${current}`);

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function renameIfPresent(from, to) {
  try {
    await rename(from, to);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function normalizeStaticTree(directory) {
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await normalizeStaticTree(path);
    } else if (entry.isFile()) {
      await chmod(path, 0o644);
    }
  }
}
