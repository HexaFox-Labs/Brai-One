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

  it("permits production only from an exact release preview or Dev manifest in its protected job", async () => {
    const workflow = await readFile(
      resolve(workspaceRoot, ".github/workflows/promote-production.yml"),
      "utf8",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("startsWith(github.ref, 'refs/heads/release/')");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("for source in preview dev; do");
    expect(workflow).toContain("brai-delivery-manifest-${source}-${REVISION}");
    expect(workflow).toContain("StrictHostKeyChecking=yes");
    expect(workflow).not.toContain("pull_request_target");
  });

  it("keeps OCI artifacts in one source-linked package and binds delivery to OIDC", async () => {
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
    expect(delivery).toContain(
      "needs: [verify-and-plan, reuse-preview-images, build-images]",
    );
    expect(delivery).toContain(
      "org.opencontainers.image.source=${{ github.server_url }}/${{ github.repository }}",
    );
    expect(delivery).toContain(
      "${{ steps.image.outputs.reference }}:brai-${{ matrix.image.image }}-sha-",
    );
    expect(delivery).toContain("brai-delivery-manifest-preview-${REVISION}");
    expect(delivery).toContain(
      "commits/${process.env.HEAD_SHA}/pulls?per_page=100",
    );
    expect(delivery).toContain(
      "manifest.revision !== process.env.PREVIEW_REVISION",
    );
    expect(delivery).toContain("reused-preview-digest-results-");
    expect(delivery).toContain(
      "needs.reuse-preview-images.outputs.available == 'true'",
    );
    const terminalManifestLogin =
      "Log into GHCR to retain the exact full delivery manifest";
    const terminalLoginIndex = delivery.indexOf(terminalManifestLogin);
    expect(terminalLoginIndex).toBeGreaterThanOrEqual(0);
    expect(delivery).toContain("if: steps.submit.outputs.state == 'deployed'");
    expect(terminalLoginIndex).toBeLessThan(
      delivery.indexOf("Publish the exact full dev image manifest"),
    );
    expect(terminalLoginIndex).toBeLessThan(
      delivery.indexOf("Publish the exact full preview manifest"),
    );
    expect(delivery).not.toContain("make-images-public:");
    expect(delivery).not.toContain("/packages/container/");
    expect(delivery).not.toContain("pull_request_target");
    expect(cleanup).toContain("head.repo.full_name == github.repository");
    expect(cleanup).toContain("types: [closed]");
    expect(cleanup).toContain("/v1/release");
    expect(cleanup).not.toContain("actions/checkout");
    expect(cleanup).not.toContain("pull_request_target");
    expect(acceptance).toContain(
      "github.event.review.user.login == github.repository_owner",
    );
    expect(acceptance).toContain("types: [submitted]");
    expect(acceptance).toContain("/v1/status?branch=");
    expect(acceptance).toContain("mergeMethod: SQUASH");
    expect(acceptance).not.toContain("actions/checkout");
    expect(acceptance).not.toContain("pull_request_target");
  });
});
