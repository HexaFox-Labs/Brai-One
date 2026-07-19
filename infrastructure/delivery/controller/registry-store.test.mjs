import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRegistry } from "./lease-registry.mjs";
import { readRegistry, writeRegistry } from "./registry-store.mjs";

test("creates missing state and persists it atomically as private state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "brai-delivery-registry-"));
  const path = join(directory, "state.json");
  try {
    assert.equal((await readRegistry(path)).slots.length, 20);
    await writeRegistry(path, createRegistry());
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
