import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const roots = ["docs", "openspec", "memory-bank", "infrastructure/adr"];
const files = ["AGENTS.md", "README.md"];
for (const directory of roots) {
  files.push(...(await markdownFiles(resolve(root, directory))));
}

const failures = [];
for (const file of files) {
  const source = await readFile(resolve(root, file), "utf8");
  const prose = source.replace(/```[\s\S]*?```/gu, "");
  if (prose.includes("<<<<<<<") || prose.includes(">>>>>>>")) {
    failures.push(`${file}: merge marker found`);
  }

  for (const target of markdownTargets(source)) {
    if (/^(?:https?:|mailto:|#|skill:)/iu.test(target)) continue;
    const withoutAnchor = target.split("#", 1)[0];
    if (!withoutAnchor) continue;
    const decoded = decodeURIComponent(withoutAnchor);
    const candidate = decoded.startsWith("/")
      ? decoded
      : resolve(root, file, "..", decoded);
    if (!existsSync(candidate)) {
      failures.push(`${file}: missing link target ${target}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Documentation link check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const formatFiles = files.filter(
  (file) =>
    file === "AGENTS.md" ||
    file === "README.md" ||
    file === "docs/README.md" ||
    file === "docs/reference/code-style.md" ||
    file.startsWith("docs/decisions/") ||
    file.startsWith("docs/stack/") ||
    file.startsWith("infrastructure/adr/") ||
    file.startsWith("openspec/changes/integrate-adr-log4brains/"),
);
const prettier = await run(resolve(root, "node_modules/.bin/prettier"), [
  "--check",
  ...formatFiles,
]);
if (prettier.status !== 0) process.exit(prettier.status);

console.log(`Documentation check passed: ${files.length} Markdown file(s)`);

function markdownTargets(source) {
  return [...source.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/gu)].map(
    (match) => match[1],
  );
}

async function markdownFiles(directory, prefix = directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    const relative = resolve(prefix, entry.name).replace(`${root}/`, "");
    if (entry.isDirectory()) {
      result.push(
        ...(await markdownFiles(absolute, resolve(prefix, entry.name))),
      );
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      result.push(relative);
    }
  }
  return result;
}

function run(command, args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolveResult({ status: signal ? 1 : (code ?? 1) });
    });
  });
}
