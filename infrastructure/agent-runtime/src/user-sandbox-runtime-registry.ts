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
  PreparedUserSandboxRuntimeRecovery,
  UserSandboxRuntimeLaunchReceipt,
} from "./user-sandbox-runtime.js";

export const USER_SANDBOX_RUNTIME_REGISTRY_ROOT =
  "/var/lib/brai-agent-runtime/user-sandbox-runs";
export const USER_SANDBOX_RUNTIME_REGISTRY_SCHEMA_VERSION = 1 as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestampSchema = z.string().refine((value) => {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
});
const decimalSchema = z.string().regex(/^[1-9][0-9]*$/u);

const localIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    profile: z.literal("user-sandbox"),
    runId: z.string().regex(UUID_PATTERN),
    jobDigestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    environmentId: z.string().regex(UUID_PATTERN),
    userId: z.string().regex(UUID_PATTERN),
    accessGeneration: z.number().int().positive(),
    environmentName: z.string().regex(/^brai-u-[0-9a-z]+$/u),
    machineName: z.string().regex(/^brai-u-[0-9a-z]+$/u),
    unitName: z.string().regex(/^brai-sandbox-agent-[0-9a-f-]+\.service$/u),
    innerMainPid: z.number().int().positive().max(4_194_304),
    bootId: z.string().regex(UUID_PATTERN),
    invocationId: z.string().regex(/^[a-f0-9]{32}$/u),
    controlGroup: z.string().startsWith("/").max(4_096),
    controlGroupInode: decimalSchema,
    mainPid: z.number().int().positive().max(4_194_304),
    mainPidStartTimeTicks: decimalSchema,
    outerRootUid: z.number().int().positive(),
    imageBraiUid: z.number().int().positive(),
    systemd: z
      .object({
        user: z.literal("root"),
        group: z.literal("root"),
        workingDirectory: z.literal("/data/workspace"),
        umask: z.literal("0077"),
        killMode: z.literal("control-group"),
        noNewPrivileges: z.literal(true),
        remainAfterExit: z.literal(true),
      })
      .strict()
      .readonly(),
  })
  .strict()
  .superRefine((identity, context) => {
    if (
      identity.machineName !== identity.environmentName ||
      identity.imageBraiUid !== identity.outerRootUid + 1_000 ||
      identity.unitName !== `brai-sandbox-agent-${identity.runId}.service`
    ) {
      context.addIssue({
        code: "custom",
        message: "Sandbox local identity contains crossed bindings",
      });
    }
  })
  .readonly();

const launchReceiptSchema = z
  .object({
    kind: z.literal("user-sandbox-runtime-launched"),
    schemaVersion: z.literal(1),
    observedAt: timestampSchema,
    identity: localIdentitySchema,
  })
  .strict()
  .readonly();

