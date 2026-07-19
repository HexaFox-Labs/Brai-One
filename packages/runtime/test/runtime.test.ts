import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  EnvironmentValidationError,
  generateUuid,
  isUuid,
  requireEnv,
} from "../src/index.js";

describe("runtime helpers", () => {
  it("generates and validates UUID v4 identifiers", () => {
    expect(isUuid(generateUuid())).toBe(true);
    expect(isUuid("3f88bde1-2b49-16cb-914d-7500afdf82d6")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  it("parses an environment without exposing rejected values", () => {
    const schema = z.object({
      PORT: z.coerce.number().int().positive(),
      PASSWORD: z.string().min(8),
    });

    expect(
      requireEnv(schema, {
        PORT: "3201",
        PASSWORD: "safe-password",
      }),
    ).toEqual({
      PORT: 3201,
      PASSWORD: "safe-password",
    });

    let caught: unknown;
    try {
      requireEnv(schema, {
        PORT: "invalid",
        PASSWORD: "secret",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvironmentValidationError);
    expect(String(caught)).not.toContain("secret");
  });
});
