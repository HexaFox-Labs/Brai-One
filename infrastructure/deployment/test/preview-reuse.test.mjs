import { describe, expect, it } from "vitest";

import { imageNames } from "../../delivery/controller/constants.mjs";
import {
  extractPreviewDigests,
  resolvePreviewRevisions,
} from "../../../tools/ci/preview-reuse.mjs";

const repository = "HexaFox-Labs/Brai-One";
const digest = (index) => `sha256:${String(index + 1).repeat(64)}`;
const revision = (character) => character.repeat(40);

describe("Preview image reuse", () => {
  it("finds the newest accepted preview throughout an undelivered range", async () => {
    const commits = [revision("a"), revision("b"), revision("c")];
    const previews = {
      [commits[2]]: [],
      [commits[1]]: [pullRequest(commits[1], revision("d"))],
      [commits[0]]: [pullRequest(commits[0], revision("e"))],
    };
    const result = await resolvePreviewRevisions({
      base: revision("0"),
      head: revision("f"),
      repository,
      token: "test",
      commits,
      fetchPullRequests: async (commit) => previews[commit],
    });
    expect(result).toEqual([revision("d"), revision("e")]);
  });

  it("rejects ambiguous pull-request linkage", async () => {
    const commit = revision("a");
    await expect(
      resolvePreviewRevisions({
        base: revision("0"),
        head: revision("f"),
        repository,
        token: "test",
        commits: [commit],
        fetchPullRequests: async () => [
          pullRequest(commit, revision("b")),
          pullRequest(commit, revision("c")),
        ],
      }),
    ).rejects.toThrow(/ambiguous/u);
  });

  it("extracts affected digests from the canonical controller manifest", () => {
    const images = Object.fromEntries(
      imageNames.map((name, index) => [
        name,
        `ghcr.io/hexafox-labs/brai-one@${digest(index)}`,
      ]),
    );
    const result = extractPreviewDigests({
      impact: { images: ["web", "factory"] },
      manifest: {
        images,
        repository,
        revision: revision("a"),
        schemaVersion: "brai.delivery.manifest.v1",
      },
      repository,
      revision: revision("a"),
    });
    expect(result).toEqual({ web: digest(6), factory: digest(3) });
  });

  it("rejects the production-only object transport shape", () => {
    const images = Object.fromEntries(
      imageNames.map((name, index) => [
        name,
        {
          digest: digest(index),
          reference: `ghcr.io/hexafox-labs/brai-one@${digest(index)}`,
        },
      ]),
    );
    expect(() =>
      extractPreviewDigests({
        impact: { images: ["web"] },
        manifest: {
          images,
          repository,
          revision: revision("a"),
          schemaVersion: "brai.delivery.manifest.v1",
        },
        repository,
        revision: revision("a"),
      }),
    ).toThrow(/exact accepted revision/u);
  });
});

function pullRequest(mergeCommit, head) {
  return {
    merged_at: "2026-07-20T00:00:00Z",
    merge_commit_sha: mergeCommit,
    base: { ref: "dev" },
    head: { repo: { full_name: repository }, sha: head },
  };
}
