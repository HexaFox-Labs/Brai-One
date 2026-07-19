import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const output = await mkdtemp("/tmp/brai-new-adr-publish-");
const log4brainsCli = resolve(root, "node_modules/log4brains/dist/log4brains");
const target = readOption("--target");
const release = readOption("--release");

try {
  const build = await run(process.execPath, [
    log4brainsCli,
    "build",
    "--out",
    output,
  ]);
  if (build !== 0) process.exit(build);

  const theme = await run(process.execPath, [
    resolve(root, "tools/docs/apply-adr-theme.mjs"),
    "--output",
    output,
  ]);
  if (theme !== 0) process.exit(theme);

  const dates = await run(process.execPath, [
    resolve(root, "tools/docs/normalize-adr-dates.mjs"),
    "--output",
    output,
  ]);
  if (dates !== 0) process.exit(dates);

  const publishArgs = [
    "infrastructure/adr/publish-static.mjs",
    "--source",
    output,
  ];
  if (target) publishArgs.push("--target", target);
  if (release) publishArgs.push("--release", release);
  const publish = await run(process.execPath, publishArgs);
  if (publish !== 0) process.exit(publish);
} finally {
  await rm(output, { force: true, recursive: true });
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function run(command, args) {
  return new Promise((resolveStatus, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolveStatus(signal ? 1 : (code ?? 1));
    });
  });
}
