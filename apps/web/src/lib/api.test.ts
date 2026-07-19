import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createActivity,
  listActivities,
  parseActivityListResponse,
} from "@/lib/api";

const activity = {
  id: "9c5ee6b2-1cd5-4e27-914b-70b71d26c9f7",
  title: "Проверить сборку",
  description: "",
  created_at: "2026-07-16T10:00:00.000Z",
};
const requestId = "8d2bbf66-a43b-42f7-8d75-3800f4505e2f";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("activity API client", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: vi
        .fn()
        .mockReturnValue("00000000-0000-4000-8000-000000000001"),
    });
  });

  it("accepts the direct list envelope", () => {
    expect(
      parseActivityListResponse({
        schema_version: "brai.http.activity.list.response.v1",
        request_id: requestId,
        activities: [activity],
        next_cursor: "opaque-cursor",
      }),
    ).toEqual({
      activities: [activity],
      nextCursor: "opaque-cursor",
    });
  });

  it("rejects a response outside the public schema", () => {
    expect(() =>
      parseActivityListResponse({
        data: {
          activities: [activity],
          next_cursor: null,
        },
      }),
    ).toThrow("API вернул некорректный список активностей.");
  });

  it("sends the pagination cursor and a request ID", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        schema_version: "brai.http.activity.list.response.v1",
        request_id: requestId,
        activities: [],
        next_cursor: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listActivities({ cursor: "next page" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/activities?limit=50&cursor=next+page",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-Request-ID": "00000000-0000-4000-8000-000000000001",
        }),
      }),
    );
  });

  it("sends the idempotency key and preserves API error details", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          schema_version: "brai.http.error.v1",
          request_id: "00000000-0000-4000-8000-000000000099",
          code: "service_unavailable",
          message: "Сервис временно недоступен.",
        },
        503,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const promise = createActivity({
      draft: {
        title: "Проверить сборку",
        description: "",
      },
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
    });

    await expect(promise).rejects.toMatchObject({
      status: 503,
      code: "service_unavailable",
      requestId: "00000000-0000-4000-8000-000000000099",
      message: "Сервис временно недоступен.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/activities",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "00000000-0000-4000-8000-000000000002",
        }),
      }),
    );
  });
});
