import type { NatsConnection } from "@brai/nats";
import { describe, expect, it, vi } from "vitest";

import { createGatewayMessageBus } from "../src/bus.js";

function connection(overrides: Partial<NatsConnection> = {}): NatsConnection {
  return {
    drain: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
    isDraining: vi.fn().mockReturnValue(false),
    request: vi.fn(),
    rtt: vi.fn().mockResolvedValue(1),
    ...overrides,
  } as unknown as NatsConnection;
}

describe("Gateway NATS readiness", () => {
  it("confirms an active round trip to NATS", async () => {
    const nats = connection();
    const bus = createGatewayMessageBus(nats, 5_000);

    await expect(bus.isReady()).resolves.toBe(true);
    expect(nats.rtt).toHaveBeenCalledOnce();
  });

  it("is not ready when the NATS connection is disconnected", async () => {
    const nats = connection({
      rtt: vi.fn().mockRejectedValue(new Error("disconnected")),
    });
    const bus = createGatewayMessageBus(nats, 5_000);

    await expect(bus.isReady()).resolves.toBe(false);
  });

  it("does not probe a closed connection", async () => {
    const rtt = vi.fn();
    const nats = connection({
      isClosed: vi.fn().mockReturnValue(true),
      rtt,
    });
    const bus = createGatewayMessageBus(nats, 5_000);

    await expect(bus.isReady()).resolves.toBe(false);
    expect(rtt).not.toHaveBeenCalled();
  });
});
