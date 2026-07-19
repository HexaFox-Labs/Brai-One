import { describe, expect, it, vi } from "vitest";

import {
  CREATE_ACTIVITY_REQUEST_SCHEMA_VERSION,
  LIST_ACTIVITIES_REQUEST_SCHEMA_VERSION,
} from "@brai/contracts";
import { createLogger } from "@brai/runtime";

import { IdempotencyConflictError } from "../src/errors.js";
import { FactoryService } from "../src/factory-service.js";
import type { ActivityRepository } from "../src/repository.js";

const REQUEST_ID = "3f88bde1-2b49-46cb-914d-7500afdf82d6";
const IDEMPOTENCY_KEY = "6a8b067a-83df-4247-bd33-397db9f4b0e0";
const ACTIVITY = {
  id: "873f1482-283d-4445-a10c-b19e0210a1d0",
  title: "Первая активность",
  description: "Описание",
  created_at: "2026-07-16T12:00:00.000Z",
};

function serviceWith(repository: Partial<ActivityRepository>): FactoryService {
  return new FactoryService(
    repository as ActivityRepository,
    createLogger({ name: "brai-factory-test", level: "silent" }),
  );
}

describe("FactoryService", () => {
  it("returns strict create success envelopes", async () => {
    const service = serviceWith({
      createActivity: vi.fn().mockResolvedValue({
        activity: ACTIVITY,
        idempotentReplay: false,
      }),
    });

    const response = await service.handleCreate({
      schema_version: CREATE_ACTIVITY_REQUEST_SCHEMA_VERSION,
      request_id: REQUEST_ID,
      sent_at: "2026-07-16T12:00:00.000Z",
      payload: {
        idempotency_key: IDEMPOTENCY_KEY,
        title: "Первая активность",
        description: "Описание",
      },
    });

    expect(response.request_id).toBe(REQUEST_ID);
    expect(response.payload).toEqual({
      ok: true,
      activity: ACTIVITY,
      idempotent_replay: false,
    });
  });

  it("maps duplicate-key conflicts without leaking internals", async () => {
    const service = serviceWith({
      createActivity: vi.fn().mockRejectedValue(new IdempotencyConflictError()),
    });

    const response = await service.handleCreate({
      schema_version: CREATE_ACTIVITY_REQUEST_SCHEMA_VERSION,
      request_id: REQUEST_ID,
      sent_at: "2026-07-16T12:00:00.000Z",
      payload: {
        idempotency_key: IDEMPOTENCY_KEY,
        title: "Первая активность",
        description: "",
      },
    });

    expect(response.payload).toMatchObject({
      ok: false,
      code: "idempotency_conflict",
    });
  });

  it("rejects malformed list envelopes before repository access", async () => {
    const listActivities = vi.fn();
    const service = serviceWith({ listActivities });

    const response = await service.handleList({
      schema_version: LIST_ACTIVITIES_REQUEST_SCHEMA_VERSION,
      request_id: REQUEST_ID,
      sent_at: "not-a-date",
      payload: {
        limit: 50,
        cursor: null,
      },
    });

    expect(response.payload).toMatchObject({
      ok: false,
      code: "invalid_request",
    });
    expect(listActivities).not.toHaveBeenCalled();
  });
});
