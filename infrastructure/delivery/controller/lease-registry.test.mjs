import assert from "node:assert/strict";
import test from "node:test";
import {
  createRegistry,
  releaseLease,
  requestLease,
} from "./lease-registry.mjs";

const now = "2026-07-19T15:00:00.000Z";
const request = (branch, priority = "normal") => ({
  branch,
  priority,
  revision: "a".repeat(40),
});

test("allocates the lowest free slot and reuses a branch lease", () => {
  let registry = createRegistry();
  let allocation = requestLease(registry, request("feature/one"), now, 5);
  registry = allocation.registry;
  assert.deepEqual(allocation.result, {
    created: true,
    state: "leased",
    slot: 1,
    generation: 1,
  });
  allocation = requestLease(
    registry,
    request("feature/one"),
    "2026-07-19T16:00:00.000Z",
    5,
  );
  assert.deepEqual(allocation.result, {
    created: false,
    state: "leased",
    slot: 1,
    generation: 1,
  });
});

test("never lets a stale generation release a newer slot lease", () => {
  let registry = createRegistry();
  registry = requestLease(registry, request("feature/one"), now, 5).registry;
  registry = releaseLease(registry, 1, 1).registry;
  registry = requestLease(registry, request("feature/two"), now, 5).registry;
  assert.equal(releaseLease(registry, 1, 1).released, false);
  assert.equal(releaseLease(registry, 1, 2).released, true);
});

test("queues by release priority then FIFO and honors active capacity", () => {
  let registry = createRegistry();
  registry = requestLease(registry, request("feature/one"), now, 1).registry;
  registry = requestLease(registry, request("feature/two"), now, 1).registry;
  const result = requestLease(
    registry,
    request("release/one", "release"),
    now,
    1,
  ).result;
  assert.deepEqual(result, { state: "queued" });
});
