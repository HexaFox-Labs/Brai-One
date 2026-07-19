import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { normalizeAdrPublicationDates } from "./normalize-adr-dates.mjs";

test("anchors Log4brains date-only publication timestamps at UTC noon", async () => {
  const output = await mkdtemp(resolve(tmpdir(), "brai-adr-date-test-"));
  try {
    const page = resolve(output, "index.html");
    await writeFile(page, '{"publicationDate":"2026-07-19T23:59:59.000Z"}');

    const result = await normalizeAdrPublicationDates(output);

    assert.equal(result.normalized, 1);
    assert.match(await readFile(page, "utf8"), /2026-07-19T12:00:00.000Z/);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
