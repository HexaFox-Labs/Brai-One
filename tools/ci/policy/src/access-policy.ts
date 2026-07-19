import { spawnSync } from "node:child_process";
import { lstat, opendir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const ENVIRONMENT_MANAGED_DIRECTORY_NAMES = new Set([
  ".agents",
  ".codex",
  ".git",
]);

const GENERATED_DIRECTORY_NAMES = new Set([
  ".cache",
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

const IGNORED_DIRECTORY_NAMES = new Set([
  ...ENVIRONMENT_MANAGED_DIRECTORY_NAMES,
  ...GENERATED_DIRECTORY_NAMES,
]);

const FORBIDDEN_RUNTIME_SOCKETS = new Set([
  "/run/containerd/containerd.sock",
  "/run/docker.sock",
  "/run/podman/podman.sock",
  "/var/run/docker.sock",
]);

const ALLOWED_BIND_MOUNTS = new Map([
  [
    "brai-nats:/etc/nats/nats-server.conf",
    "infrastructure/nats/nats-server.conf",
  ],
]);

const FORBIDDEN_HOST_SCRIPT_PATTERNS = [
  {
    expression: /\bchmod\s+(?:(?:--?[\w-]+)\s+)*0?777\b/u,
    name: "chmod_777",
  },
  {
    expression:
      /\bchown\s+(?:(?:--?[^\s]+)\s+)*(?:-[^\s]*R[^\s]*|--recursive)(?:\s|$)/u,
    name: "recursive_chown",
  },
  {
    expression:
      /\bchmod\s+(?:(?:--?[^\s]+)\s+)*(?:-[^\s]*R[^\s]*|--recursive)(?:\s|$)/u,
    name: "recursive_chmod",
  },
  {
    expression:
      /\bsudo\b[^\n;&|]*(?:\b(?:bun|cargo|docker|make|npm|nx|pnpm|yarn)\s+(?:run\s+)?(?:build|ci|compile|install|test|typecheck)\b|\bgit\s+(?:checkout|clean|clone|commit|merge|pull|reset|restore|switch)\b)/u,
    name: "sudo_project_build",
  },
] as const;

const SYSTEM_ID_EXECUTABLE = "/usr/bin/id";

export type FileIdentity = { gid: number; uid: number };
type ComposePort = { host_ip?: string };
type ComposeVolume = {
  read_only?: boolean;
  source?: string;
  target?: string;
  type?: string;
};
type ComposeService = {
  cap_add?: string[];
  cap_drop?: string[];
  ipc?: string;
  network_mode?: string;
  pid?: string;
  ports?: ComposePort[];
  privileged?: boolean;
  read_only?: boolean;
  security_opt?: string[];
  volumes?: ComposeVolume[];
};
export type ComposeConfiguration = {
  services?: Record<string, ComposeService>;
};

function parseNumericIdentity(value: string, description: string): number {
  const normalized = value.trim();
  if (!/^\d+$/u.test(normalized)) {
    throw new Error(`Invalid ${description}: ${JSON.stringify(normalized)}`);
  }
  return Number(normalized);
}

function readAccountIdentityPart(
  accountName: string,
  flag: "-g" | "-u",
): number {
  const result = spawnSync(SYSTEM_ID_EXECUTABLE, [flag, accountName], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `Unable to resolve account ${accountName}`,
    );
  }
  return parseNumericIdentity(
    result.stdout,
    `${flag === "-u" ? "UID" : "GID"} for ${accountName}`,
  );
}

export function resolveAccountIdentity(accountName: string): FileIdentity {
  if (!/^[a-z_][a-z0-9_-]*[$]?$/u.test(accountName)) {
    throw new Error(`Invalid account name: ${JSON.stringify(accountName)}`);
  }
  return {
    gid: readAccountIdentityPart(accountName, "-g"),
    uid: readAccountIdentityPart(accountName, "-u"),
  };
}

function displayPath(root: string, path: string): string {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" ? "." : pathFromRoot;
}

function checkIdentity(
  violations: string[],
  root: string,
  path: string,
  actual: FileIdentity,
  expected: FileIdentity,
): void {
  if (actual.uid !== expected.uid || actual.gid !== expected.gid) {
    violations.push(
      `foreign_owner:${displayPath(root, path)}:${actual.uid}:${actual.gid}`,
    );
  }
}

async function checkSymlinkTarget(
  violations: string[],
  root: string,
  path: string,
): Promise<void> {
  let target: string;
  try {
    target = await realpath(path);
  } catch {
    violations.push(`dangling_symlink:${displayPath(root, path)}`);
    return;
  }

  const targetFromRoot = relative(root, target);
  if (
    targetFromRoot === ".." ||
    targetFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(targetFromRoot)
  ) {
    violations.push(`external_symlink:${displayPath(root, path)}`);
    return;
  }

  const firstSegment = targetFromRoot.split(sep, 1)[0];
  if (
    firstSegment !== undefined &&
    ENVIRONMENT_MANAGED_DIRECTORY_NAMES.has(firstSegment)
  ) {
    violations.push(`environment_symlink:${displayPath(root, path)}`);
  }
}

async function walkSourceTree(
  root: string,
  directory: string,
  expected: FileIdentity,
  violations: string[],
): Promise<void> {
  const entries = await opendir(directory);

  for await (const entry of entries) {
    if (
      entry.isDirectory() &&
      ENVIRONMENT_MANAGED_DIRECTORY_NAMES.has(entry.name)
    )
      continue;

    const path = join(directory, entry.name);
    const metadata = await lstat(path);
    checkIdentity(violations, root, path, metadata, expected);

    if (entry.isDirectory() && GENERATED_DIRECTORY_NAMES.has(entry.name)) {
      await walkGeneratedTree(
        root,
        path,
        expected,
        violations,
        entry.name === "node_modules",
      );
      continue;
    }

    if (metadata.isSymbolicLink()) {
      await checkSymlinkTarget(violations, root, path);
      continue;
    }

    const permissions = metadata.mode & 0o7777;
    if ((permissions & 0o020) !== 0) {
      violations.push(`group_writable:${displayPath(root, path)}`);
    }
    if ((permissions & 0o002) !== 0) {
      violations.push(`world_writable:${displayPath(root, path)}`);
    }
    if ((permissions & 0o6000) !== 0) {
      violations.push(`setid_bit:${displayPath(root, path)}`);
    }

    if (metadata.isDirectory()) {
      if ((permissions & 0o700) !== 0o700) {
        violations.push(`owner_directory_access:${displayPath(root, path)}`);
      }
      await walkSourceTree(root, path, expected, violations);
    } else if (metadata.isFile()) {
      if ((permissions & 0o600) !== 0o600) {
        violations.push(`owner_file_access:${displayPath(root, path)}`);
      }
    } else if (!metadata.isSymbolicLink()) {
      violations.push(`special_source_entry:${displayPath(root, path)}`);
    }
  }
}

async function walkGeneratedTree(
  root: string,
  directory: string,
  expected: FileIdentity,
  violations: string[],
  allowReadOnlyFiles = false,
): Promise<void> {
  const directoryMetadata = await lstat(directory);
  const directoryPermissions = directoryMetadata.mode & 0o7777;
  if ((directoryPermissions & 0o700) !== 0o700) {
    violations.push(
      `generated_directory_access:${displayPath(root, directory)}`,
    );
  }
  if ((directoryPermissions & 0o002) !== 0) {
    violations.push(`world_writable:${displayPath(root, directory)}`);
  }
  if ((directoryPermissions & 0o6000) !== 0) {
    violations.push(`setid_bit:${displayPath(root, directory)}`);
  }

  const entries = await opendir(directory);
  for await (const entry of entries) {
    const path = join(directory, entry.name);
    const metadata = await lstat(path);
    checkIdentity(violations, root, path, metadata, expected);
    if (metadata.isSymbolicLink()) {
      await checkSymlinkTarget(violations, root, path);
      continue;
    }

    const permissions = metadata.mode & 0o7777;
    if ((permissions & 0o002) !== 0) {
      violations.push(`world_writable:${displayPath(root, path)}`);
    }
    if ((permissions & 0o6000) !== 0) {
      violations.push(`setid_bit:${displayPath(root, path)}`);
    }

    if (metadata.isDirectory()) {
      if ((permissions & 0o700) !== 0o700) {
        violations.push(
          `generated_directory_access:${displayPath(root, path)}`,
        );
      }
      await walkGeneratedTree(
        root,
        path,
        expected,
        violations,
        allowReadOnlyFiles,
      );
    } else if (metadata.isFile()) {
      const readOnlyDependencyFile =
        allowReadOnlyFiles &&
        (permissions & 0o400) !== 0 &&
        (permissions & 0o222) === 0;
      if ((permissions & 0o600) !== 0o600 && !readOnlyDependencyFile) {
        violations.push(`generated_file_access:${displayPath(root, path)}`);
      }
    } else {
      violations.push(`special_generated_entry:${displayPath(root, path)}`);
    }
  }
}

export async function auditSourceTree(
  workspaceRoot: string,
  expectedIdentity?: FileIdentity,
): Promise<string[]> {
  const root = await realpath(workspaceRoot);
  const metadata = await stat(root);
  const requireClosedWorkspaceBoundary = expectedIdentity !== undefined;
  const expected = expectedIdentity ?? { gid: metadata.gid, uid: metadata.uid };
  const violations: string[] = [];

  checkIdentity(violations, root, root, metadata, expected);
  const rootPermissions = metadata.mode & 0o7777;
  if ((rootPermissions & 0o700) !== 0o700) {
    violations.push("owner_directory_access:.");
  }
  if (requireClosedWorkspaceBoundary && (rootPermissions & 0o077) !== 0) {
    violations.push("workspace_boundary_access:.");
  }
  if ((rootPermissions & 0o6000) !== 0) violations.push("setid_bit:.");

  await walkSourceTree(root, root, expected, violations);
  return violations.sort();
}

export function auditComposeConfiguration(
  configuration: ComposeConfiguration,
  workspaceRoot: string,
): string[] {
  const violations: string[] = [];
  const root = resolve(workspaceRoot);

  for (const [serviceName, service] of Object.entries(
    configuration.services ?? {},
  )) {
    if (service.privileged === true) {
      violations.push(`compose_privileged:${serviceName}`);
    }
    if (service.read_only !== true) {
      violations.push(`compose_rootfs_writable:${serviceName}`);
    }
    if (!service.cap_drop?.includes("ALL")) {
      violations.push(`compose_capabilities_not_dropped:${serviceName}`);
    }
    if ((service.cap_add?.length ?? 0) > 0) {
      violations.push(`compose_capabilities_added:${serviceName}`);
    }
    if (!service.security_opt?.includes("no-new-privileges:true")) {
      violations.push(`compose_privilege_escalation:${serviceName}`);
    }
    if (service.network_mode === "host") {
      violations.push(`compose_host_network:${serviceName}`);
    }
    if (service.pid === "host")
      violations.push(`compose_host_pid:${serviceName}`);
    if (service.ipc === "host")
      violations.push(`compose_host_ipc:${serviceName}`);

    for (const port of service.ports ?? []) {
      if (port.host_ip !== "127.0.0.1") {
        violations.push(`compose_public_port:${serviceName}`);
      }
    }

    for (const volume of service.volumes ?? []) {
      if (isRuntimeSocket(volume.source) || isRuntimeSocket(volume.target)) {
        violations.push(`compose_host_runtime_socket:${serviceName}`);
      }
      if (volume.type !== "bind") continue;

      const key = `${serviceName}:${volume.target ?? ""}`;
      const allowedRelativePath = ALLOWED_BIND_MOUNTS.get(key);
      const expectedSource = allowedRelativePath
        ? resolve(root, allowedRelativePath)
        : undefined;
      if (
        expectedSource === undefined ||
        resolve(root, volume.source ?? "") !== expectedSource ||
        volume.read_only !== true
      ) {
        violations.push(`compose_unapproved_bind_mount:${key}`);
      }
    }
  }

  return violations.sort();
}

function isRuntimeSocket(path: string | undefined): boolean {
  if (path === undefined) return false;
  return (
    FORBIDDEN_RUNTIME_SOCKETS.has(path) ||
    /\/(?:containerd|docker)\.sock$/u.test(path) ||
    /\/podman\/podman\.sock$/u.test(path)
  );
}

export function loadComposeConfiguration(
  workspaceRoot: string,
): ComposeConfiguration {
  const result = spawnSync(
    "docker",
    ["compose", "--profile", "*", "config", "--format", "json"],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        BRAI_CONFIG_DIR: "/tmp/brai-new-compose-config-not-present",
      },
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || "docker compose config failed");
  }
  return JSON.parse(result.stdout) as ComposeConfiguration;
}

