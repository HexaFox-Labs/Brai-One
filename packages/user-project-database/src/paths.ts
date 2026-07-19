import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  statfsSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  InvalidUserDatabasePathError,
  UnsupportedUserDatabaseFilesystemError,
} from "./errors.js";

// Network, distributed, or userspace filesystems whose locking/durability
// semantics are unsuitable for SQLite WAL in the Brai runtime.
const UNSAFE_WAL_FILESYSTEM_TYPES = new Set([
  0x6969n, // NFS
  0xff534d42n, // CIFS/SMB
  0xfe534d42n, // SMB2
  0x73757245n, // CODA
  0x5346414fn, // AFS
  0x01021997n, // 9P
  0x65735546n, // FUSE (backing filesystem cannot be established here)
  0x00c36400n, // Ceph
  0x7461636fn, // OCFS2
  0x01161970n, // GFS2
  0x0bd00bd0n, // Lustre
  0x19830326n, // BeeGFS
]);

export interface ResolvedUserDatabasePath {
  readonly path: string;
  readonly workspaceRoot: string;
}

export function resolveDatabasePath(
  workspaceRoot: string,
  databaseFile: string,
): ResolvedUserDatabasePath {
  if (databaseFile.length === 0 || databaseFile.includes("\0")) {
    throw new InvalidUserDatabasePathError(
      "Database path is empty or invalid.",
    );
  }

  const root = realDirectory(workspaceRoot, "Workspace root");
  const candidate = isAbsolute(databaseFile)
    ? resolve(databaseFile)
    : resolve(root, databaseFile);

  assertStrictlyInside(root, candidate, "Database");
  prepareValidatedParent(root, dirname(candidate));
  validateExistingFile(candidate, "Database");
  assertLocalWalFilesystem(dirname(candidate));

  return { path: candidate, workspaceRoot: root };
}

export function resolveBackupDestination(
  workspaceRoot: string,
  databasePath: string,
  destinationFile: string,
): string {
  if (destinationFile.length === 0 || destinationFile.includes("\0")) {
    throw new InvalidUserDatabasePathError(
      "Backup destination is empty or invalid.",
    );
  }

  const destination = isAbsolute(destinationFile)
    ? resolve(destinationFile)
    : resolve(workspaceRoot, destinationFile);

  assertStrictlyInside(workspaceRoot, destination, "Backup destination");
  if (destination === databasePath) {
    throw new InvalidUserDatabasePathError(
      "Backup destination must differ from the live database.",
    );
  }
  if (destination.endsWith("-wal") || destination.endsWith("-shm")) {
    throw new InvalidUserDatabasePathError(
      "Backup destination cannot use a SQLite sidecar filename.",
    );
  }

  prepareValidatedParent(workspaceRoot, dirname(destination));
  validateExistingFile(destination, "Backup destination");
  assertLocalWalFilesystem(dirname(destination));
  return destination;
}

export function assertLocalWalFilesystem(path: string): void {
  const { type } = statfsSync(path, { bigint: true });
  const normalizedType = BigInt.asUintN(32, type);
  if (UNSAFE_WAL_FILESYSTEM_TYPES.has(normalizedType)) {
    throw new UnsupportedUserDatabaseFilesystemError(normalizedType);
  }
}

function prepareValidatedParent(root: string, parent: string): void {
  const relativeParent = relative(root, parent);
  let current = root;
  for (const component of relativeParent.split(sep).filter(Boolean)) {
    current = join(current, component);
    if (!existsSync(current)) {
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if (!isNodeErrorWithCode(error, "EEXIST")) {
          throw error;
        }
      }
    }

    const status = lstatSync(current);
    if (status.isSymbolicLink() || !status.isDirectory()) {
      throw new InvalidUserDatabasePathError(
        "Database paths cannot traverse symbolic links or non-directories.",
      );
    }
  }

  const resolvedParent = realDirectory(parent, "Database parent directory");
  assertInsideOrEqual(root, resolvedParent, "Database parent directory");

  // Reject path aliases even if they point back inside the workspace. This keeps
  // backup and database replacement behavior deterministic.
  if (resolvedParent !== resolve(parent)) {
    throw new InvalidUserDatabasePathError(
      "Database paths cannot traverse symbolic links.",
    );
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function validateExistingFile(path: string, label: string): void {
  if (!existsSync(path)) {
    return;
  }

  const status = lstatSync(path);
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new InvalidUserDatabasePathError(
      `${label} must be a regular file and cannot be a symbolic link.`,
    );
  }
}

function realDirectory(path: string, label: string): string {
  let realPath: string;
  try {
    realPath = realpathSync(path);
  } catch {
    throw new InvalidUserDatabasePathError(`${label} does not exist.`);
  }

  const status = lstatSync(realPath);
  if (!status.isDirectory()) {
    throw new InvalidUserDatabasePathError(`${label} must be a directory.`);
  }
  return realPath;
}

function assertStrictlyInside(root: string, path: string, label: string): void {
  if (path === root) {
    throw new InvalidUserDatabasePathError(
      `${label} must be a file below the workspace root.`,
    );
  }
  assertInsideOrEqual(root, path, label);
}

function assertInsideOrEqual(root: string, path: string, label: string): void {
  const pathFromRoot = relative(root, path);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new InvalidUserDatabasePathError(
      `${label} must stay inside the user workspace root.`,
    );
  }
}
