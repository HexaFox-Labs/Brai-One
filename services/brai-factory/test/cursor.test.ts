import { describe, expect, it } from "vitest";

import { decodeActivityCursor, encodeActivityCursor } from "../src/cursor.js";
import { InvalidCursorError } from "../src/errors.js";

describe("Activity cursor", () => {
  it("round-trips a stable opaque cursor", () => {
    const cursor = {
      created_at: "2026-07-16T12:00:00.000Z",
      id: "3f88bde1-2b49-46cb-914d-7500afdf82d6",
    };

    expect(decodeActivityCursor(encodeActivityCursor(cursor))).toEqual(cursor);
  });

  it("rejects malformed and non-canonical cursors", () => {
    expect(() => decodeActivityCursor("not-json")).toThrow(InvalidCursorError);
    expect(() => decodeActivityCursor("e30=")).toThrow(InvalidCursorError);
  });
});
