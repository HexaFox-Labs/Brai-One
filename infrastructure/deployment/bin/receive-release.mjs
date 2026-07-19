#!/usr/bin/env node
/* global Buffer, process */

import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  parseDeploymentManifest,
  renderDeploymentEnvironment,
} from "../lib/deployment-manifest.mjs";

const deploymentRoot = "/srv/opt/brai-new-deploy";
const policyPath = "/etc/brai-new/deploy-policy.json";
const maximumManifestBytes = 64 * 1024;
const expectedDeployUser = "brai-new-deploy";
const expectedReceiverCommand =
  "/srv/opt/brai-new-deploy/bin/receive-release.mjs";
const principalAuditCommand =
  "/srv/opt/brai-new-deploy/bin/audit-deploy-principal";

if (process.getuid?.() !== 0) {
  throw new Error(
    "receive-release must run as root through the fixed sudo rule",
  );
}
await assertExpectedInvocation();
await runPrincipalAudit();

const [policySource, manifestSource] = await Promise.all([
  readProtectedPolicy(policyPath),
  readStandardInput(maximumManifestBytes),
]);
const policy = parsePolicy(policySource);
const manifest = parseDeploymentManifest(
  manifestSource,
  policy.expected_repository,
);

const releasesRoot = join(deploymentRoot, "releases");
const releasePath = join(releasesRoot, manifest.sourceRevision);
const canonicalManifest = `${JSON.stringify(JSON.parse(manifestSource), null, 2)}\n`;

await assertProtectedDirectory(deploymentRoot);
await mkdir(releasesRoot, { mode: 0o755, recursive: true });
await assertProtectedDirectory(releasesRoot);
const temporaryPath = await mkdtemp(
  join(releasesRoot, `.incoming-${manifest.sourceRevision}-`),
);

try {
  await chmod(temporaryPath, 0o755);
  await Promise.all([
    writeFile(join(temporaryPath, "manifest.json"), canonicalManifest, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o444,
    }),
    writeFile(
      join(temporaryPath, "images.env"),
      renderDeploymentEnvironment(manifest),
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o444,
      },
    ),
  ]);
  await rename(temporaryPath, releasePath);
} catch (error) {
  await rm(temporaryPath, { force: true, recursive: true });
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
  const existing = await readFile(join(releasePath, "manifest.json"), "utf8");
  if (existing !== canonicalManifest) {
    throw new Error(
      `Release ${manifest.sourceRevision} already exists with different content`,
    );
  }
}

await chmod(releasePath, 0o755);
await runDeployment(manifest.sourceRevision);

/**
 * @param {string} path
 * @returns {Promise<void>}
 */
async function assertProtectedDirectory(path) {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== 0 ||
    metadata.gid !== 0 ||
    (metadata.mode & 0o022) !== 0
  ) {
    throw new Error(
      `Deployment directory must be root-owned and non-writable: ${path}`,
    );
  }
}

/**
 * @param {string} path
 * @returns {Promise<string>}
 */
async function readProtectedPolicy(path) {
  const metadata = await stat(path);
  if (
    metadata.uid !== 0 ||
    (metadata.mode & 0o077) !== 0 ||
    !metadata.isFile()
  ) {
    throw new Error("Deployment policy must be a root-owned mode 0600 file");
  }
  return readFile(path, "utf8");
}

async function assertExpectedInvocation() {
  const passwdSource = await readFile("/etc/passwd", "utf8");
  const accountLines = passwdSource
    .split("\n")
    .filter((line) => line.startsWith(`${expectedDeployUser}:`));
  if (accountLines.length !== 1) {
    throw new Error("Deployment account is missing or ambiguous");
  }
  const accountLine = accountLines.at(0);
  if (typeof accountLine !== "string") {
    throw new Error("Deployment account is missing or ambiguous");
  }
  const accountFields = accountLine.split(":");
  const accountUid = accountFields.at(2);
  const accountGid = accountFields.at(3);
  if (
    accountFields.length !== 7 ||
    typeof accountUid !== "string" ||
    typeof accountGid !== "string" ||
    !/^[0-9]+$/u.test(accountUid) ||
    !/^[0-9]+$/u.test(accountGid) ||
    accountUid === "0" ||
    accountGid === "0"
  ) {
    throw new Error("Deployment account has invalid numeric identity");
  }
  if (
    process.env.SUDO_USER !== expectedDeployUser ||
    process.env.SUDO_UID !== accountUid ||
    process.env.SUDO_GID !== accountGid ||
    process.env.SUDO_COMMAND !== expectedReceiverCommand
  ) {
    throw new Error("Deployment receiver invocation identity mismatch");
  }
}

async function runPrincipalAudit() {
  const child = spawn(principalAuditCommand, ["active"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`Deployment-principal audit terminated by ${signal}`));
      } else {
        resolve(code);
      }
    });
  });
  if (status !== 0) {
    throw new Error("Deployment-principal audit failed");
  }
}

/**
 * @param {string} source
 * @returns {{ expected_repository: string }}
 */
function parsePolicy(source) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("Deployment policy is not valid JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Deployment policy has an unexpected shape");
  }
  if (
    Object.keys(value).length !== 1 ||
    !("expected_repository" in value) ||
    typeof value.expected_repository !== "string"
  ) {
    throw new Error("Deployment policy has an unexpected shape");
  }
  return { expected_repository: value.expected_repository };
}

/**
 * @param {number} maximumBytes
 * @returns {Promise<string>}
 */
async function readStandardInput(maximumBytes) {
  /** @type {Buffer[]} */
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of process.stdin) {
    byteLength += chunk.length;
    if (byteLength > maximumBytes) {
      throw new Error("Deployment manifest exceeds the input limit");
    }
    chunks.push(chunk);
  }
  if (byteLength === 0) throw new Error("Deployment manifest is empty");
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * @param {string} revision
 * @returns {Promise<void>}
 */
async function runDeployment(revision) {
  const child = spawn(
    join(deploymentRoot, "bin", "deploy-release"),
    [revision],
    { stdio: "inherit" },
  );
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`Deployment terminated by signal ${signal}`));
      } else {
        resolve(code);
      }
    });
  });
  if (status !== 0) {
    throw new Error(`Deployment failed with status ${String(status)}`);
  }
}
