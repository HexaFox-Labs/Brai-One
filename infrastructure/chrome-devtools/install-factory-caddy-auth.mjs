#!/usr/bin/env node

import fs from "node:fs";

const mode = process.argv[2];
if (!new Set(["--check", "--install"]).has(mode)) {
  console.error("usage: install-factory-caddy-auth.mjs --check|--install");
  process.exit(2);
}

const policyFile =
  process.env.CHROME_DEVTOOLS_CADDY_AUTH_POLICY ??
  "/srv/opt/chrome-devtools-mcp/node_modules/chrome-devtools-mcp/build/src/tools/caddy-auth-policy.js";
const anchor = "  'admin.brightos.world',";
const protectedHosts = ["  'factory.brai.one',", "  'codegraph.brai.one',"];

const current = fs.readFileSync(policyFile, "utf8");
if (
  !current.includes("const ALLOWED_HOSTS = new Set([") ||
  !current.includes(anchor)
) {
  throw new Error("Unsupported Chrome DevTools Caddy auth policy layout");
}

const missingHosts = protectedHosts.filter((host) => !current.includes(host));
const updated =
  missingHosts.length === 0
    ? current
    : current.replace(anchor, `${anchor}\n${missingHosts.join("\n")}`);

if (mode === "--check") {
  if (updated !== current) {
    throw new Error(
      "A protected Brai host is missing from the Chrome DevTools Caddy auth allowlist",
    );
  }
  console.log("factory_caddy_auth_allowlist=ok");
  process.exit(0);
}

if (updated !== current) fs.writeFileSync(policyFile, updated);
console.log("brai_caddy_auth_allowlist=installed");
