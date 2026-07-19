import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { spawn } from "node:child_process";

test("delivery endpoint strips its public Caddy prefix before proxying", async () => {
  await run("node", [
    new URL("./render-delivery-routes.mjs", import.meta.url).pathname,
  ]);
  const preview = await readFile(
    new URL("./delivery.caddy", import.meta.url),
    "utf8",
  );
  assert.match(preview, /handle_path \/__brai-delivery\/\* \{/u);
  assert.doesNotMatch(preview, /@delivery path/u);
});

/** @param {string} command @param {string[]} argumentsList */
function run(command, argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command ${command} exited with ${code}`));
    });
  });
}
