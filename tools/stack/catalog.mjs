import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import * as prettier from "prettier";

export const ALLOWED_CATEGORIES = Object.freeze([
  "runtime",
  "application",
  "infrastructure",
  "data",
  "quality",
  "documentation",
  "developer-experience",
  "security",
  "browser",
]);

const root = resolve(import.meta.dirname, "../..");
const manifestPath = resolve(root, "tools/stack/catalog.json");
const generatedRoot = resolve(root, "docs/stack");
const toolsRoot = resolve(generatedRoot, "tools");
const categoriesRoot = resolve(generatedRoot, "by-category");

export async function loadManifest(filePath = manifestPath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export function validateManifest(manifest, projectRoot = root) {
  const errors = [];
  if (!manifest || manifest.schemaVersion !== 1) {
    errors.push("manifest.schemaVersion must be 1");
  }
  if (
    !Array.isArray(manifest?.categories) ||
    manifest.categories.length === 0
  ) {
    errors.push("manifest.categories must be a non-empty array");
  }
  if (!Array.isArray(manifest?.tools)) {
    errors.push("manifest.tools must be an array");
    return errors;
  }
  if (!manifest?.details || typeof manifest.details !== "object") {
    errors.push("manifest.details must be an object keyed by tool id");
  }

  const categoryIds = new Set();
  for (const category of manifest.categories ?? []) {
    if (!category?.id || !ALLOWED_CATEGORIES.includes(category.id)) {
      errors.push(`invalid category: ${category?.id ?? "<missing>"}`);
    }
    if (categoryIds.has(category.id)) {
      errors.push(`duplicate category id: ${category.id}`);
    }
    categoryIds.add(category.id);
    if (!category.title || !category.description) {
      errors.push(`category ${category.id} needs title and description`);
    }
  }

  const ids = new Set();
  const slugs = new Set();
  for (const tool of manifest.tools) {
    const label = tool?.id ?? "<missing id>";
    for (const field of [
      "id",
      "name",
      "category",
      "kind",
      "scope",
      "summary",
      "whatItIs",
      "purpose",
      "usage",
      "status",
      "version",
      "location",
    ]) {
      if (typeof tool?.[field] !== "string" || tool[field].trim() === "") {
        errors.push(`${label}: missing ${field}`);
      }
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(tool?.id ?? "")) {
      errors.push(`${label}: id must be kebab-case`);
    }
    if (ids.has(tool?.id)) errors.push(`duplicate tool id: ${tool?.id}`);
    ids.add(tool?.id);
    const slug = tool?.slug ?? tool?.id;
    if (slugs.has(slug)) errors.push(`duplicate tool slug: ${slug}`);
    slugs.add(slug);
    if (!ALLOWED_CATEGORIES.includes(tool?.category)) {
      errors.push(`${label}: invalid category ${tool?.category}`);
    }
    if (!categoryIds.has(tool?.category)) {
      errors.push(`${label}: category is not declared: ${tool?.category}`);
    }
    if (!Array.isArray(tool?.sources) || tool.sources.length === 0) {
      errors.push(`${label}: sources must be a non-empty array`);
    }
    if (!Array.isArray(tool?.verification) || tool.verification.length === 0) {
      errors.push(`${label}: verification must be a non-empty array`);
    }
    const details = manifest.details?.[tool?.id];
    for (const field of [
      "whatItIsDetailed",
      "whyNeededDetailed",
      "whyThisTool",
      "howItWorksHere",
    ]) {
      if (
        typeof details?.[field] !== "string" ||
        details[field].trim() === ""
      ) {
        errors.push(`${label}: missing details.${field}`);
      }
    }
    for (const field of ["whatItIsDetailed", "whyNeededDetailed"]) {
      const value = details?.[field];
      if (typeof value === "string") {
        const sentenceCount = value
          .split(/(?<=[.!?])\s+/u)
          .filter((sentence) => sentence.trim() !== "").length;
        if (value.trim().length < 180 || sentenceCount < 2) {
          errors.push(
            `${label}: details.${field} needs at least 180 characters and 2 sentences`,
          );
        }
      }
    }
    for (const field of [
      "capabilities",
      "scenarios",
      "commonMistakes",
      "relatedTools",
    ]) {
      if (
        !Array.isArray(details?.[field]) ||
        (field !== "relatedTools" && details[field].length === 0)
      ) {
        errors.push(`${label}: details.${field} must be a non-empty array`);
      }
    }
    if ((details?.capabilities?.length ?? 0) < 2) {
      errors.push(`${label}: details.capabilities needs at least 2 items`);
    }
    if ((details?.scenarios?.length ?? 0) < 2) {
      errors.push(`${label}: details.scenarios needs at least 2 items`);
    }
    for (const source of tool?.sources ?? []) {
      if (!source?.label || !source?.path) {
        errors.push(`${label}: every source needs label and path`);
        continue;
      }
      if (
        !source.path.startsWith("/") &&
        !/^https?:\/\//u.test(source.path) &&
        !existsSync(resolve(projectRoot, source.path))
      ) {
        errors.push(`${label}: missing source path ${source.path}`);
      }
    }
    if (hasSecretLikeField(tool)) {
      errors.push(`${label}: secret-like field or value is not allowed`);
    }
    if (hasSecretLikeField(details)) {
      errors.push(`${label}: details contain a secret-like field or value`);
    }
  }
  const toolIds = new Set(manifest.tools.map((tool) => tool.id));
  for (const [toolId, details] of Object.entries(manifest.details ?? {})) {
    if (!toolIds.has(toolId))
      errors.push(`details has unknown tool id: ${toolId}`);
    for (const relatedId of details.relatedTools ?? []) {
      if (!toolIds.has(relatedId)) {
        errors.push(`${toolId}: unknown related tool id ${relatedId}`);
      }
    }
  }
  return errors;
}

function hasSecretLikeField(value, key = "") {
  if (/(?:password|token|private[_-]?key|secret|credential)/iu.test(key)) {
    return true;
  }
  if (Array.isArray(value))
    return value.some((item) => hasSecretLikeField(item));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([entryKey, entryValue]) =>
      hasSecretLikeField(entryValue, entryKey),
    );
  }
  return false;
}

