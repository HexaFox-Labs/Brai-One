import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { applyAdrTheme } from "./apply-adr-theme.mjs";

test("applies the dark theme to every static ADR HTML page", async () => {
  const output = await mkdtemp(resolve(tmpdir(), "brai-adr-theme-test-"));
  try {
    await writeFile(
      resolve(output, "index.html"),
      '<html><head><meta name="theme-color" content="#fff"/></head><body>home</body></html>',
    );
    await writeFile(
      resolve(output, "nested.html"),
      "<html><head></head><body>nested</body></html>",
    );
    const result = await applyAdrTheme(output);
    assert.equal(result.pages, 2);
    assert.match(
      await readFile(resolve(output, "index.html"), "utf8"),
      /#090a0c/,
    );
    assert.match(
      await readFile(resolve(output, "nested.html"), "utf8"),
      /data-brai-adr-theme="dark"/,
    );
    assert.match(
      await readFile(resolve(output, "brai-adr-theme.css"), "utf8"),
      /color-scheme: dark/,
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
