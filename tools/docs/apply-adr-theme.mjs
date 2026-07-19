import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const themeSource = resolve(root, "infrastructure/adr/theme.css");
const marker =
  '<link rel="stylesheet" href="/brai-adr-theme.css" data-brai-adr-theme="dark">';

export async function applyAdrTheme(output) {
  const outputRoot = resolve(output);
  const pages = await collectHtml(outputRoot);
  if (pages.length === 0) throw new Error("ADR build produced no HTML pages");

  await copyFile(themeSource, resolve(outputRoot, "brai-adr-theme.css"));
  for (const page of pages) {
    const html = await readFile(page, "utf8");
    if (!html.includes("</head>"))
      throw new Error(
        `ADR HTML page has no closing head: ${relative(outputRoot, page)}`,
      );
    const themed = html
      .replace(
        /<meta name="theme-color" content="[^"]*"\/>/u,
        '<meta name="theme-color" content="#090a0c"/>',
      )
      .replace("</head>", `${marker}</head>`);
    await writeFile(page, themed);
  }
  return { pages: pages.length };
}

async function collectHtml(directory) {
  const pages = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) pages.push(...(await collectHtml(path)));
    else if (entry.isFile() && entry.name.endsWith(".html")) pages.push(path);
  }
  return pages;
}

async function main() {
  const index = process.argv.indexOf("--output");
  const output = index < 0 ? null : process.argv[index + 1];
  if (!output || output.startsWith("--"))
    throw new Error("--output requires a directory");
  if (process.argv.length !== 4) throw new Error("Only --output is supported");
  const result = await applyAdrTheme(output);
  console.log(`Applied the dark ADR theme to ${result.pages} HTML pages.`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  main().catch((error) => {
    console.error(`ADR theme application failed: ${error.message}`);
    process.exitCode = 1;
  });
}
