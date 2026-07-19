import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "../../..");

describe("GitHub delivery workflow policy", () => {
  it("runs project code only for primary-repository pull requests", async () => {
    const workflow = await readFile(
      resolve(workspaceRoot, ".github/workflows/ci.yml"),
      "utf8",
    );
    expect(workflow).toContain("head.repo.full_name == github.repository");
    expect(workflow).not.toContain("pull_request_target");
    expect(workflow).not.toContain("issue_comment");
  });

  it("uses exact base/head affected checks and never deploys production", async () => {
    const workflow = await readFile(
      resolve(workspaceRoot, ".github/workflows/ci.yml"),
      "utf8",
    );
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("tools/ci/run-affected.mjs");
    expect(workflow).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    );
    expect(workflow).not.toContain("deploy-production:");
    expect(workflow).not.toContain("BRAI_PRODUCTION_DEPLOY_PRIVATE_KEY");
  });
});
