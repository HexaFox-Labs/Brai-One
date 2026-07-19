import { createPrivateKey, KeyObject, sign, type KeyLike } from "node:crypto";

import {
  signedTrustedReceiptEnvelopeSchema,
  unsignedTrustedReceiptEnvelopeSchema,
  type SignedTrustedReceiptEnvelope,
  type TrustedReceiptPurpose,
} from "@brai/contracts";

const textEncoder = new TextEncoder();

export type TrustedReceiptPrivateKey = KeyLike;

export type UnsignedTrustedReceiptEnvelope = Readonly<{
  version: 1;
  purpose: TrustedReceiptPurpose;
  key_id: string;
  payload: string;
}>;

export function trustedReceiptEnvelopeSigningBytes(
  envelope: UnsignedTrustedReceiptEnvelope,
): Uint8Array {
  const parsed = unsignedTrustedReceiptEnvelopeSchema.parse(envelope);
  return textEncoder.encode(
    JSON.stringify([
      parsed.version,
      parsed.purpose,
      parsed.key_id,
      parsed.payload,
    ]),
  );
}

function privateEd25519Key(key: TrustedReceiptPrivateKey): KeyObject {
  const parsed = key instanceof KeyObject ? key : createPrivateKey(key);
  if (parsed.type !== "private" || parsed.asymmetricKeyType !== "ed25519") {
    throw new Error("Trusted receipt key must be private Ed25519");
  }
  return parsed;
}

export function signTrustedReceiptEnvelope(
  purpose: TrustedReceiptPurpose,
  payload: unknown,
  options: Readonly<{
    keyId: string;
    privateKey: TrustedReceiptPrivateKey;
  }>,
): SignedTrustedReceiptEnvelope {
  const unsigned = {
    version: 1 as const,
    purpose,
    key_id: options.keyId,
    payload: JSON.stringify(payload),
  };
  const signature = sign(
    null,
    trustedReceiptEnvelopeSigningBytes(unsigned),
    privateEd25519Key(options.privateKey),
  ).toString("base64url");
  return signedTrustedReceiptEnvelopeSchema.parse({
    ...unsigned,
    signature,
  });
}
