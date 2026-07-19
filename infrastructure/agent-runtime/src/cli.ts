#!/usr/bin/env node
import { resolve } from "node:path";
import {
  collectDeveloperFacts,
  collectUserSandboxFacts,
} from "./host-facts.js";
import {
  evaluateDeveloperPreflight,
  evaluateUserSandboxPreflight,
} from "./preflight.js";
import type { AccessProfile } from "./model.js";

const DEFAULT_STORAGE_PATH = "/srv/brai-user-data";
const DEFAULT_IMAGE_PATH =
  "/srv/opt/brai-agent-runtime/images/user-sandbox-v1.raw";

interface CliOptions {
  readonly profile: AccessProfile;
  readonly checkoutPath: string;
  readonly storagePath: string;
  readonly environmentName: string | null;
  readonly imagePath: string;
}

function usage(): string {
  return [
    "Usage:",
    "  tsx src/cli.ts --profile developer [--checkout PATH]",
    "  tsx src/cli.ts --profile user-sandbox --environment-name NAME [--storage PATH] [--image PATH]",
    "",
    "The CLI only verifies a profile already selected by trusted server code; it never grants rights.",
  ].join("\n");
}

function parseArguments(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === undefined || !key.startsWith("--") || value === undefined) {
      throw new Error(usage());
    }
    values.set(key, value);
  }
  const profile = values.get("--profile");
  if (profile !== "developer" && profile !== "user-sandbox") {
    throw new Error(usage());
  }
  const environmentName = values.get("--environment-name") ?? null;
  if (profile === "user-sandbox" && environmentName === null) {
    throw new Error(usage());
  }
  return {
    profile,
    checkoutPath: resolve(values.get("--checkout") ?? process.cwd()),
    storagePath: resolve(values.get("--storage") ?? DEFAULT_STORAGE_PATH),
    environmentName,
    imagePath: resolve(values.get("--image") ?? DEFAULT_IMAGE_PATH),
  };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const result =
    options.profile === "developer"
      ? evaluateDeveloperPreflight(
          await collectDeveloperFacts(options.checkoutPath),
        )
      : evaluateUserSandboxPreflight(
          await collectUserSandboxFacts({
            storagePath: options.storagePath,
            environmentName: options.environmentName ?? "",
            imagePath: options.imagePath,
          }),
        );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
});
