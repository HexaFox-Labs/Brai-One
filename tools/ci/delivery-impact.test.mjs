import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyPaths,
  resolveImpact,
  resolveChangedRuntimeServices,
  resolveRuntimeServices,
} from "./delivery-impact.mjs";

const root = resolve(import.meta.dirname, "../..");
const catalog = JSON.parse(
  await readFile(resolve(root, "infrastructure/delivery/catalog.json"), "utf8"),
);

test("documentation paths do not request runtime delivery", () => {
  assert.equal(
    classifyPaths(["docs/README.md", "memory-bank/progress.md"], catalog),
    "documentation",
  );
  assert.deepEqual(
    resolveImpact({ paths: ["docs/README.md"], affectedProjects: [] }, catalog),
    {
      deliveryClass: "documentation",
      affectedProjects: [],
      changedRuntimeServices: [],
      runtimeServices: [],
      images: [],
      builds: [],
      requiresPreview: false,
    },
  );
});

test("web delivery includes the gateway and NATS runtime closure", () => {
  assert.deepEqual(resolveRuntimeServices(["@brai/web"], catalog), [
    "@brai/api-gateway",
    "@brai/nats",
    "@brai/web",
  ]);
});

test("shared runtime contracts conservatively select every runtime service", () => {
  assert.deepEqual(resolveRuntimeServices(["@brai/contracts"], catalog), [
    "@brai/api-gateway",
    "@brai/brai-access",
    "@brai/brai-factory",
    "@brai/nats",
    "@brai/web",
  ]);
});

test("runtime dependencies are reused rather than rebuilt", () => {
  assert.deepEqual(resolveChangedRuntimeServices(["@brai/web"], catalog), [
    "@brai/web",
  ]);
});

test("service delivery includes its runtime closure and matching migration image", () => {
  const impact = resolveImpact(
    {
      paths: ["services/brai-access/src/main.ts"],
      affectedProjects: ["@brai/brai-access"],
    },
    catalog,
  );
  assert.deepEqual(impact.images, ["access", "access-admin"]);
  assert.deepEqual(impact.builds, [
    {
      image: "access",
      context: ".",
      dockerfile: "services/brai-access/Dockerfile",
    },
    {
      image: "access-admin",
      context: ".",
      dockerfile: "services/brai-access/Dockerfile.admin",
    },
  ]);
});

test("delivery configuration is never classified as documentation", () => {
  assert.equal(classifyPaths([".github/workflows/ci.yml"], catalog), "control");
});