export async function buildOutputs(manifest) {
  const categoryMap = new Map(
    manifest.categories.map((item) => [item.id, item]),
  );
  const tools = [...manifest.tools]
    .map((tool) => ({ ...tool, details: manifest.details[tool.id] }))
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  const toolMap = new Map(tools.map((tool) => [tool.id, tool]));
  const outputs = new Map();

  for (const tool of tools) {
    const category = categoryMap.get(tool.category);
    outputs.set(
      `tools/${tool.id}.md`,
      await formatOutput(
        `tools/${tool.id}.md`,
        renderTool(tool, category, toolMap),
      ),
    );
  }

  for (const category of manifest.categories) {
    const categoryTools = tools.filter((tool) => tool.category === category.id);
    if (categoryTools.length === 0) continue;
    outputs.set(
      `by-category/${category.id}.md`,
      await formatOutput(
        `by-category/${category.id}.md`,
        renderCategory(category, categoryTools),
      ),
    );
  }
  outputs.set(
    "catalog.md",
    await formatOutput("catalog.md", renderCatalog(manifest.categories, tools)),
  );

  const siteCatalog = {
    schemaVersion: manifest.schemaVersion,
    generatedFrom: "tools/stack/catalog.json",
    scope: manifest.scope,
    categories: manifest.categories
      .filter((category) => tools.some((tool) => tool.category === category.id))
      .map((category) => ({
        id: category.id,
        title: category.title,
        description: category.description,
        tools: tools
          .filter((tool) => tool.category === category.id)
          .map((tool) => tool.id),
      })),
    tools: tools.map((tool) => ({
      ...tool,
      page: `tools/${tool.id}.md`,
    })),
  };
  outputs.set(
    "catalog.json",
    await formatOutput("catalog.json", JSON.stringify(siteCatalog, null, 2)),
  );
  return outputs;
}

async function formatOutput(relativePath, content) {
  return prettier.format(content, {
    parser: relativePath.endsWith(".json") ? "json" : "markdown",
  });
}

export async function checkGenerated(manifest, projectRoot = root) {
  const expected = await buildOutputs(manifest);
  const errors = [];
  const projectGeneratedRoot = resolve(projectRoot, "docs/stack");
  const projectToolsRoot = resolve(projectGeneratedRoot, "tools");
  const projectCategoriesRoot = resolve(projectGeneratedRoot, "by-category");
  for (const [relativePath, content] of expected) {
    const filePath = resolve(projectGeneratedRoot, relativePath);
    if (!existsSync(filePath)) {
      errors.push(`missing generated file: docs/stack/${relativePath}`);
      continue;
    }
    if ((await readFile(filePath, "utf8")) !== content) {
      errors.push(`generated file is stale: docs/stack/${relativePath}`);
    }
  }
  for (const directory of [projectToolsRoot, projectCategoriesRoot]) {
    if (!existsSync(directory)) continue;
    for (const entry of await readdir(directory)) {
      const relativePath = `${relative(projectGeneratedRoot, directory)}/${entry}`;
      if (!expected.has(relativePath)) {
        errors.push(`stale generated file: docs/stack/${relativePath}`);
      }
    }
  }
  return errors;
}

