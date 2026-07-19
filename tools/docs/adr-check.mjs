import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { validateAdrDate } from "./adr-date.mjs";

const root = resolve(import.meta.dirname, "../..");
const configPath = resolve(root, ".log4brains.yml");
const config = await readFile(configPath, "utf8");
const folderMatch = config.match(/^\s+adrFolder:\s*(.+)$/mu);
if (!folderMatch) {
  throw new Error(".log4brains.yml must define project.adrFolder");
}

const adrFolder = folderMatch[1].trim().replace(/^['"]|['"]$/gu, "");
const sourceRoot = resolve(root, adrFolder);
const entries = await readdir(sourceRoot, { withFileTypes: true });
const ignored = new Set(["README.md", "index.md", "template.md"]);
const records = entries
  .filter(
    (entry) =>
      entry.isFile() && entry.name.endsWith(".md") && !ignored.has(entry.name),
  )
  .map((entry) => entry.name)
  .sort();

if (records.length === 0) {
  throw new Error(`No ADR records found in ${adrFolder}`);
}

const requiredSections = [
  ["status", /^-\s+(?:\*\*)?(?:Status|Статус)(?:\*\*)?\s*:/imu],
  [
    "deciders",
    /^-\s+(?:\*\*)?(?:Deciders|Decider|Принявшие решение)(?:\*\*)?\s*:/imu,
  ],
  ["date", /^-\s+(?:\*\*)?(?:Date|Дата)(?:\*\*)?\s*:/imu],
  ["context", /^##\s+(?:Context|Контекст)\s*$/imu],
  ["decision", /^##\s+(?:Decision|Решение)\s*$/imu],
  [
    "alternatives",
    /^##\s+(?:Alternatives|Альтернативы|Рассмотренные альтернативы)\s*$/imu,
  ],
  ["consequences", /^##\s+(?:Consequences|Последствия)\s*$/imu],
  ["verification", /^##\s+(?:Verification|Проверка)\s*$/imu],
  ["links", /^##\s+(?:Links|Ссылки|Связанные источники)\s*$/imu],
];

const failures = [];
for (const record of records) {
  const source = await readFile(resolve(sourceRoot, record), "utf8");
  for (const [name, pattern] of requiredSections) {
    if (!pattern.test(source)) {
      failures.push(`${record}: missing ${name}`);
    }
  }
  const date = source.match(
    /^-\s+(?:\*\*)?(?:Date|Дата)\s*:(?:\*\*)?\s*`?(\d{4}-\d{2}-\d{2})`?/imu,
  )?.[1];
  const dateError = date ? validateAdrDate(date) : "date must use YYYY-MM-DD";
  if (dateError) failures.push(`${record}: ${dateError}`);
}

const log4brains = resolve(root, "node_modules/.bin/log4brains");
const listResult = await run(log4brains, ["adr", "list", "--raw"]);
if (listResult.status !== 0) {
  failures.push("log4brains adr list failed");
}

if (failures.length > 0) {
  console.error("ADR check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `ADR check passed: ${records.length} source record(s) in ${adrFolder}`,
);

function run(command, args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolveResult({ status: signal ? 1 : (code ?? 1) });
    });
  });
}
