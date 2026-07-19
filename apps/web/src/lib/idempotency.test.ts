import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveSubmissionAttempt,
  type SubmissionAttempt,
} from "@/lib/idempotency";

describe("resolveSubmissionAttempt", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: vi
        .fn()
        .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
        .mockReturnValueOnce("00000000-0000-4000-8000-000000000002"),
    });
  });

  it("reuses the key for an unchanged normalized payload", () => {
    const first = resolveSubmissionAttempt(
      { title: "Активность", description: "Описание" },
      null,
    );
    const retry = resolveSubmissionAttempt(
      { title: "  Активность ", description: "Описание  " },
      first,
    );

    expect(retry).toBe(first);
  });

  it("creates a new key after the payload changes", () => {
    const previous: SubmissionAttempt = {
      fingerprint: '{"title":"Первая","description":""}',
      idempotencyKey: "00000000-0000-4000-8000-000000000010",
    };

    const next = resolveSubmissionAttempt(
      { title: "Вторая", description: "" },
      previous,
    );

    expect(next.idempotencyKey).toBe("00000000-0000-4000-8000-000000000001");
    expect(next).not.toBe(previous);
  });
});
