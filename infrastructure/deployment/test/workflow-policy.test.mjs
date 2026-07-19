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

  it("permits production only from an exact release preview in its protected job", async () => {
    const workflow = await readFile(
      resolve(workspaceRoot, ".github/workflows/promote-production.yml"),
      "utf8",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("startsWith(github.ref, 'refs/heads/release/')");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("preview-${REVISION}");
    expect(workflow).toContain("StrictHostKeyChecking=yes");
    expect(workflow).not.toContain("pull_request_target");
  });

  it("binds preview delivery and cleanup to same-repository OIDC jobs only", async () => {
    const [delivery, cleanup, acceptance] = await Promise.all([
      readFile(
        resolve(workspaceRoot, ".github/workflows/delivery.yml"),
        "utf8",
      ),
      readFile(
        resolve(workspaceRoot, ".github/workflows/preview-cleanup.yml"),
        "utf8",
      ),
      readFile(
        resolve(
          workspaceRoot,
          ".github/workflows/enable-runtime-automerge.yml",
        ),
        "utf8",
      ),
    ]);
    expect(delivery).toContain("id-token: write");
    expect(delivery).toContain("BRAI_DELIVERY_ENDPOINT");
    expect(delivery).toContain("make-images-public:");
    expect(delivery).toContain("/user/packages/container/brai-${IMAGE_NAME}");
    expect(delivery).not.toContain("pull_request_target");
    expect(cleanup).toContain("head.repo.full_name == github.repository");
    expect(cleanup).toContain("/v1/release");
    expect(cleanup).not.toContain("actions/checkout");
    expect(cleanup).not.toContain("pull_request_target");
    expect(acceptance).toContain(
      "github.event.review.user.login == github.repository_owner",
    );
    expect(acceptance).toContain("/v1/status?branch=");
    expect(acceptance).not.toContain("actions/checkout");
    expect(acceptance).not.toContain("pull_request_target");
  });
});
