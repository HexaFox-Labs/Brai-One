import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  access,
  lstat,
  open,
  opendir,
  readFile,
  realpath,
  stat,
  statfs,
  type FileHandle,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { collectHostIdPoolFacts } from "./host-id-pool.js";
import type {
  AccountFacts,
  BindPathFacts,
  CheckoutAuditFacts,
  DeveloperPreflightFacts,
  GuestRuntimeFacts,
  MountFacts,
  SandboxImageFacts,
  StorageBackingFileFacts,
  UserSandboxPreflightFacts,
  XfsProjectQuotaFacts,
} from "./model.js";
import {
  CANONICAL_SANDBOX_BACKING_PATH,
  CANONICAL_STORAGE_CEILING_PATH,
} from "./storage-layout.js";

interface MountInfoEntry extends MountFacts {
  readonly root: string;
}

function decodeMountInfo(value: string): string {
  return value.replaceAll(/\\(040|011|012|134)/g, (_, code: string) => {
    const replacements: Readonly<Record<string, string>> = {
      "040": " ",
      "011": "\t",
      "012": "\n",
      "134": "\\",
    };
    return replacements[code] ?? code;
  });
}

export function parseMountInfo(content: string): readonly MountInfoEntry[] {
  const mounts: MountInfoEntry[] = [];
  for (const line of content.split("\n")) {
    if (line.trim() === "") continue;
    const separator = line.indexOf(" - ");
    if (separator === -1) continue;
    const left = line.slice(0, separator).split(" ");
    const right = line.slice(separator + 3).split(" ");
    const device = left[2];
    const mountRoot = left[3];
    const mountPoint = left[4];
    const mountOptions = left[5];
    const fsType = right[0];
    const source = right[1];
    const superOptions = right[2];
    if (
      device === undefined ||
      mountRoot === undefined ||
      mountPoint === undefined ||
      mountOptions === undefined ||
      fsType === undefined ||
      source === undefined
    ) {
      continue;
    }
    const options = new Set([
      ...mountOptions.split(","),
      ...(superOptions?.split(",") ?? []),
    ]);
    mounts.push({
      mountPoint: decodeMountInfo(mountPoint),
      root: decodeMountInfo(mountRoot),
      device,
      source: decodeMountInfo(source),
      fsType,
      options: [...options],
    });
  }
  return mounts;
}

function mountForPath(
  mounts: readonly MountInfoEntry[],
  targetPath: string,
): MountInfoEntry | null {
  const absoluteTarget = resolve(targetPath);
  let best: MountInfoEntry | null = null;
  for (const mount of mounts) {
    const mountPoint = resolve(mount.mountPoint);
    const belongs =
      absoluteTarget === mountPoint ||
      absoluteTarget.startsWith(`${mountPoint === "/" ? "" : mountPoint}/`);
    if (
      belongs &&
      (best === null || mountPoint.length > best.mountPoint.length)
    ) {
      best = mount;
    }
  }
  return best;
}

function parsePasswd(content: string): readonly AccountFacts[] {
  const accounts: AccountFacts[] = [];
  for (const line of content.split("\n")) {
    const fields = line.split(":");
    const username = fields[0];
    const uid = Number(fields[2]);
    const gid = Number(fields[3]);
    if (
      username !== undefined &&
      username !== "" &&
      Number.isSafeInteger(uid) &&
      Number.isSafeInteger(gid)
    ) {
      accounts.push({ username, uid, gid });
    }
  }
  return accounts;
}

async function readAccounts(): Promise<readonly AccountFacts[]> {
  return parsePasswd(await readFile("/etc/passwd", "utf8"));
}

function parseGroupGids(content: string): readonly number[] {
  return [
    ...new Set(
      content
        .split("\n")
        .map((line) => Number(line.split(":")[2]))
        .filter(Number.isSafeInteger),
    ),
  ].sort((left, right) => left - right);
}

