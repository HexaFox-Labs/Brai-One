import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveImpact } from "../../../tools/ci/delivery-impact.mjs";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const catalog = JSON.parse(
  await readFile(
    resolve(workspaceRoot, "infrastructure/delivery/catalog.json"),
    "utf8",
  ),
);

describe("Mixed delivery impact", () => {
  it("retains affected runtime when the range also changes control files", () => {
    const impact = resolveImpact(
      {
        paths: [".github/workflows/delivery.yml", "apps/web/src/lib/api.ts"],
        affectedProjects: ["@brai/deployment", "@brai/web"],
      },
      catalog,
    );
    expect(impact.deliveryClass).toBe("control");
    expect(impact.changedRuntimeServices).toEqual(["@brai/web"]);
    expect(impact.runtimeServices).toEqual([
      "@brai/api-gateway",
      "@brai/nats",
      "@brai/web",
    ]);
    expect(impact.images).toEqual(["web"]);
    expect(impact.requiresPreview).toBe(true);
  });
});
