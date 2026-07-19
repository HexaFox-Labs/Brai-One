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
if (
  !["--check", "--check-dev", "--apply", "--apply-dev", "--remove"].includes(
    mode ?? "",
  )
) {
  throw new Error(
    "usage: manage-delivery-route.mjs --check|--check-dev|--apply|--apply-dev|--remove",
  );
}

const projectRoot = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../..",
);
const installedRouteRoot = process.env.BRAI_DELIVERY_CADDY_ROUTE_ROOT;
const routePath = installedRouteRoot
  ? resolve(
      installedRouteRoot,
      mode === "--check-dev" || mode === "--apply-dev"
        ? "delivery-dev.caddy"
        : "delivery.caddy",
    )
  : resolve(
      projectRoot,
      mode === "--check-dev" || mode === "--apply-dev"
        ? "infrastructure/caddy/delivery-dev.caddy"
        : "infrastructure/caddy/delivery.caddy",
    );
const caddyfile = process.env.BRAI_CADDYFILE ?? "/etc/caddy/Caddyfile";
const startMarker = "# BEGIN BRAI-NEW DELIVERY";
const endMarker = "# END BRAI-NEW DELIVERY";
const current = readFileSync(caddyfile, "utf8");
const candidate =
  mode === "--remove"
    ? removeManagedBlock(current)
    : upsertManagedBlock(current, readFileSync(routePath, "utf8").trim());
const metadata = lstatSync(caddyfile);
if (!metadata.isFile() || metadata.isSymbolicLink()) {
  throw new Error("Caddyfile must be a regular file");
}

const validationPath = resolve(
  tmpdir(),
  `brai-delivery-caddy-${process.pid}-${Date.now()}.caddy`,
);
try {
  writeFileSync(validationPath, candidate, { mode: 0o600 });
  validate(validationPath);
  if (mode === "--check" || mode === "--check-dev") {
    console.log(
      mode === "--check"
        ? "delivery_preview_caddy=valid"
        : "delivery_dev_caddy=valid",
    );
    process.exit(0);
  }
  if (process.geteuid?.() !== 0)
    throw new Error("Caddy route changes must run as root");
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const backupPath = `${caddyfile}.brai-delivery-${stamp}.bak`;
  const stagedPath = `${caddyfile}.brai-delivery-${process.pid}.tmp`;
  copyFileSync(caddyfile, backupPath);
  writeFileSync(stagedPath, candidate, { mode: metadata.mode & 0o777 });
  chownSync(stagedPath, metadata.uid, metadata.gid);
  chmodSync(stagedPath, metadata.mode & 0o777);
  renameSync(stagedPath, caddyfile);
  const reload = spawnSync("systemctl", ["reload", "caddy"], {
    encoding: "utf8",
  });
  if (reload.status !== 0) {
    copyFileSync(backupPath, caddyfile);
    chownSync(caddyfile, metadata.uid, metadata.gid);
    chmodSync(caddyfile, metadata.mode & 0o777);
    spawnSync("systemctl", ["reload", "caddy"], { stdio: "ignore" });
    throw new Error(
      "Caddy reload failed; the previous configuration was restored",
    );
  }
  console.log(
    mode === "--remove" ? "delivery_caddy=removed" : "delivery_caddy=installed",
  );
} finally {
  rmSync(validationPath, { force: true });
}

function upsertManagedBlock(source, block) {
  return `${removeManagedBlock(source).trimEnd()}\n\n${block}\n`;
}

function removeManagedBlock(source) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start === -1 && end === -1) return source;
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Caddy delivery markers are inconsistent");
  }
  return `${source.slice(0, start)}${source.slice(end + endMarker.length)}`.replace(
    /\n{3,}/g,
    "\n\n",
  );
}

function validate(path) {
  const result = spawnSync(
    "caddy",
    ["validate", "--adapter", "caddyfile", "--config", path],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0)
    throw new Error(`Caddy validation failed: ${result.stderr.trim()}`);
}
