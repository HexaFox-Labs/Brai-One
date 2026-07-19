import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOutputs, checkGenerated, validateManifest } from "./catalog.mjs";

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    scope: "test",
    categories: [
      {
        id: "developer-experience",
        title: "Developer experience",
        description: "Tools for tests",
      },
    ],
    tools: [
      {
        id: "example-tool",
        name: "Example Tool",
        category: "developer-experience",
        kind: "cli",
        scope: "test",
        summary: "Short summary.",
        whatItIs: "A test tool.",
        purpose: "Tests the catalog.",
        usage: "Run it in tests.",
        status: "active",
        version: "1.0.0",
        location: "/tmp/example-tool",
        limitations: "None.",
        sources: [{ label: "External source", path: "/tmp/source" }],
        verification: ["`example-tool --version`"],
        tags: ["test"],
      },
    ],
    details: {
      "example-tool": {
        whatItIsDetailed:
          "Example Tool — это небольшой CLI для проверки каталога и его generated output. Он читает структурированную запись, проверяет обязательные поля и показывает результат в понятной форме.",
        whyNeededDetailed:
          "Он нужен тестам проекта, чтобы изменение схемы каталога не осталось непроверенным. Благодаря ему ошибка в описании или странице обнаруживается до review, а не после публикации документации.",
        whyThisTool: "It makes the test fixture explicit.",
        howItWorksHere: "The fixture is loaded by the catalog tests.",
        capabilities: ["catalog validation", "generated pages"],
        scenarios: ["validate an entry", "render a page"],
        commonMistakes: ["editing generated output"],
        relatedTools: [],
      },
    },
    ...overrides,
  };
}

test("validates a complete catalog entry", () => {
  assert.deepEqual(validateManifest(manifest()), []);
});

test("rejects an unknown category and a secret-like field", () => {
  const errors = validateManifest(
    manifest({
      tools: [
        {
          ...manifest().tools[0],
          category: "unknown",
          apiToken: "not allowed",
        },
      ],
    }),
  );
  assert.ok(errors.some((error) => error.includes("invalid category")));
  assert.ok(errors.some((error) => error.includes("secret-like")));
});

test("rejects short detailed explanations", () => {
  const errors = validateManifest(
    manifest({
      details: {
        ...manifest().details,
        "example-tool": {
          ...manifest().details["example-tool"],
          whatItIsDetailed: "A tool.",
        },
      },
    }),
  );
  assert.ok(errors.some((error) => error.includes("whatItIsDetailed")));
});

test("builds one page, category index, overview and JSON", async () => {
  const outputs = await buildOutputs(manifest());
  assert.equal(outputs.size, 4);
  assert.match(outputs.get("tools/example-tool.md"), /WhatItIs|Что это такое/u);
  assert.match(
    outputs.get("tools/example-tool.md"),
    /Почему мы выбрали именно этот инструмент/u,
  );
  assert.match(
    outputs.get("tools/example-tool.md"),
    /Example Tool — это небольшой CLI/u,
  );
  assert.match(
    outputs.get("by-category/developer-experience.md"),
    /Example Tool/u,
  );
  assert.match(outputs.get("catalog.md"), /Каталог инструментов/u);
  assert.match(
    outputs.get("catalog.json"),
    /"page": "tools\/example-tool.md"/u,
  );
});

test("detects missing or stale generated files", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "brai-stack-catalog-"));
  await mkdir(join(projectRoot, "docs/stack/tools"), { recursive: true });
  await mkdir(join(projectRoot, "docs/stack/by-category"), { recursive: true });
  const first = await checkGenerated(manifest(), projectRoot);
  assert.ok(first.some((error) => error.includes("missing generated file")));

  for (const [relativePath, content] of await buildOutputs(manifest())) {
    const filePath = join(projectRoot, "docs/stack", relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
  assert.deepEqual(await checkGenerated(manifest(), projectRoot), []);
});
