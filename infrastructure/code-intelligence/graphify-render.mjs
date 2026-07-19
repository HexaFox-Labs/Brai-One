import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const graphify =
  process.env.GRAPHIFY_BIN ?? "/srv/opt/graphify/current/bin/graphify";
const projectRoot =
  process.env.GRAPHIFY_PROJECT_ROOT ?? "/srv/projects/brai-new";
const vendorSource =
  process.env.GRAPHIFY_VENDOR_SOURCE ??
  "/srv/opt/graphify/vendor/vis-network/9.1.6/vis-network.min.js";
const outputRoot = resolve(projectRoot, "graphify-out");
const graphHtml = resolve(outputRoot, "graph.html");
const vendorTarget = resolve(outputRoot, "vendor/vis-network.min.js");
const remoteLibrary =
  "https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js";

const rebuild = spawnSync(
  graphify,
  ["cluster-only", projectRoot, "--no-label"],
  {
    encoding: "utf8",
    env: process.env,
  },
);

process.stdout.write(rebuild.stdout);
process.stderr.write(rebuild.stderr);
if (rebuild.status !== 0) process.exit(rebuild.status ?? 1);
if (!existsSync(graphHtml))
  throw new Error(`Graphify did not create ${graphHtml}.`);
if (!existsSync(vendorSource))
  throw new Error(`Missing pinned viewer asset: ${vendorSource}.`);

const html = readFileSync(graphHtml, "utf8");
if (!html.includes(remoteLibrary)) {
  throw new Error("Unexpected Graphify viewer script URL.");
}

mkdirSync(dirname(vendorTarget), { recursive: true });
copyFileSync(vendorSource, vendorTarget);
writeFileSync(
  graphHtml,
  html.replaceAll(remoteLibrary, "/vendor/vis-network.min.js"),
);
