import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const options = parseArguments(process.argv.slice(2));
const root = resolve(new URL("../..", import.meta.url).pathname);
const impact = JSON.parse(
  run(
    process.execPath,
    [
      "tools/ci/delivery-impact.mjs",
      `--base=${options.base}`,
      `--head=${options.head}`,
    ],
    {},
    "pipe",
  ),
);

run("pnpm", ["run", "format:check"]);
run(process.execPath, ["tools/docs/docs-check.mjs"]);
run(process.execPath, ["tools/stack/catalog.mjs", "check"]);

if (
  impact.deliveryClass === "documentation" ||
  impact.deliveryClass === "none"
) {
  printResult(impact, []);
  process.exit(0);
}

const targets = ["lint", "typecheck", "build", "test"];
const commands = [];
for (const target of targets) {
  const command = [
    "exec",
    "nx",
    "affected",
    "-t",
    target,
    `--base=${options.base}`,
    `--head=${options.head}`,
    "--nxBail",
    "--outputStyle=static",
  ];
  run("pnpm", command, { NODE_ENV: target === "test" ? "test" : "production" });
  commands.push(`nx affected -t ${target}`);
}

if (impact.images.includes("web") || impact.images.includes("api-gateway")) {
  run(
    "pnpm",
    [
      "exec",
      "nx",
      "affected",
      "-t",
      "e2e",
      `--base=${options.base}`,
      `--head=${options.head}`,
      "--nxBail",
      "--outputStyle=static",
    ],
    { NODE_ENV: "development" },
  );
  commands.push("nx affected -t e2e");
}

printResult(impact, commands);

function parseArguments(argumentsList) {
  const options = Object.fromEntries(
    argumentsList.map((argument) => {
      const [key, value] = argument.split("=", 2);
      return [key, value];
    }),
  );
  if (!options["--base"] || !options["--head"]) {
    throw new Error(
      "Usage: node tools/ci/run-affected.mjs --base=<sha> --head=<sha>",
    );
  }
  return { base: options["--base"], head: options["--head"] };
}

function run(command, argumentsList, environment = {}, stdio = "inherit") {
  const result = spawnSync(command, argumentsList, {
    cwd: root,
    env: {
      ...process.env,
      ...environment,
      NX_CLOUD: "false",
      NX_DAEMON: "false",
    },
    encoding: "utf8",
    stdio,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout ?? "";
}

function printResult(impact, commands) {
  process.stdout.write(`${JSON.stringify({ impact, commands }, null, 2)}\n`);
}
