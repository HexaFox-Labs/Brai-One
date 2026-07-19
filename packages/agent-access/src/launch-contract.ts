import {
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign,
  verify,
  type KeyLike,
} from "node:crypto";

import {
  BRAI_SINGLE_RUNTIME_HOST_ID,
  INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
  MAX_AGENT_LAUNCH_CONTRACT_LIFETIME_MS,
  immutableAgentJobSchema,
  internalAgentLaunchContractSchema,
  launchAccessSnapshotSchema,
  type ImmutableAgentJob,
  type InternalAgentLaunchContract,
  type LaunchAccessSnapshot,
} from "@brai/contracts";

import { AgentAccessError } from "./errors.js";

const textEncoder = new TextEncoder();

export type LaunchContractPrivateKey = KeyLike;
export type LaunchContractPublicKey = KeyLike;

export interface IssueLaunchContractInput {
  readonly runId: string;
  readonly projectId: string;
  readonly environmentId: string | null;
  readonly job: ImmutableAgentJob;
  readonly access: LaunchAccessSnapshot;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly keyId: string;
  readonly privateKey: LaunchContractPrivateKey;
}

export interface VerifyLaunchContractOptions {
  readonly now?: Date;
  readonly clockSkewMs?: number;
  readonly resolvePublicKey: (
    keyId: string,
  ) => LaunchContractPublicKey | undefined;
}

type UnsignedLaunchContract = Omit<InternalAgentLaunchContract, "signature">;

function invalidContract(message: string): AgentAccessError {
  return new AgentAccessError("launch_contract_invalid", message);
}

function parseTimestamp(value: string, field: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw invalidContract(`Некорректное время ${field}`);
  }
  return milliseconds;
}

function assertLifetime(
  issuedAt: string,
  expiresAt: string,
): { issuedAtMs: number; expiresAtMs: number } {
  const issuedAtMs = parseTimestamp(issuedAt, "issued_at");
  const expiresAtMs = parseTimestamp(expiresAt, "expires_at");
  const lifetime = expiresAtMs - issuedAtMs;

  if (lifetime <= 0 || lifetime > MAX_AGENT_LAUNCH_CONTRACT_LIFETIME_MS) {
    throw invalidContract(
      `Срок launch contract должен быть не больше ${MAX_AGENT_LAUNCH_CONTRACT_LIFETIME_MS} мс`,
    );
  }

  return { issuedAtMs, expiresAtMs };
}

/**
 * Stable signing representation. An ordered tuple avoids depending on object
 * property order or on an external canonical-JSON implementation.
 */
export function launchContractSigningBytes(
  contract: UnsignedLaunchContract,
): Uint8Array {
  const normalizedAccess = launchAccessSnapshotSchema.parse(contract.access);
  const values = [
    contract.schema_version,
    contract.run_id,
    contract.project_id,
    contract.environment_id ?? "",
    contract.runtime_host_id,
    contract.job.reference,
    contract.job.command_sha256,
    normalizedAccess.schema_version,
    normalizedAccess.user_id,
    normalizedAccess.profile,
    String(normalizedAccess.access_generation),
    String(normalizedAccess.quota.bytes),
    String(normalizedAccess.quota.inodes),
    contract.issued_at,
    contract.expires_at,
    contract.key_id,
  ] as const;

  return textEncoder.encode(JSON.stringify(values));
}

function asPrivateKey(key: LaunchContractPrivateKey): KeyObject {
  const parsed = key instanceof KeyObject ? key : createPrivateKey(key);
  if (parsed.asymmetricKeyType !== "ed25519" || parsed.type !== "private") {
    throw invalidContract(
      "Launch signing key должен быть приватным Ed25519 key",
    );
  }
  return parsed;
}

function asPublicKey(key: LaunchContractPublicKey): KeyObject {
  const parsed = key instanceof KeyObject ? key : createPublicKey(key);
  if (parsed.asymmetricKeyType !== "ed25519" || parsed.type !== "public") {
    throw invalidContract(
      "Launch verification key должен быть публичным Ed25519 key",
    );
  }
  return parsed;
}

export function issueInternalAgentLaunchContract(
  input: IssueLaunchContractInput,
): InternalAgentLaunchContract {
  const unsigned = {
    schema_version: INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
    run_id: input.runId,
    project_id: input.projectId,
    environment_id: input.environmentId,
    runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
    job: immutableAgentJobSchema.parse(input.job),
    access: launchAccessSnapshotSchema.parse(input.access),
    issued_at: input.issuedAt.toISOString(),
    expires_at: input.expiresAt.toISOString(),
    key_id: input.keyId,
  } as const;

  assertLifetime(unsigned.issued_at, unsigned.expires_at);
  const signature = sign(
    null,
    launchContractSigningBytes(unsigned),
    asPrivateKey(input.privateKey),
  ).toString("base64url");

  const parsed = internalAgentLaunchContractSchema.safeParse({
    ...unsigned,
    signature,
  });
  if (!parsed.success) {
    throw invalidContract("Некорректные immutable launch bindings");
  }
  return parsed.data;
}

export function verifyInternalAgentLaunchContract(
  input: unknown,
  options: VerifyLaunchContractOptions,
): InternalAgentLaunchContract {
  const parsed = internalAgentLaunchContractSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidContract("Некорректная структура launch contract");
  }

  const contract = parsed.data;
  const { issuedAtMs, expiresAtMs } = assertLifetime(
    contract.issued_at,
    contract.expires_at,
  );
  const clockSkewMs = options.clockSkewMs ?? 5_000;
  if (
    !Number.isSafeInteger(clockSkewMs) ||
    clockSkewMs < 0 ||
    clockSkewMs > 30_000
  ) {
    throw invalidContract("Некорректный допустимый clock skew");
  }

  const nowMs = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(nowMs)) {
    throw invalidContract("Некорректное текущее время");
  }
  if (issuedAtMs > nowMs + clockSkewMs || expiresAtMs <= nowMs - clockSkewMs) {
    throw new AgentAccessError(
      "launch_contract_expired",
      "Launch contract ещё не действует или уже истёк",
    );
  }

  const publicKey = options.resolvePublicKey(contract.key_id);
  if (publicKey === undefined) {
    throw new AgentAccessError(
      "launch_contract_key_unknown",
      "Signing key launch contract неизвестен",
    );
  }

  const { signature, ...unsigned } = contract;
  const signatureValid = verify(
    null,
    launchContractSigningBytes(unsigned),
    asPublicKey(publicKey),
    Buffer.from(signature, "base64url"),
  );
  if (!signatureValid) {
    throw new AgentAccessError(
      "launch_contract_signature_invalid",
      "Подпись launch contract недействительна",
    );
  }

  return contract;
}
