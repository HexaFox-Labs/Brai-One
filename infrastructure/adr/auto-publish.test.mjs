import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  createSourceManifest,
  publicationIsRequired,
  releaseIdFor,
} from "./auto-publish.mjs";

test("ADR source manifest is deterministic and changes with source", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "brai-adr-autopublish-"));
  const source = resolve(root, "docs/decisions");
  try {
    await mkdir(source, { recursive: true });
    await writeFile(resolve(source, "20260719-example.md"), "# Decision\n");
    const inputs = ["docs/decisions"];
    const first = await createSourceManifest(root, inputs);
    const second = await createSourceManifest(root, inputs);
    assert.equal(first, second);

    await writeFile(
      resolve(source, "20260719-example.md"),
      "# Changed decision\n",
    );
    assert.notEqual(await createSourceManifest(root, inputs), first);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("ADR auto-publisher skips only an unchanged successful release", () => {
  assert.equal(
    publicationIsRequired({
      currentIndex: true,
      force: false,
      manifest: "same",
      state: { manifest: "same" },
    }),
    false,
  );
  assert.equal(
    publicationIsRequired({
      currentIndex: true,
      force: false,
      manifest: "new",
      state: { manifest: "old" },
    }),
    true,
  );
  assert.equal(
    publicationIsRequired({
      currentIndex: false,
      force: false,
      manifest: "same",
      state: { manifest: "same" },
    }),
    true,
  );
});

test("ADR release IDs contain UTC time and a manifest prefix", () => {
  assert.equal(
    releaseIdFor("0123456789abcdef", new Date("2026-07-19T04:30:00.000Z")),
    "autopublish-20260719043000000-0123456789ab",
  );
});
