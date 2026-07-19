import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const now = Date.now();
const graphifyStatus = "/srv/opt/graphify/state/brai-new/status.json";
const socratiStatus = "/srv/opt/graphify/state/brai-new/socraticode-status.json";
const services = [
  "brai-graphify-watch.service",
  "brai-graphify-view.service",
  "brai-graphify-mcp.service",
  "brai-socraticode.service",
];

function active(unit) {
  return spawnSync("/bin/systemctl", ["is-active", "--quiet", unit]).status === 0;
}

function restart(unit, reason) {
  console.error(`${unit}: ${reason}; restarting`);
  const result = spawnSync("/bin/systemctl", ["restart", unit], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `restart exited ${result.status}`);
}

function readFreshStatus(path, maxAgeMs, expectedPhases) {
  if (!existsSync(path)) return `missing status file ${path}`;
  let status;
  try {
    status = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return `invalid status file ${path}`;
  }
  const timestamp = Date.parse(status.lastProgressAt ?? status.checkedAt ?? "");
  if (!Number.isFinite(timestamp) || now - timestamp > maxAgeMs) return "status is stale";
  if (status.ok === false || !expectedPhases.includes(status.phase)) return status.error ?? `phase ${status.phase}`;
  return null;
}

for (const unit of services) {
  if (!active(unit)) restart(unit, "not active");
}

const graphifyProblem = readFreshStatus(graphifyStatus, 15 * 60_000, ["ready"]);
if (graphifyProblem) restart("brai-graphify-watch.service", graphifyProblem);

const socratiProblem = readFreshStatus(socratiStatus, 30 * 60_000, ["indexing", "ready"]);
if (socratiProblem) restart("brai-socraticode.service", socratiProblem);

console.log("Code-intelligence health check passed.");
