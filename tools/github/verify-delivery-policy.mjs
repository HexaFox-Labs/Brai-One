const repository = process.argv[2] ?? process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
  throw new Error(
    "Usage: GH_TOKEN=… node tools/github/verify-delivery-policy.mjs OWNER/REPOSITORY",
  );
}
if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN is required");

const headers = {
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "x-github-api-version": "2022-11-28",
};
const [repo, actions, dev, endpoint, production] = await Promise.all([
  get(`/repos/${repository}`),
  get(`/repos/${repository}/actions/permissions/workflow`),
  get(`/repos/${repository}/branches/dev/protection`),
  get(`/repos/${repository}/actions/variables/BRAI_DELIVERY_ENDPOINT`),
  get(`/repos/${repository}/environments/production`),
]);

assert(
  repo.visibility === "public",
  "Repository visibility must remain public",
);
assert(
  repo.allow_auto_merge === true,
  "GitHub native auto-merge must be enabled",
);
assert(repo.delete_branch_on_merge === true, "Merged branches must be deleted");
assert(
  actions.default_workflow_permissions === "read" &&
    actions.can_approve_pull_request_reviews === false,
  "Default workflow permissions must be read-only",
);
assert(
  dev.required_status_checks?.contexts?.includes("affected-verify"),
  "dev must require affected-verify",
);
assert(
  endpoint.value === "https://preview-01.brai.one/__brai-delivery",
  "Delivery endpoint must target the controller Caddy route",
);
assert(
  production.protection_rules?.some(
    (rule) => rule.type === "required_reviewers",
  ),
  "production requires Sergey approval",
);
assert(
  production.deployment_branch_policy?.custom_branch_policies === true,
  "production must use an explicit release branch policy",
);
console.log(`delivery_policy=valid repository=${repository}`);

async function get(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok)
    throw new Error(`GitHub API ${path} failed: ${response.status}`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
