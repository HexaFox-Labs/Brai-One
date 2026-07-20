/* global process */

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseDeploymentManifest } from "../lib/deployment-manifest.mjs";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const productionImages = [
  "web",
  "api-gateway",
  "factory",
  "access",
  "factory-admin",
  "access-admin",
  "nats",
];

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
    expect(workflow).toContain("revision:");
    expect(workflow).toContain("startsWith(github.ref, 'refs/heads/release/')");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain(
      "REVISION: ${{ inputs.revision || github.sha }}",
    );
    expect(workflow).toContain("ROLLBACK_REVISION: ${{ inputs.revision }}");
    expect(workflow).toContain('if [[ ! "$REVISION" =~ ^[0-9a-f]{40}$ ]]');
    expect(workflow).toContain("sources=(dev)");
    expect(workflow).toContain("sources=(preview dev)");
    expect(workflow).toContain('for source in "${sources[@]}"; do');
    expect(workflow).toContain("brai-delivery-manifest-${source}-${REVISION}");
    expect(workflow).toContain(
      'host_contract_version: "brai.production-host.v3"',
    );
    expect(workflow).toContain("StrictHostKeyChecking=yes");
    expect(workflow).not.toContain("pull_request_target");
  });

  it("executes the checked-in delivery-to-production conversion against the single GHCR package", async () => {
    const workflow = await readFile(
      resolve(workspaceRoot, ".github/workflows/promote-production.yml"),
      "utf8",
    );
    const match = workflow.match(
      /- name: Convert and validate the fixed production receiver manifest[\s\S]*?node --input-type=module <<'NODE'\n([\s\S]*?)\n {10}NODE/u,
    );
    expect(match?.[1]).toBeDefined();
    const script = match[1].replace(/^ {10}/gmu, "");
    const directory = await mkdtemp(join(tmpdir(), "brai-production-convert-"));
    const repository = "HexaFox-Labs/Brai-One";
    const revision = "a".repeat(40);
    await writeFile(
      join(directory, "delivery-manifest.json"),
      JSON.stringify({
        schemaVersion: "brai.delivery.manifest.v1",
        repository,
        revision,
        images: Object.fromEntries(
          productionImages.map((name, index) => [
            name,
            `ghcr.io/hexafox-labs/brai-one@sha256:${String(index + 1).repeat(64)}`,
          ]),
        ),
      }),
    );
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REPOSITORY: repository,
          REVISION: revision,
        },
      },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const productionManifest = await readFile(
      join(directory, "production-manifest.json"),
      "utf8",
    );
    expect(() =>
      parseDeploymentManifest(productionManifest, repository),
    ).not.toThrow();
  });

  it("supplies an inert command to every commandless scratch-manifest reader", async () => {
    const workflows = await Promise.all(
      ["delivery.yml", "promote-production.yml"].map((name) =>
        readFile(resolve(workspaceRoot, ".github/workflows", name), "utf8"),
      ),
    );
    const extractionCommands = workflows
      .flatMap((workflow) =>
        workflow.match(/container=\$\(docker create [^)]+\)/gu),
      )
      .filter(Boolean);
    expect(extractionCommands).toEqual([
      'container=$(docker create "$image" /manifest.json)',
      'container=$(docker create "$source_image" /manifest.json)',
      'container=$(docker create "$image" /manifest.json)',
      'container=$(docker create "$image" /manifest.json)',
    ]);
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
    expect(delivery).toContain(
      "needs.reuse-preview-images.result == 'success' &&",
    );
    expect(delivery).toContain("entry.reference !== `${root}${entry.digest}`");
    expect(delivery).toContain("carry-forward-exact-manifest");
    expect(delivery).toContain("tools/ci/carry-forward-delivery-manifest.mjs");
    expect(delivery).toContain("brai-delivery-manifest-dev-current");
    expect(delivery).toContain("runtime-acceptance");
    expect(delivery).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    );
    expect(delivery).toContain(
      'git merge-base --is-ancestor "$base" "${PR_SHA:-$GITHUB_SHA}"',
    );
    expect(delivery).toContain(
      'base=$(git merge-base origin/dev "${PR_SHA:-$GITHUB_SHA}")',
    );
    expect(delivery).toMatch(
      /deliver:[\s\S]*?if: >-\n {6}always\(\) &&\n {6}needs\.assemble-request\.outputs\.request_available/u,
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
    expect(acceptance).toContain("workflow_dispatch:");
    expect(acceptance).toContain("github.actor == github.repository_owner");
    expect(acceptance).toContain("/v1/status?branch=");
    expect(acceptance).toContain("/statuses/${pullRequest.head.sha}");
    expect(acceptance).toContain('context: "runtime-acceptance"');
    expect(acceptance).toContain("mergeMethod: SQUASH");
    expect(acceptance).not.toContain("actions/checkout");
    expect(acceptance).not.toContain("pull_request_target");
    expect(acceptance).not.toContain("pull_request_review");
  });
});
