import assert from "node:assert/strict";
import test from "node:test";

import { validateAdrDate } from "./adr-date.mjs";

test("accepts a current valid ADR date", () => {
  assert.equal(validateAdrDate("2026-07-19", "2026-07-19"), null);
});

test("rejects invalid and future ADR dates", () => {
  assert.match(validateAdrDate("2026-02-30", "2026-07-19"), /real calendar/);
  assert.match(validateAdrDate("19-07-2026", "2026-07-19"), /YYYY-MM-DD/);
  assert.match(validateAdrDate("2026-07-20", "2026-07-19"), /future/);
});
