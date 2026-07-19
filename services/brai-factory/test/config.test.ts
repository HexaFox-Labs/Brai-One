import { describe, expect, it } from "vitest";

import { readFactoryConfig } from "../src/config.js";

const baseEnvironment = {
  DATABASE_SSL: "disable",
  DATABASE_URL: "postgresql://factory:secret@database:5432/postgres",
  LOG_LEVEL: "silent",
  NATS_PASSWORD: "secret",
  NATS_SERVERS: "nats://brai-nats:4222",
  NATS_USER: "factory",
} satisfies NodeJS.ProcessEnv;

describe("brai-factory config", () => {
  it("keeps database waits below the Gateway request timeout", () => {
    const config = readFactoryConfig(baseEnvironment);

    expect(config.database).toMatchObject({
      connectionTimeoutMillis: 3_000,
      query_timeout: 4_000,
      statement_timeout: 4_000,
    });
  });

  it("rejects a query timeout that can outlive the NATS request", () => {
    expect(() =>
      readFactoryConfig({
        ...baseEnvironment,
        DATABASE_QUERY_TIMEOUT_MS: "5000",
      }),
    ).toThrow();
  });
});
