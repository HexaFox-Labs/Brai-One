import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { checkDatabase } from "../src/database.js";

describe("brai-factory database health", () => {
  it("accepts an isolated runtime role", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ isolated: true }] });

    await expect(
      checkDatabase({ query } as unknown as Pool),
    ).resolves.toBeUndefined();
  });

  it("rejects role drift that exposes pg_net", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ isolated: false }] });

    await expect(checkDatabase({ query } as unknown as Pool)).rejects.toThrow(
      "role isolation",
    );
  });
});