export async function auditDockerfiles(
  workspaceRoot: string,
  dockerfiles: string[],
): Promise<string[]> {
  const violations: string[] = [];

  for (const relativePath of dockerfiles) {
    const source = await readFile(join(workspaceRoot, relativePath), "utf8");
    const finalStage = source.split(/^FROM\s+/gimu).at(-1) ?? "";
    const users = [...finalStage.matchAll(/^USER\s+([^\s#]+)/gimu)];
    const finalUser = users.at(-1)?.[1]?.trim().toLowerCase();
    if (!isExplicitNonRootUser(finalUser)) {
      violations.push(`dockerfile_root_final_user:${relativePath}`);
    }
  }
  return violations.sort();
}

function isExplicitNonRootUser(user: string | undefined): boolean {
  if (user === undefined || /[$'"{}]/u.test(user)) return false;
  const account = user.split(":", 1)[0];
  if (account === undefined || account === "" || account === "root")
    return false;
  if (/^\d+$/u.test(account)) return Number(account) > 0;
  return /^[a-z_][a-z0-9_-]*$/u.test(account);
}

async function collectFiles(
  directory: string,
  predicate: (path: string) => boolean,
): Promise<string[]> {
  const files: string[] = [];
  const entries = await opendir(directory);

  for await (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name))
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path, predicate)));
    } else if (entry.isFile() && predicate(path)) {
      files.push(path);
    }
  }
  return files;
}

