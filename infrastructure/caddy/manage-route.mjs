import {
  chmodSync,
  chownSync,
  copyFileSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

const mode = process.argv[2];
if (!["--check", "--apply", "--remove"].includes(mode ?? "")) {
  console.error("usage: node manage-route.mjs --check|--apply|--remove");
  process.exit(2);
}

const projectRoot = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../..",
);
const routePath = resolve(projectRoot, "infrastructure/caddy/factory.caddy");
const caddyfile = process.env.BRAI_CADDYFILE ?? "/etc/caddy/Caddyfile";
const startMarker = "# BEGIN BRAI-NEW FACTORY";
const endMarker = "# END BRAI-NEW FACTORY";
const route = readFileSync(routePath, "utf8").trim();
const current = readFileSync(caddyfile, "utf8");
const candidate =
  mode === "--remove"
    ? removeManagedBlock(current)
    : upsertManagedBlock(current, route);

const stat = lstatSync(caddyfile);
if (!stat.isFile() || stat.isSymbolicLink()) {
  throw new Error("Caddyfile must be a regular file.");
}

const validationPath = resolve(
  tmpdir(),
  `brai-new-caddy-${process.pid}-${Date.now()}.caddy`,
);

try {
  writeFileSync(validationPath, candidate, { mode: 0o600 });
  validate(validationPath);

  if (mode === "--check") {
    console.log("factory_caddy_route=valid");
    process.exit(0);
  }

  if (process.geteuid?.() !== 0) {
    throw new Error("--apply and --remove must run as root.");
  }

  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const backupPath = `${caddyfile}.brai-new-${stamp}.bak`;
  const stagedPath = `${caddyfile}.brai-new-${process.pid}.tmp`;
  copyFileSync(caddyfile, backupPath);
  writeFileSync(stagedPath, candidate, { mode: stat.mode & 0o777 });
  chownSync(stagedPath, stat.uid, stat.gid);
  chmodSync(stagedPath, stat.mode & 0o777);
  renameSync(stagedPath, caddyfile);

  const reload = spawnSync("systemctl", ["reload", "caddy"], {
    encoding: "utf8",
  });
  if (reload.status !== 0) {
    copyFileSync(backupPath, caddyfile);
    chownSync(caddyfile, stat.uid, stat.gid);
    chmodSync(caddyfile, stat.mode & 0o777);
    spawnSync("systemctl", ["reload", "caddy"], { stdio: "ignore" });
    throw new Error("Caddy reload failed; previous configuration restored.");
  }

  console.log(
    mode === "--remove"
      ? "factory_caddy_route=removed"
      : "factory_caddy_route=installed",
  );
} finally {
  rmSync(validationPath, { force: true });
}

function upsertManagedBlock(source, managedBlock) {
  const withoutExisting = removeManagedBlock(source).trimEnd();
  return `${withoutExisting}\n\n${managedBlock}\n`;
}

function removeManagedBlock(source) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start === -1 && end === -1) return source;
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Caddy managed block markers are inconsistent.");
  }
  const after = end + endMarker.length;
  return `${source.slice(0, start)}${source.slice(after)}`.replace(
    /\n{3,}/g,
    "\n\n",
  );
}

function validate(path) {
  const result = spawnSync(
    "caddy",
    ["validate", "--adapter", "caddyfile", "--config", path],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`Caddy validation failed: ${result.stderr.trim()}`);
  }
}
