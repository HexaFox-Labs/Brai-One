import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  signTrustedReceiptEnvelope,
  trustedReceiptEnvelopeSigningBytes,
} from "../src/trusted-receipt-envelope.js";

describe("trusted receipt envelope signing", () => {
  it("signs the exact purpose, key and opaque JSON payload bytes", () => {
    const keys = generateKeyPairSync("ed25519");
    const receipt = signTrustedReceiptEnvelope(
      "runtime-started-v2",
      { runId: "4f88bde1-2b49-46cb-914d-7500afdf82d6" },
      { keyId: "runtime-key:2026-07", privateKey: keys.privateKey },
    );
    const { signature, ...unsigned } = receipt;
    expect(
      verify(
        null,
        trustedReceiptEnvelopeSigningBytes(unsigned),
        keys.publicKey,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });
});
