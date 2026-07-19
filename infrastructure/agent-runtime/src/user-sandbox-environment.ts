import { constants } from "node:fs";
import { lstat, open, readdir, type FileHandle } from "node:fs/promises";

import {
  BRAI_SINGLE_RUNTIME_HOST_ID,
  type InternalAgentLaunchContract,
} from "@brai/contracts";

import {
  CANONICAL_ENVIRONMENT_DIRECTORY,
  CANONICAL_STORAGE_ROOT,
} from "./trusted-provisioning.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ENVIRONMENT_NAME_PATTERN = /^brai-u-[0-9a-z]+$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const EXPECTED_KEYS = Object.freeze([
  "BRAI_RESERVATION_ID",
  "BRAI_USER_ID",
  "BRAI_ENVIRONMENT_ID",
  "BRAI_RUNTIME_HOST_ID",
  "BRAI_PROVISION_GENERATION",
  "BRAI_ACCESS_GENERATION",
  "BRAI_USERNS_START",
  "BRAI_USER_DATA",
  "BRAI_XFS_PROJECT_ID",
  "BRAI_QUOTA_BYTES",
  "BRAI_QUOTA_INODES",
  "BRAI_IMAGE_SHA256",
]);

export interface UserSandboxEnvironmentBinding {
  readonly environmentId: string;
  readonly userId: string;
  readonly environmentName: string;
  readonly machineName: string;
  readonly dataPath: string;
  readonly outerRootUid: number;
  readonly outerRootGid: number;
  readonly imageBraiUid: number;
  readonly imageBraiGid: number;
  readonly imageSha256: string;
  readonly xfsProjectId: number;
  readonly quotaBytes: number;
  readonly quotaInodes: number;
}

export interface UserSandboxEnvironmentResolver {
  resolve(
    contract: InternalAgentLaunchContract,
  ): Promise<UserSandboxEnvironmentBinding>;
}

export class UserSandboxEnvironmentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UserSandboxEnvironmentError";
  }
}

function parsePositiveInteger(
  value: string | undefined,
  field: string,
): number {
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) {
    throw new UserSandboxEnvironmentError(
      `${field} is not a positive integer.`,
    );
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new UserSandboxEnvironmentError(`${field} exceeds the safe range.`);
  }
  return number;
}

function parseEnvironmentFile(content: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const line of content.split("\n")) {
    if (line === "") continue;
    const separator = line.indexOf("=");
    if (separator < 1) {
      throw new UserSandboxEnvironmentError(
        "Environment binding contains a malformed line.",
      );
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!EXPECTED_KEYS.includes(key) || values.has(key) || value === "") {
      throw new UserSandboxEnvironmentError(
        "Environment binding contains unknown, duplicate, or empty fields.",
      );
    }
    values.set(key, value);
  }
  if (
    values.size !== EXPECTED_KEYS.length ||
    EXPECTED_KEYS.some((key) => !values.has(key))
  ) {
    throw new UserSandboxEnvironmentError("Environment binding is incomplete.");
  }
  return values;
}

async function readTrustedEnvironmentFile(path: string): Promise<string> {
  let handle: FileHandle | null = null;
  try {
    const pathMetadata = await lstat(path);
    if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile()) {
      throw new Error("not a regular file");
    }
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== 0 ||
      metadata.gid !== 0 ||
      (metadata.mode & 0o7777) !== 0o600 ||
      metadata.nlink !== 1 ||
      metadata.size < 1 ||
      metadata.size > 16 * 1_024
    ) {
      throw new Error("untrusted environment metadata");
    }
    return await handle.readFile("utf8");
  } catch {
    throw new UserSandboxEnvironmentError(
      "Cannot read a trusted user-sandbox environment binding.",
    );
  } finally {
    await handle?.close();
  }
}

async function assertEnvironmentDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    metadata.uid !== 0 ||
    metadata.gid !== 0 ||
    (metadata.mode & 0o7777) !== 0o700
  ) {
    throw new UserSandboxEnvironmentError(
      "Environment directory must be root:root 0700.",
    );
  }
}