export async function auditHostScripts(
  workspaceRoot: string,
): Promise<string[]> {
  const violations: string[] = [];
  const files = await collectFiles(workspaceRoot, (path) => {
    const name = basename(path);
    return /\.(?:mjs|sh|yaml|yml)$/u.test(name) || name === "package.json";
  });

  for (const path of files) {
    const source = await readFile(path, "utf8");
    for (const pattern of FORBIDDEN_HOST_SCRIPT_PATTERNS) {
      if (pattern.expression.test(source)) {
        violations.push(
          `host_script_${pattern.name}:${relative(workspaceRoot, path)}`,
        );
      }
    }
  }
  return violations.sort();
}

export async function findDockerfiles(
  workspaceRoot: string,
): Promise<string[]> {
  return (
    await collectFiles(workspaceRoot, (path) =>
      /^(?:Dockerfile(?:\..+)?|.+\.Dockerfile)$/u.test(basename(path)),
    )
  )
    .map((path) => relative(workspaceRoot, path))
    .sort();
}

export async function auditWorkspace(
  workspaceRoot: string,
  expectedIdentity?: FileIdentity,
): Promise<string[]> {
  const dockerfiles = await findDockerfiles(workspaceRoot);
  const [sourceViolations, dockerfileViolations, scriptViolations] =
    await Promise.all([
      auditSourceTree(workspaceRoot, expectedIdentity),
      auditDockerfiles(workspaceRoot, dockerfiles),
      auditHostScripts(workspaceRoot),
    ]);
  const composeViolations = auditComposeConfiguration(
    loadComposeConfiguration(workspaceRoot),
    workspaceRoot,
  );

  return [
    ...sourceViolations,
    ...composeViolations,
    ...dockerfileViolations,
    ...scriptViolations,
  ].sort();
}