const gateSchema = z
  .object({
    fifoHostPath: z.string().min(1).max(4_096),
    readyHostPath: z.string().min(1).max(4_096),
    stdinHostPath: z.string().min(1).max(4_096),
    fifoGuestPath: z.string().min(1).max(4_096),
    readyGuestPath: z.string().min(1).max(4_096),
    stdinGuestPath: z.string().min(1).max(4_096),
    token: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict()
  .readonly();

const recoverySchema = z
  .object({
    launchReceipt: launchReceiptSchema,
    gate: gateSchema,
  })
  .strict()
  .readonly();

export const userSandboxRunRegistryRecordSchema = z
  .object({
    schema_version: z.literal(USER_SANDBOX_RUNTIME_REGISTRY_SCHEMA_VERSION),
    kind: z.literal("user-sandbox-runtime"),
    run_id: z.string().regex(UUID_PATTERN),
    phase: z.enum([
      "held",
      "claimed",
      "released",
      "started",
      "exit-observed",
      "exited",
      "terminated",
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
    const identity = record.recovery.launchReceipt.identity;
    if (
      record.run_id !== record.launch_contract.run_id ||
      record.run_id !== identity.runId ||
      record.launch_contract.environment_id !== identity.environmentId ||
      record.launch_contract.access.user_id !== identity.userId ||
      record.launch_contract.access.access_generation !==
        identity.accessGeneration
    ) {
      context.addIssue({
        code: "custom",
        message: "Sandbox registry contains crossed run bindings",
      });
    }
  })
  .readonly();

export type UserSandboxRunRegistryRecord = z.infer<
  typeof userSandboxRunRegistryRecordSchema
>;

export const userSandboxRunCancellationRecordSchema = z
  .object({
    schema_version: z.literal(USER_SANDBOX_RUNTIME_REGISTRY_SCHEMA_VERSION),
    kind: z.literal("user-sandbox-cancellation"),
    run_id: z.string().regex(UUID_PATTERN),
    project_id: z.string().regex(UUID_PATTERN),
    user_id: z.string().regex(UUID_PATTERN),
    environment_id: z.string().regex(UUID_PATTERN),
    access_generation: z.number().int().positive(),
    termination_receipt: signedTrustedReceiptEnvelopeSchema.refine(
      (receipt) => receipt.purpose === "runtime-termination-v2",
    ),
    updated_at: timestampSchema,
  })
  .strict()
  .readonly();

export type UserSandboxRunCancellationRecord = z.infer<
  typeof userSandboxRunCancellationRecordSchema
>;
export type UserSandboxRunRegistryEntry =
  UserSandboxRunRegistryRecord | UserSandboxRunCancellationRecord;

const entrySchema = z.union([
  userSandboxRunRegistryRecordSchema,
  userSandboxRunCancellationRecordSchema,
]);

export interface UserSandboxRunRegistry {
  get(runId: string): Promise<UserSandboxRunRegistryEntry | null>;
  put(record: UserSandboxRunRegistryEntry): Promise<void>;
  listRecoverable(): Promise<readonly UserSandboxRunRegistryRecord[]>;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export class FilesystemUserSandboxRunRegistry implements UserSandboxRunRegistry {
  public constructor(
    private readonly root = USER_SANDBOX_RUNTIME_REGISTRY_ROOT,
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
        "Sandbox runtime registry must be a root-owned directory.",
      );
    }
    await chmod(this.root, 0o700);
  }

  #path(runId: string): string {
    if (!UUID_PATTERN.test(runId)) {
      throw new Error("Sandbox registry requires a canonical run UUID.");
    }
    return `${this.root}/${runId}.json`;
  }

  public async get(runId: string): Promise<UserSandboxRunRegistryEntry | null> {
    await this.#ensureRoot();
    const path = this.#path(runId);
    try {
      const metadata = await lstat(path);
      if (
        metadata.isSymbolicLink() ||
        !metadata.isFile() ||
        (metadata.mode & 0o7777) !== 0o600 ||
        (this.requireRootOwnership &&
          (metadata.uid !== 0 || metadata.gid !== 0))
      ) {
        throw new Error("Sandbox registry file metadata is invalid.");
      }
      return entrySchema.parse(
        JSON.parse(await readFile(path, "utf8")) as unknown,
      );
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  public async put(record: UserSandboxRunRegistryEntry): Promise<void> {
    await this.#ensureRoot();
    const parsed = entrySchema.parse(record);
    const temporary = `${this.root}/.${parsed.run_id}.${randomUUID()}.tmp`;
    const file = await open(
      temporary,
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
    await rename(temporary, this.#path(parsed.run_id));
    await chmod(this.#path(parsed.run_id), 0o600);
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
    readonly UserSandboxRunRegistryRecord[]
  > {
    await this.#ensureRoot();
    const names = (await readdir(this.root))
      .filter((name) => /^[0-9a-f-]+\.json$/u.test(name))
      .sort();
    const entries = await Promise.all(
      names.map((name) => this.get(name.slice(0, -5))),
    );
    return Object.freeze(
      entries.filter(
        (entry): entry is UserSandboxRunRegistryRecord =>
          entry?.kind === "user-sandbox-runtime" &&
          !["exited", "terminated"].includes(entry.phase),
      ),
    );
  }
}

export type {
  InternalAgentLaunchContract,
  PreparedUserSandboxRuntimeRecovery,
  SignedTrustedReceiptEnvelope,
  UserSandboxRuntimeLaunchReceipt,
};
