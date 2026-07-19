import {
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign,
  verify,
  type KeyLike,
} from "node:crypto";

import {
  MAX_ENVIRONMENT_PROVISION_CONTRACT_LIFETIME_MS,
  environmentProvisionContractSchema,
  environmentProvisionReservationSchema,
  type EnvironmentProvisionContract,
  type EnvironmentProvisionReservation,
} from "@brai/contracts";

const textEncoder = new TextEncoder();

export class EnvironmentProvisionContractError extends Error {
  public constructor(
    public readonly code:
      | "provision_contract_invalid"
      | "provision_contract_expired"
      | "provision_contract_key_unknown"
      | "provision_contract_signature_invalid",
    message: string,
  ) {
    super(message);
    this.name = "EnvironmentProvisionContractError";
  }
}

type UnsignedEnvironmentProvisionContract = Omit<
  EnvironmentProvisionContract,
  "signature"
>;

export interface IssueEnvironmentProvisionContractInput {
  readonly reservation: EnvironmentProvisionReservation;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly keyId: string;
  readonly privateKey: KeyLike;
}

export interface VerifyEnvironmentProvisionContractOptions {
  readonly now?: Date;
  readonly clockSkewMs?: number;
  readonly resolvePublicKey: (keyId: string) => KeyLike | undefined;
}

function contractError(
  code: EnvironmentProvisionContractError["code"],
  message: string,
): EnvironmentProvisionContractError {
  return new EnvironmentProvisionContractError(code, message);
}

function privateEd25519Key(key: KeyLike): KeyObject {
  try {
    const parsed = key instanceof KeyObject ? key : createPrivateKey(key);
    if (parsed.type !== "private" || parsed.asymmetricKeyType !== "ed25519") {
      throw new Error("not an Ed25519 private key");
    }
    return parsed;
  } catch {
    throw contractError(
      "provision_contract_invalid",
      "Provision signing key must be a private Ed25519 key.",
    );
  }
}

function publicEd25519Key(key: KeyLike): KeyObject {
  try {
    const parsed = key instanceof KeyObject ? key : createPublicKey(key);
    if (parsed.type !== "public" || parsed.asymmetricKeyType !== "ed25519") {
      throw new Error("not an Ed25519 public key");
    }
    return parsed;
  } catch {
    throw contractError(
      "provision_contract_invalid",
      "Provision verification key must be a public Ed25519 key.",
    );
  }
}

function assertLifetime(issuedAt: string, expiresAt: string): void {
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    expires <= issued ||
    expires - issued > MAX_ENVIRONMENT_PROVISION_CONTRACT_LIFETIME_MS
  ) {
    throw contractError(
      "provision_contract_invalid",
      "Provision contract lifetime is invalid.",
    );
  }
}

export function environmentProvisionContractSigningBytes(
  contract: UnsignedEnvironmentProvisionContract,
): Uint8Array {
  const {
    issued_at: issuedAt,
    expires_at: expiresAt,
    key_id: keyId,
    ...reservationInput
  } = contract;
  const reservation =
    environmentProvisionReservationSchema.parse(reservationInput);
  return textEncoder.encode(
    JSON.stringify([
      reservation.schema_version,
      reservation.reservation_id,
      reservation.user_id,
      reservation.environment_id,
      reservation.runtime_host_id,
      String(reservation.provision_generation),
      String(reservation.access_generation),
      String(reservation.allocation_slot),
      reservation.environment_name,
      String(reservation.outer_id_range_start),
      String(reservation.outer_id_range_count),
      String(reservation.image_brai_uid),
      String(reservation.image_brai_gid),
      String(reservation.inner_subuid_start),
      String(reservation.inner_subgid_start),
      String(reservation.inner_subid_count),
      String(reservation.xfs_project_id),
      reservation.storage_path,
      reservation.storage_mount_point,
      String(reservation.quota_bytes),
      String(reservation.quota_inodes),
      issuedAt,
      expiresAt,
      keyId,
    ]),
  );
}

export function issueEnvironmentProvisionContract(
  input: IssueEnvironmentProvisionContractInput,
): EnvironmentProvisionContract {
  const reservation = environmentProvisionReservationSchema.parse(
    input.reservation,
  );
  const unsigned = {
    ...reservation,
    issued_at: input.issuedAt.toISOString(),
    expires_at: input.expiresAt.toISOString(),
    key_id: input.keyId,
  } satisfies UnsignedEnvironmentProvisionContract;
  assertLifetime(unsigned.issued_at, unsigned.expires_at);
  const signature = sign(
    null,
    environmentProvisionContractSigningBytes(unsigned),
    privateEd25519Key(input.privateKey),
  ).toString("base64url");
  const parsed = environmentProvisionContractSchema.safeParse({
    ...unsigned,
    signature,
  });
  if (!parsed.success) {
    throw contractError(
      "provision_contract_invalid",
      "Provision contract structure is invalid.",
    );
  }
  return parsed.data;
}

export function verifyEnvironmentProvisionContract(
  input: unknown,
  options: VerifyEnvironmentProvisionContractOptions,
): EnvironmentProvisionContract {
  const parsed = environmentProvisionContractSchema.safeParse(input);
  if (!parsed.success) {
    throw contractError(
      "provision_contract_invalid",
      "Provision contract structure is invalid.",
    );
  }
  const contract = parsed.data;
  assertLifetime(contract.issued_at, contract.expires_at);
  const clockSkewMs = options.clockSkewMs ?? 5_000;
  if (
    !Number.isSafeInteger(clockSkewMs) ||
    clockSkewMs < 0 ||
    clockSkewMs > 30_000
  ) {
    throw contractError(
      "provision_contract_invalid",
      "Provision clock skew is invalid.",
    );
  }
  const now = (options.now ?? new Date()).getTime();
  if (
    !Number.isFinite(now) ||
    Date.parse(contract.issued_at) > now + clockSkewMs ||
    Date.parse(contract.expires_at) <= now - clockSkewMs
  ) {
    throw contractError(
      "provision_contract_expired",
      "Provision contract is not active.",
    );
  }
  const publicKey = options.resolvePublicKey(contract.key_id);
  if (publicKey === undefined) {
    throw contractError(
      "provision_contract_key_unknown",
      "Provision signing key is unknown.",
    );
  }
  const { signature, ...unsigned } = contract;
  if (
    !verify(
      null,
      environmentProvisionContractSigningBytes(unsigned),
      publicEd25519Key(publicKey),
      Buffer.from(signature, "base64url"),
    )
  ) {
    throw contractError(
      "provision_contract_signature_invalid",
      "Provision contract signature is invalid.",
    );
  }
  return contract;
}