async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const GENERATED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".git",
  ".next",
  ".nx",
  ".pnpm-store",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "playwright-report",
  "test-results",
]);

const READ_ONLY_MANAGED_DIRECTORY_NAMES = new Set([".agents", ".codex"]);

type CheckoutEntryPolicy = "source" | "generated" | "managed-readonly";

function auditMetadata(
  violations: string[],
  path: string,
  ownerUid: number,
  ownerGid: number,
  metadata: Stats,
  policy: CheckoutEntryPolicy,
  policyRoot: boolean,
): void {
  if (metadata.uid !== ownerUid || metadata.gid !== ownerGid) {
    violations.push(`foreign_owner:${path}:${metadata.uid}:${metadata.gid}`);
  }
  if (metadata.isSymbolicLink()) return;
  const mode = metadata.mode & 0o7777;
  const forbiddenWriteBits = policy === "source" ? 0o022 : 0o002;
  if ((mode & forbiddenWriteBits) !== 0) {
    violations.push(`non_owner_writable:${path}`);
  }
  if ((mode & 0o6000) !== 0) {
    violations.push(`setid_bit:${path}`);
  }
  const requiredOwnerMode =
    policy === "managed-readonly"
      ? metadata.isDirectory()
        ? 0o500
        : 0o400
      : metadata.isDirectory()
        ? 0o700
        : 0o600;
  if ((mode & requiredOwnerMode) !== requiredOwnerMode) {
    violations.push(
      `${policyRoot ? `${policy}_root` : policy}_owner_access:${path}`,
    );
  }
  if (
    !metadata.isDirectory() &&
    !metadata.isFile() &&
    !metadata.isSymbolicLink()
  ) {
    violations.push(`special_source_entry:${path}`);
  }
}

async function walkCheckout(
  root: string,
  directory: string,
  ownerUid: number,
  ownerGid: number,
  violations: string[],
  parentPolicy: CheckoutEntryPolicy,
): Promise<void> {
  const entries = await opendir(directory);
  for await (const entry of entries) {
    const path = join(directory, entry.name);
    const displayPath = relative(root, path);
    const metadata = await lstat(path);
    const generatedRoot =
      parentPolicy === "source" &&
      entry.isDirectory() &&
      GENERATED_DIRECTORY_NAMES.has(entry.name);
    const managedRoot =
      parentPolicy === "source" &&
      entry.isDirectory() &&
      READ_ONLY_MANAGED_DIRECTORY_NAMES.has(entry.name);
    const policy: CheckoutEntryPolicy = managedRoot
      ? "managed-readonly"
      : generatedRoot
        ? "generated"
        : parentPolicy;
    auditMetadata(
      violations,
      displayPath,
      ownerUid,
      ownerGid,
      metadata,
      policy,
      generatedRoot || managedRoot,
    );
    try {
      const effectiveMetadata = metadata.isSymbolicLink()
        ? await stat(path)
        : metadata;
      const requiredAccess = effectiveMetadata.isDirectory()
        ? policy === "managed-readonly"
          ? constants.R_OK | constants.X_OK
          : constants.R_OK | constants.W_OK | constants.X_OK
        : policy === "managed-readonly"
          ? constants.R_OK
          : constants.R_OK | constants.W_OK;
      await access(path, requiredAccess);
    } catch {
      violations.push(`effective_access:${displayPath}`);
    }
    if (metadata.isSymbolicLink()) {
      try {
        const target = await realpath(path);
        if (!pathIsInside(target, root)) {
          violations.push(`symlink_escape:${displayPath}`);
        } else if (
          [...READ_ONLY_MANAGED_DIRECTORY_NAMES].some((name) =>
            pathIsInside(target, join(root, name)),
          )
        ) {
          violations.push(`symlink_to_managed_readonly:${displayPath}`);
        }
      } catch {
        violations.push(`dangling_symlink:${displayPath}`);
      }
    }
    if (entry.isDirectory()) {
      await walkCheckout(root, path, ownerUid, ownerGid, violations, policy);
    }
  }
}

