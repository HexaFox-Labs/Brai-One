import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { promisify } from "node:util";

import {
  CANONICAL_ENVIRONMENT_DIRECTORY,
  CANONICAL_IMAGE_PATH,
  measureBindPathFromHost,
  TrustedProvisioningError,
  writeEnvironmentFileAtomically,
  type MeasuredQuota,
  type TrustedProvisioningDependencies,
  type VerifiedImage,
} from "./trusted-provisioning.js";
import type { UserSandboxEnvironmentBinding } from "./user-sandbox-environment.js";
import { allocateEnvironment, OUTER_ID_RANGE_BASE } from "./allocation.js";

const execute = promisify(execFile);
const RUNTIME_BIN = "/srv/opt/brai-agent-runtime/bin";
const STATUS_STORAGE = `${RUNTIME_BIN}/status-user-storage`;
const CHECK_HOST_ID_POOL = `${RUNTIME_BIN}/check-host-id-pool`;
const PROVISION_QUOTA = `${RUNTIME_BIN}/provision-project-quota`;
const PROVISION_ENGINE_IDENTITY = `${RUNTIME_BIN}/provision-user-engine-identity`;
const MEASURE_QUOTA = `${RUNTIME_BIN}/measure-project-quota`;
const VERIFIED_NSPAWN = `${RUNTIME_BIN}/verified-nspawn`;
const NSPAWN = "/usr/bin/systemd-nspawn";
const MINIMAL_ENV = {
  PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
  LC_ALL: "C",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function run(
  executable: string,
  arguments_: readonly string[],
): Promise<string> {
  const result = await execute(executable, [...arguments_], {
    encoding: "utf8",
    env: MINIMAL_ENV,
    maxBuffer: 256 * 1_024,
    timeout: 120_000,
  });
  return result.stdout;
}

function parseJson(value: string, description: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new TrustedProvisioningError(
      "PROVISIONING_PREFLIGHT_FAILED",
      `${description} did not return valid JSON.`,
    );
  }
}

const READ_ONLY_PATH_ALIAS_WARNING =
  "WARNING: proceeding, even though we could not create PATH aliases: Read-only file system (os error 30)";

export function parseGuestProbeOutput(value: string): unknown {
  const lines = value.split(/\r?\n/u).filter((line) => line.length > 0);
  if (
    lines.length === 2 &&
    lines[0] === READ_ONLY_PATH_ALIAS_WARNING &&
    lines[1] !== undefined
  ) {
    return parseJson(lines[1], "guest runtime probe");
  }
  return parseJson(value, "guest runtime probe");
}

export async function verifyCanonicalSandboxImage(): Promise<VerifiedImage> {
  const value = parseJson(
    await run(VERIFIED_NSPAWN, [
      `--image=${CANONICAL_IMAGE_PATH}`,
      "--verify-only",
    ]),
    "verified-nspawn",
  );
  if (
    !isRecord(value) ||
    value.path !== CANONICAL_IMAGE_PATH ||
    typeof value.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.sha256) ||
    value.descriptorVerified !== true
  ) {
    throw new TrustedProvisioningError(
      "PROVISIONING_PREFLIGHT_FAILED",
      "verified-nspawn returned invalid image evidence.",
    );
  }
  return {
    path: CANONICAL_IMAGE_PATH,
    sha256: value.sha256,
    descriptorVerified: true,
  };
}

export async function verifyUserSandboxLaunchBinding(
  binding: UserSandboxEnvironmentBinding,
): Promise<void> {
  const suffix = binding.environmentName.slice("brai-u-".length);
  const slot = Number.parseInt(suffix, 36);
  const expected = allocateEnvironment({
    userId: binding.userId,
    slot,
    policy: {
      storageRoot: "/srv/brai-user-data",
      outerIdRangeBase: OUTER_ID_RANGE_BASE,
      xfsProjectIdBase: 10_000,
    },
    quotaHardLimit: {
      bytes: binding.quotaBytes,
      inodes: binding.quotaInodes,
    },
  });
  if (
    !/^[0-9a-z]+$/u.test(suffix) ||
    expected.environmentName !== binding.environmentName ||
    expected.dataPath !== binding.dataPath ||
    expected.outerUidRange.start !== binding.outerRootUid ||
    expected.outerGidRange.start !== binding.outerRootGid ||
    expected.imageBraiUid !== binding.imageBraiUid ||
    expected.imageBraiGid !== binding.imageBraiGid ||
    expected.xfsProjectId !== binding.xfsProjectId
  ) {
    throw new TrustedProvisioningError(
      "PROVISIONING_MEASUREMENT_MISMATCH",
      "Per-launch binding does not rederive from the canonical slot allocation.",
    );
  }
  const [hostIdPool] = await Promise.all([
    run(CHECK_HOST_ID_POOL, []).then((value) =>
      parseJson(value, "per-launch host ID pool checker"),
    ),
    run(STATUS_STORAGE, []),
  ]);
  if (!isRecord(hostIdPool) || hostIdPool.ok !== true) {
    throw new TrustedProvisioningError(
      "PROVISIONING_PREFLIGHT_FAILED",
      "Host UID/GID/subid/allocator preflight failed.",
    );
  }
  const [quotaValue, _currentImageEvidence, data] = await Promise.all([
    run(MEASURE_QUOTA, [
      binding.environmentName,
      String(binding.xfsProjectId),
      String(binding.quotaBytes),
      String(binding.quotaInodes),
    ]).then((value) =>
      parseJson(value, "per-launch project quota measurement"),
    ),
    verifyCanonicalSandboxImage(),
    lstat(binding.dataPath),
  ]);
  const quota = quotaValue as Partial<MeasuredQuota>;
  if (
    quota.dataPath !== binding.dataPath ||
    quota.configuredProjectId !== binding.xfsProjectId ||
    quota.treeProjectId !== binding.xfsProjectId ||
    quota.projectInheritance !== true ||
    quota.enforcementActive !== true ||
    quota.byteHardLimit !== binding.quotaBytes ||
    quota.inodeHardLimit !== binding.quotaInodes ||
    !data.isDirectory() ||
    data.isSymbolicLink() ||
    data.uid !== binding.imageBraiUid ||
    data.gid !== binding.imageBraiGid ||
    (data.mode & 0o7777) !== 0o700
  ) {
    throw new TrustedProvisioningError(
      "PROVISIONING_MEASUREMENT_MISMATCH",
      "Per-launch environment, quota, image, or runtime-control measurement differs from the provisioned binding.",
    );
  }
  // BRAI_IMAGE_SHA256 is the immutable provisioning baseline recorded in the
  // environment receipt. The shared base image is a host-global runtime
  // artifact and may be atomically upgraded while every sandbox and launch
  // intake is stopped. Each launch verifies the current canonical image
  // descriptor above; it must not require per-user database rewrites or
  // per-user image copies.
}

