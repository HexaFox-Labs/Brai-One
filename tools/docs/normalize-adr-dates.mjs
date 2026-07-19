import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const publicationDateAtEndOfDay =
  /("publicationDate":"\d{4}-\d{2}-\d{2})T23:59:59\.000Z("?)/gu;

export async function normalizeAdrPublicationDates(output) {
  const outputRoot = resolve(output);
  const files = await collectStaticData(outputRoot);
  let normalized = 0;

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const updated = source.replace(
      publicationDateAtEndOfDay,
      "$1T12:00:00.000Z$2",
    );
    if (updated !== source) {
      normalized += (source.match(publicationDateAtEndOfDay) ?? []).length;
      await writeFile(file, updated);
    }
  }

  if (normalized === 0) {
    throw new Error(
      "ADR build contains no date-only publication timestamps to normalize",
    );
  }
  return { files: files.length, normalized };
}

async function collectStaticData(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectStaticData(path)));
    else if (entry.isFile() && /\.(?:html|json)$/u.test(entry.name))
      files.push(path);
  }
  return files;
}

async function main() {
  const index = process.argv.indexOf("--output");
  const output = index < 0 ? null : process.argv[index + 1];
  if (!output || output.startsWith("--"))
    throw new Error("--output requires a directory");
  if (process.argv.length !== 4) throw new Error("Only --output is supported");
  const result = await normalizeAdrPublicationDates(output);
  console.log(
    `Normalized ${result.normalized} ADR publication date value(s) in ${result.files} static file(s).`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  main().catch((error) => {
    console.error(`ADR date normalization failed: ${error.message}`);
    process.exitCode = 1;
  });
}