export async function auditCheckoutTree(
  checkoutPath: string,
  ownerUid: number,
  ownerGid: number,
): Promise<CheckoutAuditFacts> {
  const root = resolve(checkoutPath);
  const violations: string[] = [];
  try {
    const rootMetadata = await lstat(root);
    auditMetadata(
      violations,
      ".",
      ownerUid,
      ownerGid,
      rootMetadata,
      "source",
      false,
    );
    if ((rootMetadata.mode & 0o777) !== 0o700) {
      violations.push("checkout_root_not_private:.");
    }
    await access(root, constants.R_OK | constants.W_OK | constants.X_OK);
    await walkCheckout(root, root, ownerUid, ownerGid, violations, "source");
    return { completed: true, violations: violations.sort() };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      completed: false,
      violations: [...violations, `audit_error:${message}`].sort(),
    };
  }
}

function resolveInitgroups(username: string): readonly number[] {
  const result = spawnSync("/usr/bin/id", ["-G", username], {
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  return result.stdout
    .trim()
    .split(/\s+/u)
    .map(Number)
    .filter(Number.isSafeInteger)
    .sort((left, right) => left - right);
}

function inspectSudoPolicy(): DeveloperPreflightFacts["sudoPolicy"] {
  const result = spawnSync("/usr/bin/sudo", ["-n", "-l"], {
    encoding: "utf8",
    timeout: 5_000,
    env: { ...process.env, LC_ALL: "C" },
  });
  const nonInteractiveListAvailable = result.status === 0;
  const nonInteractiveAll =
    nonInteractiveListAvailable &&
    /\(\s*ALL(?:\s*:\s*ALL)?\s*\)\s+NOPASSWD:\s+ALL(?:\s|$)/mu.test(
      result.stdout,
    );
  return { nonInteractiveListAvailable, nonInteractiveAll };
}

export async function collectDeveloperFacts(
  checkoutPath: string,
): Promise<DeveloperPreflightFacts> {
  const accounts = await readAccounts();
  const uid = process.getuid?.() ?? -1;
  const gid = process.getgid?.() ?? -1;
  const currentAccount =
    accounts.find((account) => account.uid === uid) ?? null;
  const markAccount =
    accounts.find((account) => account.username === "mark") ?? null;
  const checkout = await stat(checkoutPath);
  const checkoutAudit =
    markAccount === null
      ? { completed: false, violations: ["mark_account_missing"] }
      : await auditCheckoutTree(checkoutPath, markAccount.uid, markAccount.gid);

  return {
    currentIdentity: {
      username: currentAccount?.username ?? null,
      uid,
      gid,
    },
    markAccount,
    checkout: {
      path: resolve(checkoutPath),
      ownerUid: checkout.uid,
      ownerGid: checkout.gid,
      writable: await isWritable(checkoutPath),
    },
    checkoutAudit,
    currentSupplementaryGids: [
      ...new Set([gid, ...(process.getgroups?.() ?? [])]),
    ].sort((left, right) => left - right),
    markInitgroupsGids: resolveInitgroups("mark"),
    umask: process.umask() & 0o777,
    sudoPolicy: inspectSudoPolicy(),
  };
}

async function executableExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function systemdUnitActive(unit: string): boolean {
  const result = spawnSync(
    "/usr/bin/systemctl",
    ["is-active", "--quiet", unit],
    {
      encoding: "utf8",
      timeout: 5_000,
      env: { ...process.env, LC_ALL: "C" },
    },
  );
  return result.status === 0;
}

export const TRUSTED_SANDBOX_IMAGE_ROOT = "/srv/opt/brai-agent-runtime/images";

async function sha256(file: FileHandle): Promise<string> {
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  for (;;) {
    const { bytesRead } = await file.read(
      buffer,
      0,
      buffer.byteLength,
      position,
    );
    if (bytesRead === 0) break;
    digest.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return digest.digest("hex");
}

function pathIsInside(candidate: string, parent: string): boolean {
  const childPath = resolve(candidate);
  const parentPath = resolve(parent);
  const relativePath = relative(parentPath, childPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

export interface TrustedImageParentChainOptions {
  /** Test seam only; production callers must use the fixed default. */
  readonly trustedRoot?: string;
  /** Test seam only; production callers must require root. */
  readonly ownerUid?: number;
  /** Test seam only; production callers must require root. */
  readonly ownerGid?: number;
}

export async function trustedImageParentChain(
  imagePath: string,
  options: TrustedImageParentChainOptions = {},
): Promise<boolean> {
  const trustedRoot = resolve(
    options.trustedRoot ?? TRUSTED_SANDBOX_IMAGE_ROOT,
  );
  const ownerUid = options.ownerUid ?? 0;
  const ownerGid = options.ownerGid ?? 0;
  if (imagePath === trustedRoot || !pathIsInside(imagePath, trustedRoot)) {
    return false;
  }

  let directory = dirname(imagePath);
  for (;;) {
    let metadata: Stats;
    try {
      metadata = await lstat(directory);
    } catch {
      return false;
    }
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      metadata.uid !== ownerUid ||
      metadata.gid !== ownerGid ||
      (metadata.mode & 0o022) !== 0
    ) {
      return false;
    }
    if (directory === "/") return true;
    const parent = dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

interface TrustedDigestSidecar {
  readonly trusted: boolean;
  readonly expectedDigest: string | null;
}

async function readTrustedDigestSidecar(
  sidecarPath: string,
): Promise<TrustedDigestSidecar> {
  let pathMetadata: Stats;
  try {
    pathMetadata = await lstat(sidecarPath);
  } catch {
    return { trusted: false, expectedDigest: null };
  }
  if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile()) {
    return { trusted: false, expectedDigest: null };
  }

  let sidecar: FileHandle | null = null;
  try {
    sidecar = await open(
      sidecarPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const metadata = await sidecar.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== 0 ||
      metadata.gid !== 0 ||
      (metadata.mode & 0o022) !== 0 ||
      metadata.size > 4_096
    ) {
      return { trusted: false, expectedDigest: null };
    }
    const content = await sidecar.readFile({ encoding: "utf8" });
    const expectedDigest = content.trim().split(/\s+/, 1)[0]?.toLowerCase();
    return {
      trusted:
        expectedDigest !== undefined && /^[a-f0-9]{64}$/u.test(expectedDigest),
      expectedDigest: expectedDigest ?? null,
    };
  } catch {
    return { trusted: false, expectedDigest: null };
  } finally {
    await sidecar?.close();
  }
}

async function collectImageFacts(
  imagePath: string,
  storagePath: string,
): Promise<SandboxImageFacts> {
  const absoluteImagePath = resolve(imagePath);
  const parentChainTrusted = await trustedImageParentChain(absoluteImagePath);
  const base = {
    path: absoluteImagePath,
    parentChainTrusted,
    insideUserStorage: pathIsInside(absoluteImagePath, storagePath),
  };
  let imageStat;
  try {
    imageStat = await lstat(absoluteImagePath);
  } catch {
    return {
      ...base,
      exists: false,
      regularFile: false,
      symbolicLink: false,
      ownerUid: null,
      ownerGid: null,
      mode: null,
      openedWithNoFollow: false,
      sidecarTrusted: false,
      sha256: null,
      digestVerified: false,
    };
  }

  const symbolicLink = imageStat.isSymbolicLink();
  if (symbolicLink) {
    return {
      ...base,
      exists: true,
      regularFile: false,
      symbolicLink: true,
      ownerUid: imageStat.uid,
      ownerGid: imageStat.gid,
      mode: imageStat.mode & 0o777,
      openedWithNoFollow: false,
      sidecarTrusted: false,
      sha256: null,
      digestVerified: false,
    };
  }

  let actualDigest: string | null = null;
  let digestVerified = false;
  let openedWithNoFollow = false;
  let sidecarTrusted = false;
  let openedMetadata = imageStat;
  let image: FileHandle | null = null;
  try {
    image = await open(
      absoluteImagePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    openedWithNoFollow = true;
    openedMetadata = await image.stat();
    const sidecar = await readTrustedDigestSidecar(
      `${absoluteImagePath}.sha256`,
    );
    sidecarTrusted = sidecar.trusted;
    actualDigest = await sha256(image);
    digestVerified = sidecar.trusted && sidecar.expectedDigest === actualDigest;
  } catch {
    digestVerified = false;
  } finally {
    await image?.close();
  }

  return {
    ...base,
    exists: true,
    regularFile: openedMetadata.isFile(),
    symbolicLink: false,
    ownerUid: openedMetadata.uid,
    ownerGid: openedMetadata.gid,
    mode: openedMetadata.mode & 0o777,
    openedWithNoFollow,
    sidecarTrusted,
    sha256: actualDigest,
    digestVerified,
  };
}

async function collectStorageBackingFileFacts(): Promise<StorageBackingFileFacts> {
  const path = resolve(CANONICAL_SANDBOX_BACKING_PATH);
  const parentChainTrusted = await trustedImageParentChain(path, {
    trustedRoot: dirname(path),
  });
  let pathMetadata: Stats;
  try {
    pathMetadata = await lstat(path);
  } catch {
    return {
      path,
      canonicalPath: null,
      exists: false,
      regularFile: false,
      symbolicLink: false,
      ownerUid: null,
      ownerGid: null,
      mode: null,
      openedWithNoFollow: false,
      parentChainTrusted,
      logicalBytes: 0,
      allocatedBytes: 0,
    };
  }

  let canonicalPath: string | null = null;
  try {
    canonicalPath = await realpath(path);
  } catch {
    canonicalPath = null;
  }
  if (pathMetadata.isSymbolicLink()) {
    return {
      path,
      canonicalPath,
      exists: true,
      regularFile: false,
      symbolicLink: true,
      ownerUid: pathMetadata.uid,
      ownerGid: pathMetadata.gid,
      mode: pathMetadata.mode & 0o777,
      openedWithNoFollow: false,
      parentChainTrusted,
      logicalBytes: pathMetadata.size,
      allocatedBytes: pathMetadata.blocks * 512,
    };
  }

  let file: FileHandle | null = null;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await file.stat();
    return {
      path,
      canonicalPath,
      exists: true,
      regularFile: metadata.isFile(),
      symbolicLink: false,
      ownerUid: metadata.uid,
      ownerGid: metadata.gid,
      mode: metadata.mode & 0o777,
      openedWithNoFollow: true,
      parentChainTrusted,
      logicalBytes: metadata.size,
      allocatedBytes: metadata.blocks * 512,
    };
  } catch {
    return {
      path,
      canonicalPath,
      exists: true,
      regularFile: pathMetadata.isFile(),
      symbolicLink: false,
      ownerUid: pathMetadata.uid,
      ownerGid: pathMetadata.gid,
      mode: pathMetadata.mode & 0o777,
      openedWithNoFollow: false,
      parentChainTrusted,
      logicalBytes: pathMetadata.size,
      allocatedBytes: pathMetadata.blocks * 512,
    };
  } finally {
    await file?.close();
  }
}

async function collectLogicalCeiling(): Promise<{
  readonly path: string;
  readonly trusted: boolean;
  readonly bytes: number;
}> {
  const path = resolve(CANONICAL_STORAGE_CEILING_PATH);
  let file: FileHandle | null = null;
  try {
    const pathMetadata = await lstat(path);
    if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile()) {
      return { path, trusted: false, bytes: 0 };
    }
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await file.stat();
    const parentChainTrusted = await trustedImageParentChain(path, {
      trustedRoot: dirname(path),
    });
    if (
      !metadata.isFile() ||
      metadata.uid !== 0 ||
      metadata.gid !== 0 ||
      (metadata.mode & 0o022) !== 0 ||
      metadata.size < 2 ||
      metadata.size > 64 ||
      !parentChainTrusted
    ) {
      return { path, trusted: false, bytes: 0 };
    }
    const content = (await file.readFile({ encoding: "utf8" })).trim();
    if (!/^[1-9][0-9]*$/u.test(content)) {
      return { path, trusted: false, bytes: 0 };
    }
    const bytes = Number(content);
    return {
      path,
      trusted: Number.isSafeInteger(bytes) && bytes > 0,
      bytes,
    };
  } catch {
    return { path, trusted: false, bytes: 0 };
  } finally {
    await file?.close();
  }
}

async function collectLoopBackingFilePath(
  storageMount: MountInfoEntry | null,
): Promise<{
  readonly mountedPath: string | null;
  readonly canonicalBackingMappingCount: number;
}> {
  let canonicalBackingMappingCount = 0;
  try {
    const entries = await opendir("/sys/block");
    for await (const entry of entries) {
      if (!/^loop[0-9]+$/u.test(entry.name)) continue;
      try {
        const value = (
          await readFile(`/sys/block/${entry.name}/loop/backing_file`, "utf8")
        ).trim();
        if (
          value !== "" &&
          resolve("/", value) === resolve(CANONICAL_SANDBOX_BACKING_PATH)
        ) {
          canonicalBackingMappingCount += 1;
        }
      } catch {
        // An unattached or concurrently detached loop device has no mapping.
      }
    }
  } catch {
    // The returned zero count makes preflight fail closed.
  }
  if (
    storageMount === null ||
    !/^\/dev\/loop[0-9]+$/u.test(storageMount.source)
  ) {
    return { mountedPath: null, canonicalBackingMappingCount };
  }
  try {
    const value = (
      await readFile(
        `/sys/dev/block/${storageMount.device}/loop/backing_file`,
        "utf8",
      )
    ).trim();
    return {
      mountedPath: value === "" ? null : resolve("/", value),
      canonicalBackingMappingCount,
    };
  } catch {
    return { mountedPath: null, canonicalBackingMappingCount };
  }
}

export interface CollectUserSandboxFactsOptions {
  readonly storagePath: string;
  readonly environmentName: string;
  readonly imagePath: string;
  readonly probeGuestRuntime?: GuestRuntimeProbe;
  readonly probeProjectQuota?: ProjectQuotaProbe;
}

export interface GuestRuntimeProbeRequest {
  readonly imagePath: string;
  readonly imageSha256: string | null;
}

export type GuestRuntimeProbe = (
  request: GuestRuntimeProbeRequest,
) => Promise<GuestRuntimeFacts | null>;

export interface ProjectQuotaProbeRequest {
  readonly storagePath: string;
  readonly dataPath: string;
}

export type ProjectQuotaProbe = (
  request: ProjectQuotaProbeRequest,
) => Promise<XfsProjectQuotaFacts | null>;

async function collectBindPath(path: string): Promise<BindPathFacts> {
  try {
    const metadata = await lstat(path);
    let canonicalPath: string | null = null;
    try {
      canonicalPath = await realpath(path);
    } catch {
      canonicalPath = null;
    }
    let effectiveOwnerAccess = true;
    try {
      await access(path, constants.R_OK | constants.W_OK | constants.X_OK);
    } catch {
      effectiveOwnerAccess = false;
    }
    return {
      path,
      canonicalPath,
      exists: true,
      symbolicLink: metadata.isSymbolicLink(),
      directory: metadata.isDirectory(),
      ownerUid: metadata.uid,
      ownerGid: metadata.gid,
      mode: metadata.mode & 0o777,
      effectiveOwnerAccess,
    };
  } catch {
    return {
      path,
      canonicalPath: null,
      exists: false,
      symbolicLink: false,
      directory: false,
      ownerUid: null,
      ownerGid: null,
      mode: null,
      effectiveOwnerAccess: false,
    };
  }
}

export async function collectUserSandboxFacts(
  options: CollectUserSandboxFactsOptions,
): Promise<UserSandboxPreflightFacts> {
  const [
    mountInfo,
    systemdNspawnAvailable,
    image,
    hostAccounts,
    hostGroupGids,
    hostIdPool,
    backingFile,
    logicalCeiling,
    storageFstrimAvailable,
    storageTrimTimerActive,
  ] = await Promise.all([
    readFile("/proc/self/mountinfo", "utf8"),
    executableExists("/usr/bin/systemd-nspawn"),
    collectImageFacts(options.imagePath, options.storagePath),
    readAccounts(),
    readFile("/etc/group", "utf8").then(parseGroupGids),
    collectHostIdPoolFacts(),
    collectStorageBackingFileFacts(),
    collectLogicalCeiling(),
    executableExists("/usr/sbin/fstrim"),
    Promise.resolve(systemdUnitActive("brai-user-storage-trim.timer")),
  ]);
  const mounts = parseMountInfo(mountInfo);
  const rootMount = mountForPath(mounts, "/");
  if (rootMount === null) {
    throw new Error(
      "Cannot resolve the host root mount from /proc/self/mountinfo.",
    );
  }

  let storagePathExists = true;
  let storagePathCanonicalPath: string | null = null;
  let storageMount: MountInfoEntry | null = null;
  let storageTotalBytes = 0;
  let storageAvailableBytes = 0;
  try {
    const storageStats = await statfs(options.storagePath);
    storagePathCanonicalPath = await realpath(options.storagePath);
    storageMount = mountForPath(mounts, options.storagePath);
    storageTotalBytes = storageStats.blocks * storageStats.bsize;
    storageAvailableBytes = storageStats.bavail * storageStats.bsize;
  } catch {
    storagePathExists = false;
  }

  const backingMount = mountForPath(mounts, backingFile.path);
  let outerStorageTotalBytes = 0;
  let outerStorageAvailableBytes = 0;
  try {
    const outerStats = await statfs(dirname(backingFile.path));
    outerStorageTotalBytes = outerStats.blocks * outerStats.bsize;
    outerStorageAvailableBytes = outerStats.bavail * outerStats.bsize;
  } catch {
    // A missing/unreadable canonical parent is represented as zero capacity.
  }
  const loopBacking = await collectLoopBackingFilePath(storageMount);

  const dataPath = resolve(options.storagePath, options.environmentName);
  const [bindPath, guestRuntime, projectQuota] = await Promise.all([
    collectBindPath(dataPath),
    options.probeGuestRuntime?.({
      imagePath: image.path,
      imageSha256: image.sha256,
    }) ?? Promise.resolve(null),
    options.probeProjectQuota?.({
      storagePath: resolve(options.storagePath),
      dataPath,
    }) ?? Promise.resolve(null),
  ]);

  return {
    storagePath: resolve(options.storagePath),
    storagePathCanonicalPath,
    storagePathExists,
    logicalCeilingConfigurationPath: logicalCeiling.path,
    logicalCeilingConfigurationTrusted: logicalCeiling.trusted,
    configuredLogicalCeilingBytes: logicalCeiling.bytes,
    backingFile,
    backingMount,
    loopBackingFilePath: loopBacking.mountedPath,
    backingFileLoopDeviceCount: loopBacking.canonicalBackingMappingCount,
    rootMount,
    storageMount,
    storageTotalBytes,
    storageAvailableBytes,
    outerStorageTotalBytes,
    outerStorageAvailableBytes,
    storageFstrimAvailable,
    storageTrimTimerActive,
    systemdNspawnAvailable,
    hostPrincipalScanCompleted: true,
    hostAccountUids: [...new Set(hostAccounts.map(({ uid }) => uid))].sort(
      (left, right) => left - right,
    ),
    hostGroupGids,
    hostIdPool,
    bindPath,
    image,
    guestRuntime,
    projectQuota,
  };
}
