/* global fetch, process */

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { overlayManifest } from "../../infrastructure/delivery/controller/image-manifest.mjs";

const revisionPattern = /^[0-9a-f]{40}$/u;

export async function resolvePreviewRevisions({
  base,
  head,
  repository,
  token,
  fetchPullRequests = fetchAssociatedPullRequests,
  commits,
}) {
  requireRevision(base);
  requireRevision(head);
  const revisions = [];
  for (const commit of [...(commits ?? listCommits(base, head))].reverse()) {
    requireRevision(commit);
    const pullRequests = await fetchPullRequests(commit, repository, token);
    const candidates = pullRequests.filter(
      (pullRequest) =>
        pullRequest.merged_at &&
        pullRequest.merge_commit_sha === commit &&
        pullRequest.base?.ref === "dev" &&
        pullRequest.head?.repo?.full_name === repository &&
        revisionPattern.test(pullRequest.head?.sha ?? ""),
    );
    if (candidates.length > 1) {
      throw new Error(`Dev commit ${commit} has ambiguous pull requests`);
    }
    const revision = candidates[0]?.head.sha;
    if (revision && !revisions.includes(revision)) revisions.push(revision);
  }
  return revisions;
}

export function extractPreviewDigests({
  impact,
  manifest,
  repository,
  revision,
}) {
  if (
    manifest.repository !== repository ||
    manifest.revision !== revision ||
    manifest.schemaVersion !== "brai.delivery.manifest.v1" ||
    manifest.images === null ||
    typeof manifest.images !== "object" ||
    Array.isArray(manifest.images) ||
    Object.values(manifest.images).some(
      (reference) => typeof reference !== "string",
    )
  ) {
    throw new Error("Preview manifest is not for the exact accepted revision");
  }
  const validated = overlayManifest(manifest.images, {}, manifest.revision, {
    repository,
  });
  if (!Array.isArray(impact.images)) {
    throw new Error("Delivery impact has no image list");
  }
  return Object.fromEntries(
    impact.images.map((name) => {
      const reference = validated.images[name];
      if (!reference) {
        throw new Error(`Preview manifest has no trusted ${name} digest`);
      }
      return [name, reference.slice(reference.lastIndexOf("@") + 1)];
    }),
  );
}

async function fetchAssociatedPullRequests(commit, repository, token) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/commits/${commit}/pulls?per_page=100`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Cannot resolve pull request for ${commit}: ${response.status}`,
    );
  }
  return response.json();
}

function listCommits(base, head) {
  return execFileSync("git", ["rev-list", "--reverse", `${base}..${head}`], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
}

function requireRevision(value) {
  if (!revisionPattern.test(value)) {
    throw new Error("Preview reuse requires full Git revisions");
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "candidates" && args.length === 2) {
    const revisions = await resolvePreviewRevisions({
      base: args[0],
      head: args[1],
      repository: requiredEnvironment("GITHUB_REPOSITORY"),
      token: requiredEnvironment("GITHUB_TOKEN"),
    });
    process.stdout.write(JSON.stringify(revisions));
    return;
  }
  if (command === "extract" && args.length === 4) {
    const [impactPath, manifestPath, outputDirectory, revision] = args;
    const [impact, manifest] = await Promise.all(
      [impactPath, manifestPath].map((path) =>
        readFile(path, "utf8").then(JSON.parse),
      ),
    );
    const digests = extractPreviewDigests({
      impact,
      manifest,
      repository: requiredEnvironment("GITHUB_REPOSITORY"),
      revision,
    });
    await mkdir(outputDirectory, { recursive: true });
    await Promise.all(
      Object.entries(digests).map(([name, digest]) =>
        writeFile(`${outputDirectory}/${name}.digest`, `${digest}\n`, {
          mode: 0o600,
        }),
      ),
    );
    return;
  }
  throw new Error(
    "Usage: preview-reuse candidates <base> <head> | extract <impact> <manifest> <output-dir> <revision>",
  );
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) await main();
