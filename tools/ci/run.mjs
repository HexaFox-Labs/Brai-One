import { spawnSync } from "node:child_process";

const targets = ["access-policy", "lint", "typecheck", "build", "test", "e2e"];

const formatting = spawnSync("pnpm", ["run", "format:check"], {
  cwd: new URL("../..", import.meta.url),
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "production" },
  stdio: "inherit",
});

if (formatting.error) throw formatting.error;
if (formatting.status !== 0) process.exit(formatting.status ?? 1);

const documentation = spawnSync(
  process.execPath,
  ["tools/docs/docs-check.mjs"],
  {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "production" },
    stdio: "inherit",
  },
);

if (documentation.error) throw documentation.error;
if (documentation.status !== 0) process.exit(documentation.status ?? 1);

const stack = spawnSync(
  process.execPath,
  ["tools/stack/catalog.mjs", "check"],
  {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "production" },
    stdio: "inherit",
  },
);

if (stack.error) throw stack.error;
if (stack.status !== 0) process.exit(stack.status ?? 1);

const adrAutomation = spawnSync(
  process.execPath,
  ["--test", "infrastructure/adr/auto-publish.test.mjs"],
  {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, NODE_ENV: "test" },
    stdio: "inherit",
  },
);

if (adrAutomation.error) throw adrAutomation.error;
if (adrAutomation.status !== 0) process.exit(adrAutomation.status ?? 1);

const adrTheme = spawnSync(
  process.execPath,
  ["--test", "tools/docs/apply-adr-theme.test.mjs"],
  {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, NODE_ENV: "test" },
    stdio: "inherit",
  },
);

if (adrTheme.error) throw adrTheme.error;
if (adrTheme.status !== 0) process.exit(adrTheme.status ?? 1);

const adrDates = spawnSync(
  process.execPath,
  [
    "--test",
    "tools/docs/adr-date.test.mjs",
    "tools/docs/normalize-adr-dates.test.mjs",
  ],
  {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, NODE_ENV: "test" },
    stdio: "inherit",
  },
);

if (adrDates.error) throw adrDates.error;
if (adrDates.status !== 0) process.exit(adrDates.status ?? 1);

for (const target of targets) {
  const nodeEnv =
    target === "test"
      ? "test"
      : target === "e2e"
        ? "development"
        : (process.env.NODE_ENV ?? "production");
  const result = spawnSync(
    "nx",
    ["run-many", "-t", target, "--all", "--nxBail", "--outputStyle=static"],
    {
      cwd: new URL("../..", import.meta.url),
      env: {
        ...process.env,
        NODE_ENV: nodeEnv,
        NX_CLOUD: "false",
        NX_DAEMON: "false",
      },
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const compose = spawnSync(
  "docker",
  ["compose", "--profile", "*", "config", "--quiet"],
  {
    cwd: new URL("../..", import.meta.url),
    env: {
      ...process.env,
      BRAI_CONFIG_DIR: "/tmp/brai-new-compose-config-not-present",
    },
    stdio: "inherit",
  },
);

if (compose.error) throw compose.error;
if (compose.status !== 0) process.exit(compose.status ?? 1);