function bindingFrom(
  environmentName: string,
  values: ReadonlyMap<string, string>,
): UserSandboxEnvironmentBinding {
  const environmentId = values.get("BRAI_ENVIRONMENT_ID") ?? "";
  const userId = values.get("BRAI_USER_ID") ?? "";
  const runtimeHostId = values.get("BRAI_RUNTIME_HOST_ID") ?? "";
  const dataPath = values.get("BRAI_USER_DATA") ?? "";
  const imageSha256 = values.get("BRAI_IMAGE_SHA256") ?? "";
  const outerRootUid = parsePositiveInteger(
    values.get("BRAI_USERNS_START"),
    "BRAI_USERNS_START",
  );
  const xfsProjectId = parsePositiveInteger(
    values.get("BRAI_XFS_PROJECT_ID"),
    "BRAI_XFS_PROJECT_ID",
  );
  const quotaBytes = parsePositiveInteger(
    values.get("BRAI_QUOTA_BYTES"),
    "BRAI_QUOTA_BYTES",
  );
  const quotaInodes = parsePositiveInteger(
    values.get("BRAI_QUOTA_INODES"),
    "BRAI_QUOTA_INODES",
  );
  parsePositiveInteger(
    values.get("BRAI_PROVISION_GENERATION"),
    "BRAI_PROVISION_GENERATION",
  );
  parsePositiveInteger(
    values.get("BRAI_ACCESS_GENERATION"),
    "BRAI_ACCESS_GENERATION",
  );
  if (
    !UUID_PATTERN.test(values.get("BRAI_RESERVATION_ID") ?? "") ||
    !UUID_PATTERN.test(environmentId) ||
    !UUID_PATTERN.test(userId) ||
    runtimeHostId !== BRAI_SINGLE_RUNTIME_HOST_ID ||
    !ENVIRONMENT_NAME_PATTERN.test(environmentName) ||
    dataPath !== `${CANONICAL_STORAGE_ROOT}/${environmentName}` ||
    !SHA256_PATTERN.test(imageSha256)
  ) {
    throw new UserSandboxEnvironmentError(
      "Environment binding differs from canonical host allocation constants.",
    );
  }
  return Object.freeze({
    environmentId,
    userId,
    environmentName,
    machineName: environmentName,
    dataPath,
    outerRootUid,
    outerRootGid: outerRootUid,
    imageBraiUid: outerRootUid + 1_000,
    imageBraiGid: outerRootUid + 1_000,
    imageSha256,
    xfsProjectId,
    quotaBytes,
    quotaInodes,
  });
}

export class FilesystemUserSandboxEnvironmentResolver implements UserSandboxEnvironmentResolver {
  public constructor(
    private readonly directory = CANONICAL_ENVIRONMENT_DIRECTORY,
  ) {}

  public async resolve(
    contract: InternalAgentLaunchContract,
  ): Promise<UserSandboxEnvironmentBinding> {
    if (
      contract.access.profile !== "user-sandbox" ||
      contract.environment_id === null
    ) {
      throw new UserSandboxEnvironmentError(
        "A verified user-sandbox launch contract is required.",
      );
    }
    await assertEnvironmentDirectory(this.directory);
    const names = (await readdir(this.directory))
      .filter((name) => /^brai-u-[0-9a-z]+\.env$/u.test(name))
      .sort();
    const matches: UserSandboxEnvironmentBinding[] = [];
    for (const name of names) {
      const environmentName = name.slice(0, -".env".length);
      const binding = bindingFrom(
        environmentName,
        parseEnvironmentFile(
          await readTrustedEnvironmentFile(`${this.directory}/${name}`),
        ),
      );
      if (binding.environmentId === contract.environment_id) {
        matches.push(binding);
      }
    }
    if (
      matches.length !== 1 ||
      matches[0]?.userId !== contract.access.user_id
    ) {
      throw new UserSandboxEnvironmentError(
        "Launch contract has no unique trusted provisioned environment.",
      );
    }
    return matches[0];
  }
}