async function verifyGuestToolchain(): Promise<void> {
  const value = parseGuestProbeOutput(
    await run(VERIFIED_NSPAWN, [
      `--image=${CANONICAL_IMAGE_PATH}`,
      "--",
      NSPAWN,
      "--quiet",
      "--settings=no",
      "--register=no",
      "--read-only",
      "--private-network",
      "--as-pid2",
      "/usr/libexec/brai/probe-guest-runtime",
    ]),
  );
  if (
    !isRecord(value) ||
    value.persistenceRoot !== "/data" ||
    !isRecord(value.brai) ||
    value.brai.uid !== 1_000 ||
    value.brai.gid !== 1_000 ||
    value.networkDriver !== "slirp4netns" ||
    value.storageDriver !== "fuse-overlayfs" ||
    !isRecord(value.toolchain) ||
    value.toolchain.nodePath !== "/opt/brai/node/bin/node" ||
    value.toolchain.nodeVersion !== "v22.22.3" ||
    value.toolchain.codexPath !== "/opt/brai/codex/bin/codex" ||
    value.toolchain.codexVersion !== "codex-cli 0.144.5" ||
    value.toolchain.dockerVersion !== "29.1.3" ||
    value.toolchain.sqlitePath !== "/usr/bin/sqlite3" ||
    value.toolchain.postgresInitdbPath !== "/usr/lib/postgresql/16/bin/initdb"
  ) {
    throw new TrustedProvisioningError(
      "PROVISIONING_PREFLIGHT_FAILED",
      "Digest-bound guest toolchain differs from the immutable image contract.",
    );
  }
}

async function verifyEnvironmentDirectory(): Promise<void> {
  const metadata = await lstat(CANONICAL_ENVIRONMENT_DIRECTORY);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    metadata.uid !== 0 ||
    metadata.gid !== 0 ||
    (metadata.mode & 0o777) !== 0o700
  ) {
    throw new TrustedProvisioningError(
      "PROVISIONING_PREFLIGHT_FAILED",
      "Environment-file directory must be root:root 0700.",
    );
  }
}

export function createHostProvisioningDependencies(
  now: () => Date = () => new Date(),
): TrustedProvisioningDependencies {
  if (process.geteuid?.() !== 0) {
    throw new TrustedProvisioningError(
      "PROVISIONING_PREFLIGHT_FAILED",
      "Host provisioning adapter must run as root.",
    );
  }
  return {
    preflight: async () => {
      await run(STATUS_STORAGE, []);
      const hostIdPool = parseJson(
        await run(CHECK_HOST_ID_POOL, []),
        "host ID pool checker",
      );
      if (!isRecord(hostIdPool) || hostIdPool.ok !== true) {
        throw new Error("host ID pool is not ready");
      }
      await verifyCanonicalSandboxImage();
      await verifyGuestToolchain();
      await verifyEnvironmentDirectory();
    },
    provisionQuota: async (target) => {
      await run(PROVISION_ENGINE_IDENTITY, [
        target.environmentName,
        String(target.imageBraiUid),
        String(target.imageBraiGid),
        String(target.innerSubuidRange.start),
        String(target.innerSubuidRange.count),
      ]);
      await run(PROVISION_QUOTA, [
        target.environmentName,
        String(target.xfsProjectId),
        String(target.imageBraiUid),
        String(target.imageBraiGid),
        String(target.quotaHardLimit.bytes),
        String(target.quotaHardLimit.inodes),
      ]);
    },
    measureQuota: async (target) => {
      const value = parseJson(
        await run(MEASURE_QUOTA, [
          target.environmentName,
          String(target.xfsProjectId),
          String(target.quotaHardLimit.bytes),
          String(target.quotaHardLimit.inodes),
        ]),
        "project quota measurement",
      );
      return value as MeasuredQuota;
    },
    measureBindPath: measureBindPathFromHost,
    verifyImage: verifyCanonicalSandboxImage,
    writeEnvironmentFile: async (environmentName, content) => {
      await writeEnvironmentFileAtomically(
        CANONICAL_ENVIRONMENT_DIRECTORY,
        environmentName,
        content,
      );
      const metadata = await lstat(
        `${CANONICAL_ENVIRONMENT_DIRECTORY}/${environmentName}.env`,
      );
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.uid !== 0 ||
        metadata.gid !== 0 ||
        (metadata.mode & 0o777) !== 0o600
      ) {
        throw new TrustedProvisioningError(
          "PROVISIONING_ENVIRONMENT_FILE_CONFLICT",
          "Installed environment file metadata is untrusted.",
        );
      }
    },
    now,
  };
}
