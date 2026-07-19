import type { Pool } from "pg";

import {
  activitySchema,
  createActivityPayloadSchema,
  listActivitiesPayloadSchema,
  type Activity,
  type CreateActivityPayload,
  type ListActivitiesPayload,
} from "@brai/contracts";
import { generateUuid } from "@brai/runtime";

import {
  decodeActivityCursor,
  encodeActivityCursor,
  type ActivityCursor,
} from "./cursor.js";
import {
  IdempotencyConflictError,
  InvalidCursorError,
  PersistenceError,
} from "./errors.js";

type ActivityRow = {
  id: string;
  title: string;
  description: string;
  created_at: string;
};

export type CreateActivityResult = {
  activity: Activity;
  idempotentReplay: boolean;
};

export type ListActivitiesResult = {
  activities: Activity[];
  nextCursor: string | null;
};

function toActivity(row: ActivityRow): Activity {
  return activitySchema.parse({
    id: row.id,
    title: row.title,
    description: row.description,
    created_at: row.created_at,
  });
}

function cursorParameters(cursor: ActivityCursor | null): unknown[] {
  if (!cursor) {
    return [];
  }

  return [cursor.created_at, cursor.id];
}

export class ActivityRepository {
  public constructor(private readonly database: Pick<Pool, "query">) {}

  public async createActivity(
    payload: CreateActivityPayload,
    requestId: string,
  ): Promise<CreateActivityResult> {
    const normalized = createActivityPayloadSchema.parse(payload);

    try {
      const inserted = await this.database.query<ActivityRow>(
        `
          INSERT INTO brai_factory.activities (
            id,
            title,
            description,
            idempotency_key,
            created_request_id
          )
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING
            id,
            title,
            description,
            to_char(
              created_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ) AS created_at
        `,
        [
          generateUuid(),
          normalized.title,
          normalized.description,
          normalized.idempotency_key,
          requestId,
        ],
      );
      const insertedRow = inserted.rows[0];

      if (insertedRow) {
        return {
          activity: toActivity(insertedRow),
          idempotentReplay: false,
        };
      }

      const existing = await this.database.query<ActivityRow>(
        `
          SELECT
            id,
            title,
            description,
            to_char(
              created_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ) AS created_at
          FROM brai_factory.activities
          WHERE idempotency_key = $1
        `,
        [normalized.idempotency_key],
      );
      const existingRow = existing.rows[0];

      if (!existingRow) {
        throw new PersistenceError(
          "Idempotency conflict did not return the existing Activity",
        );
      }

      if (
        existingRow.title !== normalized.title ||
        existingRow.description !== normalized.description
      ) {
        throw new IdempotencyConflictError();
      }

      return {
        activity: toActivity(existingRow),
        idempotentReplay: true,
      };
    } catch (error) {
      if (
        error instanceof IdempotencyConflictError ||
        error instanceof PersistenceError
      ) {
        throw error;
      }

      throw new PersistenceError("Unable to create Activity", {
        cause: error,
      });
    }
  }

  public async listActivities(
    payload: ListActivitiesPayload,
  ): Promise<ListActivitiesResult> {
    const normalized = listActivitiesPayloadSchema.parse(payload);
    let cursor: ActivityCursor | null = null;

    if (normalized.cursor) {
      cursor = decodeActivityCursor(normalized.cursor);
    }

    const limitWithLookahead = normalized.limit + 1;
    const parameters = [...cursorParameters(cursor), limitWithLookahead];
    const limitParameter = parameters.length;
    const cursorClause = cursor
      ? "WHERE (created_at, id) < ($1::timestamptz, $2::uuid)"
      : "";

    try {
      const result = await this.database.query<ActivityRow>(
        `
          SELECT
            id,
            title,
            description,
            to_char(
              created_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ) AS created_at
          FROM brai_factory.activities
          ${cursorClause}
          ORDER BY created_at DESC, id DESC
          LIMIT $${limitParameter}
        `,
        parameters,
      );
      const hasMore = result.rows.length > normalized.limit;
      const activities = result.rows.slice(0, normalized.limit).map(toActivity);
      const lastActivity = activities.at(-1);

      return {
        activities,
        nextCursor:
          hasMore && lastActivity
            ? encodeActivityCursor({
                created_at: lastActivity.created_at,
                id: lastActivity.id,
              })
            : null,
      };
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        throw error;
      }

      throw new PersistenceError("Unable to list Activities", {
        cause: error,
      });
    }
  }
}
