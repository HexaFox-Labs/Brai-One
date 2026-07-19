import {
  copyFile,
  lstat,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

if (process.getuid?.() !== 0) {
  throw new Error("ADR Caddy cutover must run as root");
}

const caddyfile = process.env.BRAI_CADDYFILE ?? "/etc/caddy/Caddyfile";
const newRoot =
  process.env.BRAI_ADR_ROOT ??
  "/srv/projects/brai-envs/prod/adr-brai-new/current";
const legacyRoot = "/srv/projects/brai-envs/prod/adr";
const caddyfilePath = resolve(caddyfile);
const newIndex = resolve(newRoot, "index.html");
const caddySource = await readFile(caddyfilePath, "utf8");
const newRootStat = await lstat(newIndex);
if (!newRootStat.isFile()) {
  throw new Error(`New ADR publication has no readable index: ${newIndex}`);
}

if (caddySource.includes(`root * ${newRoot}`)) {
  console.log("Caddy ADR route already points to Brai New");
  process.exit(0);
}

const legacyNeedle = `root * ${legacyRoot}`;
const occurrences = caddySource.split(legacyNeedle).length - 1;
if (occurrences !== 1) {
  throw new Error(
    `Expected exactly one legacy ADR root in Caddyfile, found ${occurrences}`,
  );
}
const legacyRootIndex = caddySource.indexOf(legacyNeedle);
const adrBlockStart = caddySource.lastIndexOf(
  "\nadr.brai.one {",
  legacyRootIndex,
);
const adrBlockEnd = caddySource.indexOf("\n}", legacyRootIndex);
if (adrBlockStart < 0 || adrBlockEnd < 0) {
  throw new Error("Unable to locate the HTTPS adr.brai.one Caddy block");
}
const adrBlock = caddySource.slice(adrBlockStart, adrBlockEnd);
if (
  !adrBlock.includes("brai_unified_basic_auth") ||
  !adrBlock.includes("file_server")
) {
  throw new Error(
    "Caddy ADR block does not have the expected auth/file-server policy",
  );
}

const timestamp = new Date().toISOString().replace(/[^0-9]/gu, "");
const backup = `${caddyfilePath}.bak-brai-new-adr-${timestamp}`;
const temporary = `${caddyfilePath}.tmp-brai-new-adr-${process.pid}`;
const nextSource = caddySource.replace(legacyNeedle, `root * ${newRoot}`);
const originalMode = (await lstat(caddyfilePath)).mode & 0o777;

await copyFile(caddyfilePath, backup);
try {
  await writeFile(temporary, nextSource, { mode: originalMode });
  await rename(temporary, caddyfilePath);
  await runDocker([
    "exec",
    "caddy",
    "caddy",
    "validate",
    "--config",
    "/etc/caddy/Caddyfile",
    "--adapter",
    "caddyfile",
  ]);
  await runDocker([
    "exec",
    "caddy",
    "caddy",
    "reload",
    "--config",
    "/etc/caddy/Caddyfile",
    "--adapter",
    "caddyfile",
  ]);
} catch (error) {
  await copyFile(backup, caddyfilePath);
  await runDocker([
    "exec",
    "caddy",
    "caddy",
    "reload",
    "--config",
    "/etc/caddy/Caddyfile",
    "--adapter",
    "caddyfile",
  ]).catch(() => {});
  throw error;
} finally {
  await rm(temporary, { force: true });
}

console.log(`Caddy ADR route now serves Brai New root: ${newRoot}`);
console.log(`Caddy configuration backup: ${backup}`);

function runDocker(args) {
  return new Promise((resolveStatus, reject) => {
    const child = spawn("docker", args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`docker command terminated by ${signal}`));
      else if (code !== 0)
        reject(new Error(`docker command failed with ${code}`));
      else resolveStatus();
    });
  });
}
