import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
} from "node:fs/promises";

import {
  internalAgentLaunchContractSchema,
  signedTrustedReceiptEnvelopeSchema,
  type InternalAgentLaunchContract,
  type SignedTrustedReceiptEnvelope,
} from "@brai/contracts";
import { z } from "zod";

import type {
  DeveloperGateDescriptor,
  PreparedDeveloperRuntimeRecovery,
} from "./developer-runtime-gate.js";
import type { DeveloperRuntimeLaunchReceipt } from "./developer-runtime.js";

export const RUNTIME_HOST_REGISTRY_ROOT =
  "/var/lib/brai-agent-runtime/developer-runs";
export const RUNTIME_HOST_REGISTRY_SCHEMA_VERSION = 1 as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const timestampSchema = z.string().refine((value) => {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
});
const decimalSchema = z.string().regex(/^[1-9][0-9]*$/u);

const gateSchema = z
  .object({
    fifoPath: z
      .string()
      .regex(/^\/run\/brai-agent-runtime\/gates\/[0-9a-f-]+\.release$/u),
    readyPath: z
      .string()
      .regex(/^\/run\/brai-agent-runtime\/gates\/[0-9a-f-]+\.ready$/u),
    stdinPath: z
      .string()
      .regex(/^\/run\/brai-agent-runtime\/gates\/[0-9a-f-]+\.stdin$/u),
    token: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict()
  .readonly();

const localIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    profile: z.literal("developer"),
    runId: z.string().regex(UUID_PATTERN),
    jobDigestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    unitName: z.string().regex(/^brai-developer-agent-[0-9a-f-]+\.service$/u),
    bootId: z.string().regex(UUID_PATTERN),
    invocationId: z.string().regex(/^[a-f0-9]{32}$/u),
    controlGroup: z.string().startsWith("/").max(4_096),
    controlGroupInode: decimalSchema,
    mainPid: z.number().int().positive().max(4_194_304),
    mainPidStartTimeTicks: decimalSchema,
    uid: z.number().int().nonnegative(),
    gid: z.number().int().nonnegative(),
    supplementaryGids: z.array(z.number().int().nonnegative()).readonly(),
    systemd: z
      .object({
        user: z.literal("mark"),
        group: z.literal("mark"),
        workingDirectory: z.literal("/srv/projects/brai-new"),
        umask: z.literal("0077"),
        killMode: z.literal("control-group"),
        noNewPrivileges: z.literal(false),
      })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly();

const launchReceiptSchema = z
  .object({
    kind: z.literal("developer-runtime-launched"),
    schemaVersion: z.literal(1),
    observedAt: timestampSchema,
    identity: localIdentitySchema,
  })
  .strict()
  .readonly();

const recoverySchema = z
  .object({
    rawLaunchReceipt: launchReceiptSchema,
    mappedLaunchReceipt: launchReceiptSchema,
    gate: gateSchema,
  })
  .strict()
  .readonly();

export const developerRunRegistryRecordSchema = z
  .object({
    schema_version: z.literal(RUNTIME_HOST_REGISTRY_SCHEMA_VERSION),
    kind: z.literal("runtime"),
    run_id: z.string().regex(UUID_PATTERN),
    phase: z.enum([
      "held",
      "claimed",
      "released",
      "started",
      "exit-observed",
      "exited",
      "terminated",
      "failed",
    ]),
    launch_contract: internalAgentLaunchContractSchema,
    recovery: recoverySchema,
    claim_receipt: signedTrustedReceiptEnvelopeSchema.refine(
      (receipt) => receipt.purpose === "runtime-claim-v2",
    ),
    started_receipt: signedTrustedReceiptEnvelopeSchema
      .refine((receipt) => receipt.purpose === "runtime-started-v2")
      .nullable(),
    exit_receipt: signedTrustedReceiptEnvelopeSchema
      .refine((receipt) => receipt.purpose === "runtime-exit-v2")
      .nullable(),
    termination_receipt: signedTrustedReceiptEnvelopeSchema
      .refine((receipt) => receipt.purpose === "runtime-termination-v2")
      .nullable(),
    updated_at: timestampSchema,
  })
  .strict()
  .superRefine((record, context) => {
    const runId = record.run_id;
    if (
      record.launch_contract.run_id !== runId ||
      record.recovery.mappedLaunchReceipt.identity.runId !== runId ||
      record.recovery.rawLaunchReceipt.identity.runId !== runId ||
      record.recovery.gate.fifoPath !==
        `/run/brai-agent-runtime/gates/${runId}.release` ||
      record.recovery.gate.readyPath !==
        `/run/brai-agent-runtime/gates/${runId}.ready` ||
      record.recovery.gate.stdinPath !==
        `/run/brai-agent-runtime/gates/${runId}.stdin`
    ) {
      context.addIssue({
        code: "custom",
        message: "Registry record contains crossed run identities",
      });
    }
  })
  .readonly();

export type DeveloperRunRegistryRecord = z.infer<
  typeof developerRunRegistryRecordSchema
>;

export const developerRunCancellationRecordSchema = z
  .object({
    schema_version: z.literal(RUNTIME_HOST_REGISTRY_SCHEMA_VERSION),
    kind: z.literal("cancellation"),
    run_id: z.string().regex(UUID_PATTERN),
    project_id: z.string().regex(UUID_PATTERN),
    user_id: z.string().regex(UUID_PATTERN),
    access_generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    termination_receipt: signedTrustedReceiptEnvelopeSchema.refine(
      (receipt) => receipt.purpose === "runtime-termination-v2",
    ),
    updated_at: timestampSchema,
  })
  .strict()
  .readonly();

export type DeveloperRunCancellationRecord = z.infer<
  typeof developerRunCancellationRecordSchema
>;
export type DeveloperRunRegistryEntry =
  DeveloperRunRegistryRecord | DeveloperRunCancellationRecord;

const developerRunRegistryEntrySchema = z.union([
  developerRunRegistryRecordSchema,
  developerRunCancellationRecordSchema,
]);

export interface DeveloperRunRegistry {
  get(runId: string): Promise<DeveloperRunRegistryEntry | null>;
  put(record: DeveloperRunRegistryEntry): Promise<void>;
  listRecoverable(): Promise<readonly DeveloperRunRegistryRecord[]>;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export class FilesystemDeveloperRunRegistry implements DeveloperRunRegistry {
  public constructor(
    private readonly root = RUNTIME_HOST_REGISTRY_ROOT,
    private readonly requireRootOwnership = true,
  ) {}

  async #ensureRoot(): Promise<void> {
    let metadata;
    try {
      metadata = await lstat(this.root);
    } catch (error) {
      if (!isMissing(error)) throw error;
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      metadata = await lstat(this.root);
    }
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (this.requireRootOwnership && (metadata.uid !== 0 || metadata.gid !== 0))
    ) {
      throw new Error(
        "Runtime registry must be a root-owned non-symlink 0700 directory.",
      );
    }
    await chmod(this.root, 0o700);
  }

  #path(runId: string): string {
    if (!UUID_PATTERN.test(runId)) {
      throw new Error("Runtime registry requires a canonical run UUID.");
    }
    return `${this.root}/${runId}.json`;
  }

  async #validateFile(path: string): Promise<void> {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o7777) !== 0o600 ||
      (this.requireRootOwnership && (metadata.uid !== 0 || metadata.gid !== 0))
    ) {
      throw new Error("Runtime registry file ownership or mode is invalid.");
    }
  }

  public async get(runId: string): Promise<DeveloperRunRegistryEntry | null> {
    await this.#ensureRoot();
    const path = this.#path(runId);
    try {
      await this.#validateFile(path);
      return developerRunRegistryEntrySchema.parse(
        JSON.parse(await readFile(path, "utf8")) as unknown,
      );
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  public async put(record: DeveloperRunRegistryEntry): Promise<void> {
    await this.#ensureRoot();
    const parsed = developerRunRegistryEntrySchema.parse(record);
    const finalPath = this.#path(parsed.run_id);
    const temporaryPath = `${this.root}/.${parsed.run_id}.${randomUUID()}.tmp`;
    const file = await open(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(`${JSON.stringify(parsed)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, finalPath);
    await chmod(finalPath, 0o600);
    const directory = await open(
      this.root,
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  public async listRecoverable(): Promise<
    readonly DeveloperRunRegistryRecord[]
  > {
    await this.#ensureRoot();
    const names = (await readdir(this.root))
      .filter((name) => /^[0-9a-f-]+\.json$/u.test(name))
      .sort();
    const records = await Promise.all(
      names.map(async (name) => {
        const runId = name.slice(0, -".json".length);
        return await this.get(runId);
      }),
    );
    return Object.freeze(
      records.filter(
        (record): record is DeveloperRunRegistryRecord =>
          record !== null &&
          record.kind === "runtime" &&
          !["exited", "terminated"].includes(record.phase),
      ),
    );
  }
}

export type {
  DeveloperGateDescriptor,
  DeveloperRuntimeLaunchReceipt,
  InternalAgentLaunchContract,
  PreparedDeveloperRuntimeRecovery,
  SignedTrustedReceiptEnvelope,
};