async function generate(manifest) {
  await mkdir(toolsRoot, { recursive: true });
  await mkdir(categoriesRoot, { recursive: true });
  for (const [relativePath, content] of await buildOutputs(manifest)) {
    const filePath = resolve(generatedRoot, relativePath);
    await mkdir(resolve(filePath, ".."), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
}

function renderTool(tool, category, toolMap) {
  const sources = tool.sources
    .map((source) => `- [${source.label}](${sourceHref(source.path)})`)
    .join("\n");
  const verification = tool.verification.map((item) => `- ${item}`).join("\n");
  const capabilities = tool.details.capabilities
    .map((item) => `- ${item}`)
    .join("\n");
  const scenarios = tool.details.scenarios
    .map((item) => `- ${item}`)
    .join("\n");
  const mistakes = tool.details.commonMistakes
    .map((item) => `- ${item}`)
    .join("\n");
  const related = tool.details.relatedTools
    .map((id) => {
      const relatedTool = toolMap.get(id);
      return `- [${relatedTool.name}](./${relatedTool.id}.md) — ${relatedTool.summary}`;
    })
    .join("\n");
  const tags = tool.tags?.length
    ? `\n**Теги:** ${tool.tags.join(", ")}  \n`
    : "";
  return `<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->
# ${tool.name}

**Категория:** [${category.title}](../by-category/${category.id}.md)  
**Статус:** ${tool.status}  
**Версия:** ${tool.version}  
**Тип:** ${tool.kind}  
**Область:** ${tool.scope}  
${tags}
## Если коротко

${tool.summary}

## Что это такое

${tool.details.whatItIsDetailed}

## Зачем это нужно Brai

${tool.details.whyNeededDetailed}

## Почему мы выбрали именно этот инструмент

${tool.details.whyThisTool}

## Как он работает в нашем контуре

${tool.details.howItWorksHere}

## Что он даёт

${capabilities}

## Практические сценарии

${scenarios}

## Как мы это используем

${tool.usage}

## Где находится

${tool.location}

## Ограничения

${tool.limitations ?? "Для проекта не зафиксированы отдельные ограничения."}

## Типичные ошибки

${mistakes}

## Связанные инструменты

${related}

## Обновление и жизненный цикл

Статус инструмента: **${tool.status}**. Текущая версия или ограничение версии:
**${tool.version}**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

${verification}

## Источники и дальнейшее чтение

${sources}

[← Вернуться к каталогу стека](../README.md)
`;
}

function sourceHref(path) {
  if (path.startsWith("/") || /^https?:\/\//u.test(path)) return path;
  return `../../../${path}`;
}

function renderCategory(category, tools) {
  return `<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->
# ${category.title}

${category.description}

${tools
  .map(
    (tool) =>
      `- [${tool.name}](../tools/${tool.id}.md) — ${tool.summary} (${tool.status})`,
  )
  .join("\n")}

[← Вернуться к каталогу стека](../README.md)
`;
}

function renderCatalog(categories, tools) {
  const sections = categories
    .map((category) => {
      const categoryTools = tools.filter(
        (tool) => tool.category === category.id,
      );
      if (categoryTools.length === 0) return "";
      return `## ${category.title}\n\n${category.description}\n\n${categoryTools
        .map(
          (tool) => `- [${tool.name}](tools/${tool.id}.md) — ${tool.summary}`,
        )
        .join("\n")}`;
    })
    .filter(Boolean)
    .join("\n\n");
  return `<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->
# Каталог инструментов Brai New

Здесь собраны отдельные страницы инструментов, сгруппированные по назначению.
Каждая страница написана для человека: объясняет, что это за инструмент,
зачем он нужен Brai и как проверить, что он работает.

${sections}

[← Вернуться к обзорному стеку](README.md)
`;
}

async function main() {
  const command = process.argv[2] ?? "check";
  const manifest = await loadManifest();
  const validationErrors = validateManifest(manifest);
  if (validationErrors.length > 0) {
    console.error("Stack catalog validation failed:");
    for (const error of validationErrors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  if (command === "generate") {
    await generate(manifest);
    console.log(
      `Generated ${(await buildOutputs(manifest)).size} stack artifacts.`,
    );
    return;
  }
  if (command === "check") {
    const errors = await checkGenerated(manifest);
    if (errors.length > 0) {
      console.error("Stack catalog generated output is not synchronized:");
      for (const error of errors) console.error(`- ${error}`);
      console.error("Run: pnpm run stack:generate");
      process.exitCode = 1;
      return;
    }
    console.log(`Stack catalog check passed: ${manifest.tools.length} tools.`);
    return;
  }
  console.error(`Unknown stack catalog command: ${command}`);
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  await main();
}
