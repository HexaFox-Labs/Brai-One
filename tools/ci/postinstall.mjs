import { spawnSync } from "node:child_process";

// pnpm reserves `pnpm ci` as a clean-install command, so the workspace
// check suite is attached to that command after dependencies are installed.
if (process.env.npm_command === "ci") {
  const result = spawnSync(process.execPath, ["tools/ci/run.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
