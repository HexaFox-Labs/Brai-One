import { isoDateTimeSchema } from "@brai/contracts";
import { isUuid } from "@brai/runtime";

import { InvalidCursorError } from "./errors.js";

export type ActivityCursor = {
  created_at: string;
  id: string;
};

function isCursorRecord(value: unknown): value is ActivityCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();

  return (
    keys.length === 2 &&
    keys[0] === "created_at" &&
    keys[1] === "id" &&
    typeof record.created_at === "string" &&
    isoDateTimeSchema.safeParse(record.created_at).success &&
    isUuid(record.id)
  );
}

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeActivityCursor(value: string): ActivityCursor {
  try {
    const decodedBuffer = Buffer.from(value, "base64url");

    if (decodedBuffer.toString("base64url") !== value) {
      throw new InvalidCursorError();
    }

    const decoded: unknown = JSON.parse(decodedBuffer.toString("utf8"));

    if (!isCursorRecord(decoded)) {
      throw new InvalidCursorError();
    }

    return {
      created_at: decoded.created_at,
      id: decoded.id,
    };
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw error;
    }

    throw new InvalidCursorError();
  }
}
