import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "../..");
const defaultTarget = "/srv/projects/brai-envs/prod/adr-brai-new";
const defaultOpenspec =
  "/srv/opt/node-v22.22.3/lib/node_modules/@fission-ai/openspec/bin/openspec.js";
const manifestInputs = [
  ".log4brains.yml",
  "package.json",
  "pnpm-lock.yaml",
  "docs/decisions",
  "tools/docs/adr-check.mjs",
  "tools/docs/adr-date.mjs",
  "tools/docs/apply-adr-theme.mjs",
  "tools/docs/docs-check.mjs",
  "tools/docs/normalize-adr-dates.mjs",
  "tools/docs/publish-adr.mjs",
  "infrastructure/adr/publish-static.mjs",
  "infrastructure/adr/theme.css",
];

export async function createSourceManifest(root, inputs = manifestInputs) {
  const entries = [];
  for (const input of inputs) {
    const path = resolve(root, input);
    const files = await collectFiles(path);
    for (const file of files) {
      const source = await readFile(file);
      entries.push({
        path: relative(root, file).replaceAll("\\", "/"),
        sha256: hash(source),
      });
    }
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return hash(JSON.stringify(entries));
}

export function publicationIsRequired({
  currentIndex,
  force,
  manifest,
  state,
}) {
  return force || !currentIndex || state?.manifest !== manifest;
}

export function releaseIdFor(manifest, date = new Date()) {
  return `autopublish-${date.toISOString().replace(/[^0-9]/gu, "")}-${manifest.slice(0, 12)}`;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const root = resolve(options.project ?? projectRoot);
  const target = resolve(
    options.target ?? process.env.BRAI_ADR_TARGET ?? defaultTarget,
  );
  const statePath = resolve(
    options.state ?? resolve(target, ".autopublish-state.json"),
  );
  const sourceDirectory = resolve(root, "docs/decisions");

  assertInside(root, sourceDirectory, "ADR source");
  await assertDirectory(root, "project root");
  await assertDirectory(sourceDirectory, "ADR source");
  await assertDirectory(target, "ADR release root");

  const manifest = await createSourceManifest(root);
  const currentIndex = await isRegularFile(
    resolve(target, "current", "index.html"),
  );
  const previousState = await readJson(statePath);
  if (
    !publicationIsRequired({
      currentIndex,
      force: options.force,
      manifest,
      state: previousState,
    })
  ) {
    console.log("ADR auto-publication is current; source manifest unchanged.");
    return;
  }

  await run(
    process.execPath,
    [resolve(root, "tools/docs/adr-check.mjs")],
    root,
  );
  await run(
    process.execPath,
    [resolve(root, "tools/docs/docs-check.mjs")],
    root,
  );
  await run(
    process.execPath,
    [
      process.env.BRAI_ADR_OPENSPEC_BIN ?? defaultOpenspec,
      "validate",
      "--all",
      "--strict",
    ],
    root,
  );

  const release = options.release ?? releaseIdFor(manifest);
  await run(
    process.execPath,
    [
      resolve(root, "tools/docs/publish-adr.mjs"),
      "--target",
      target,
      "--release",
      release,
    ],
    root,
  );

  if (!(await isRegularFile(resolve(target, "current", "index.html")))) {
    throw new Error("ADR publisher completed without an active index.html");
  }
  await writeJsonAtomically(statePath, {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    manifest,
    release,
  });
  console.log(`ADR auto-publication promoted release ${release}.`);
}

function parseOptions(args) {
  const options = {
    force: false,
    project: null,
    release: null,
    state: null,
    target: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--force") options.force = true;
    else if (
      ["--project", "--release", "--state", "--target"].includes(option)
    ) {
      const value = args[++index];
      if (!value || value.startsWith("--"))
        throw new Error(`${option} requires a value`);
      options[option.slice(2)] = value;
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }
  return options;
}

async function collectFiles(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink())
    throw new Error(`Manifest input must not be a symlink: ${path}`);
  if (metadata.isFile()) return [path];
  if (!metadata.isDirectory())
    throw new Error(`Manifest input must be a file or directory: ${path}`);

  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(child)));
    else if (entry.isFile()) files.push(child);
    else if (entry.isSymbolicLink())
      throw new Error(`Manifest input must not contain a symlink: ${child}`);
  }
  return files;
}

async function assertDirectory(path, label) {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${path}`);
  }
}

function assertInside(root, path, label) {
  const value = relative(root, path);
  if (value === "" || (!value.startsWith("..") && !isAbsolute(value))) return;
  throw new Error(`${label} must be inside the project root`);
}

async function isRegularFile(path) {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonAtomically(path, value) {
  const directory = resolve(path, "..");
  await mkdir(directory, { recursive: true, mode: 0o755 });
  const temporary = resolve(directory, `.${Date.now()}-${process.pid}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o644,
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function run(command, args, cwd) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`${command} failed with ${code}`));
      else resolveResult();
    });
  });
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  main().catch((error) => {
    console.error(`ADR auto-publication failed: ${error.message}`);
    process.exitCode = 1;
  });
}
