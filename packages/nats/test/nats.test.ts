import type { Msg, NatsConnection } from "@nats-io/nats-core";
import { describe, expect, it, vi } from "vitest";

import { decodeJson, encodeJson, requestJson } from "../src/index.js";
import type { NatsRequestError } from "../src/index.js";

describe("NATS JSON helpers", () => {
  it("round-trips UTF-8 JSON", () => {
    const value = { title: "Новая активность" };
    expect(decodeJson(encodeJson(value))).toEqual(value);
  });

  it("performs one request with the explicit timeout", async () => {
    const request = vi.fn().mockResolvedValue({
      data: encodeJson({ ok: true }),
    } satisfies Partial<Msg>);
    const connection = { request } as unknown as NatsConnection;

    await expect(
      requestJson(connection, "brai.test", { value: 1 }, { timeoutMs: 123 }),
    ).resolves.toEqual({ ok: true });

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("brai.test", expect.any(Uint8Array), {
      timeout: 123,
    });
  });

  it("labels invalid response JSON as a protocol error", async () => {
    const request = vi.fn().mockResolvedValue({
      data: new TextEncoder().encode("{"),
    } satisfies Partial<Msg>);
    const connection = { request } as unknown as NatsConnection;

    await expect(
      requestJson(connection, "brai.test", {}),
    ).rejects.toMatchObject<NatsRequestError>({
      kind: "protocol_error",
      subject: "brai.test",
    });
    expect(request).toHaveBeenCalledOnce();
  });
});
