import { createPublicKey, KeyObject, verify, type KeyLike } from "node:crypto";

import {
  trustedReceiptEnvelopeSigningBytes as canonicalReceiptSigningBytes,
  type UnsignedTrustedReceiptEnvelope,
} from "@brai/agent-access";
import {
  TRUSTED_RECEIPT_PURPOSES,
  signedTrustedReceiptEnvelopeSchema,
  type SignedTrustedReceiptEnvelope,
  type TrustedReceiptPurpose,
} from "@brai/contracts";

import { AccessServiceError } from "./errors.js";

export {
  TRUSTED_RECEIPT_PURPOSES,
  type SignedTrustedReceiptEnvelope,
  type TrustedReceiptPurpose,
};

export type TrustedReceiptPublicKey = KeyLike;
export type TrustedReceiptPublicKeyResolver = (
  keyId: string,
) => TrustedReceiptPublicKey | undefined;

export type { UnsignedTrustedReceiptEnvelope };

/**
 * Exact cross-process signing bytes. The payload is an opaque JSON string, so
 * its original bytes are authenticated before JSON parsing.
 */
export function trustedReceiptEnvelopeSigningBytes(
  envelope: UnsignedTrustedReceiptEnvelope,
): Uint8Array {
  return canonicalReceiptSigningBytes(envelope);
}

function publicEd25519Key(key: TrustedReceiptPublicKey): KeyObject {
  try {
    const parsed = key instanceof KeyObject ? key : createPublicKey(key);
    if (parsed.type !== "public" || parsed.asymmetricKeyType !== "ed25519") {
      throw new Error("not an Ed25519 public key");
    }
    return parsed;
  } catch (error) {
    throw new AccessServiceError(
      "access_trusted_context_required",
      "Configured trusted receipt key is not a public Ed25519 key",
      { cause: error },
    );
  }
}

export function verifyTrustedReceiptEnvelope(
  input: unknown,
  expectedPurpose: TrustedReceiptPurpose,
  resolvePublicKey: TrustedReceiptPublicKeyResolver,
): unknown {
  const parsed = signedTrustedReceiptEnvelopeSchema.safeParse(input);
  if (!parsed.success || parsed.data.purpose !== expectedPurpose) {
    throw new AccessServiceError(
      "access_trusted_context_required",
      "Trusted receipt envelope is malformed or has the wrong purpose",
      { cause: parsed.success ? undefined : parsed.error },
    );
  }
  const envelope = parsed.data;
  const key = resolvePublicKey(envelope.key_id);
  if (key === undefined) {
    throw new AccessServiceError(
      "access_trusted_context_required",
      "Trusted receipt signing key is unknown",
    );
  }

  const valid = verify(
    null,
    trustedReceiptEnvelopeSigningBytes({
      version: envelope.version,
      purpose: envelope.purpose,
      key_id: envelope.key_id,
      payload: envelope.payload,
    }),
    publicEd25519Key(key),
    Buffer.from(envelope.signature, "base64url"),
  );
  if (!valid) {
    throw new AccessServiceError(
      "access_trusted_context_required",
      "Trusted receipt signature is invalid",
    );
  }

  try {
    return JSON.parse(envelope.payload) as unknown;
  } catch (error) {
    throw new AccessServiceError(
      "access_trusted_context_required",
      "Signed trusted receipt payload is not JSON",
      { cause: error },
    );
  }
}
