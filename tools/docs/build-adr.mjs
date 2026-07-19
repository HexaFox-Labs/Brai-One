import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const defaultOutput = resolve(root, "dist/adr");
const log4brainsCli = resolve(root, "node_modules/log4brains/dist/log4brains");
const outputIndex = process.argv.indexOf("--out");
const output = resolve(
  root,
  outputIndex >= 0 && typeof process.argv[outputIndex + 1] === "string"
    ? process.argv[outputIndex + 1]
    : defaultOutput,
);

if (outputIndex >= 0 && !process.argv[outputIndex + 1]) {
  throw new Error("--out requires a directory");
}

await mkdir(output, { recursive: true });

const child = spawn(
  process.execPath,
  [log4brainsCli, "build", "--out", output],
  { cwd: root, stdio: "inherit" },
);

const status = await new Promise((resolveStatus, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) {
      reject(new Error(`Log4brains build terminated by ${signal}`));
    } else {
      resolveStatus(code ?? 1);
    }
  });
});

if (status !== 0) {
  process.exit(status);
}

const theme = spawn(
  process.execPath,
  [resolve(root, "tools/docs/apply-adr-theme.mjs"), "--output", output],
  { cwd: root, stdio: "inherit" },
);

const themeStatus = await new Promise((resolveStatus, reject) => {
  theme.once("error", reject);
  theme.once("exit", (code, signal) => {
    if (signal)
      reject(new Error(`ADR theme application terminated by ${signal}`));
    else resolveStatus(code ?? 1);
  });
});

if (themeStatus !== 0) process.exit(themeStatus);

const dates = spawn(
  process.execPath,
  [resolve(root, "tools/docs/normalize-adr-dates.mjs"), "--output", output],
  { cwd: root, stdio: "inherit" },
);

const dateStatus = await new Promise((resolveStatus, reject) => {
  dates.once("error", reject);
  dates.once("exit", (code, signal) => {
    if (signal)
      reject(new Error(`ADR date normalization terminated by ${signal}`));
    else resolveStatus(code ?? 1);
  });
});

if (dateStatus !== 0) process.exit(dateStatus);
