import { describe, expect, it } from "vitest";

import { loadGatewayConfig } from "../src/config.js";

describe("Gateway environment", () => {
  it("accepts normal process variables in addition to gateway settings", () => {
    const config = loadGatewayConfig({
      PATH: "/usr/local/bin:/usr/bin",
      HOSTNAME: "brai-api-gateway",
      NATS_SERVERS: "nats://brai-nats:4222",
      NATS_USER: "gateway",
      NATS_PASSWORD: "secret-value",
      PUBLIC_ORIGINS: "https://factory.brai.one, https://factory.brai.one/",
    });

    expect(config).toMatchObject({
      port: 3_201,
      natsServers: ["nats://brai-nats:4222"],
      publicOrigins: ["https://factory.brai.one"],
      allowLoopbackHosts: true,
      accessAuth: null,
    });
  });

  it("requires the complete trusted auth boundary when access API is enabled", () => {
    const base = {
      NATS_SERVERS: "nats://brai-nats:4222",
      NATS_USER: "gateway",
      NATS_PASSWORD: "secret-value",
      PUBLIC_ORIGINS: "https://admin.brightos.world",
      ACCESS_API_ENABLED: "true",
    };

    expect(() => loadGatewayConfig(base)).toThrow();
    expect(
      loadGatewayConfig({
        ...base,
        SUPABASE_AUTH_ISSUER: "https://auth.example.test/auth/v1",
        SUPABASE_AUTH_JWKS_URL:
          "http://supabase-auth:9999/.well-known/jwks.json",
        PLATFORM_ADMIN_HEADER_SECRET: "a".repeat(64),
        PLATFORM_ADMIN_ACTOR_ID: "5f76ab51-1c32-4ceb-8258-8ba1d85e1ed8",
      }).accessAuth,
    ).toMatchObject({
      audience: "authenticated",
      platformAdminActorId: "5f76ab51-1c32-4ceb-8258-8ba1d85e1ed8",
    });
  });
});
