import type { Pool, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { Activity } from "@brai/contracts";

import { IdempotencyConflictError } from "../src/errors.js";
import { ActivityRepository } from "../src/repository.js";

const REQUEST_ID = "3f88bde1-2b49-46cb-914d-7500afdf82d6";
const IDEMPOTENCY_KEY = "6a8b067a-83df-4247-bd33-397db9f4b0e0";

function queryResult<Row extends QueryResultRow>(
  rows: Row[],
): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rowCount: rows.length,
    rows,
  };
}

function databaseFrom(query: ReturnType<typeof vi.fn>): Pick<Pool, "query"> {
  return { query } as unknown as Pick<Pool, "query">;
}

function activityRow(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "873f1482-283d-4445-a10c-b19e0210a1d0",
    title: "Первая активность",
    description: "Описание",
    created_at: "2026-07-16T12:00:00.000Z",
    ...overrides,
  };
}

describe("ActivityRepository.createActivity", () => {
  it("returns a newly inserted Activity", async () => {
    const query = vi.fn().mockResolvedValueOnce(queryResult([activityRow()]));
    const repository = new ActivityRepository(databaseFrom(query));

    const result = await repository.createActivity(
      {
        idempotency_key: IDEMPOTENCY_KEY,
        title: "  Первая активность  ",
        description: "  Описание  ",
      },
      REQUEST_ID,
    );

    expect(result).toEqual({
      activity: activityRow(),
      idempotentReplay: false,
    });
    expect(query.mock.calls[0]?.[1]?.slice(1)).toEqual([
      "Первая активность",
      "Описание",
      IDEMPOTENCY_KEY,
      REQUEST_ID,
    ]);
  });

  it("replays an existing Activity for the same normalized payload", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([activityRow()]));
    const repository = new ActivityRepository(databaseFrom(query));

    const result = await repository.createActivity(
      {
        idempotency_key: IDEMPOTENCY_KEY,
        title: "Первая активность",
        description: "Описание",
      },
      REQUEST_ID,
    );

    expect(result.idempotentReplay).toBe(true);
    expect(result.activity).toEqual(activityRow());
  });

  it("rejects reuse of the key for a different payload", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(
        queryResult([activityRow({ title: "Другая активность" })]),
      );
    const repository = new ActivityRepository(databaseFrom(query));

    await expect(
      repository.createActivity(
        {
          idempotency_key: IDEMPOTENCY_KEY,
          title: "Первая активность",
          description: "Описание",
        },
        REQUEST_ID,
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});

describe("ActivityRepository.listActivities", () => {
  it("uses lookahead pagination and returns an opaque next cursor", async () => {
    const rows = [
      activityRow(),
      activityRow({
        id: "446d5481-3d42-49ac-8960-b73cbd62c87d",
        created_at: "2026-07-16T11:00:00.000Z",
      }),
      activityRow({
        id: "0c94a7f1-fe7e-4d94-8772-45e511b6e955",
        created_at: "2026-07-16T10:00:00.000Z",
      }),
    ];
    const query = vi.fn().mockResolvedValueOnce(queryResult(rows));
    const repository = new ActivityRepository(databaseFrom(query));

    const result = await repository.listActivities({
      cursor: null,
      limit: 2,
    });

    expect(result.activities).toEqual(rows.slice(0, 2));
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(query.mock.calls[0]?.[1]).toEqual([3]);
  });
});
