import {
  auditCanonicalHostIdPool,
  classifyHostIdPoolInstallation,
  collectHostIdPoolFacts,
} from "./host-id-pool.js";

const allowAbsent = process.argv.includes("--allow-absent");

try {
  const facts = await collectHostIdPoolFacts();
  const state = classifyHostIdPoolInstallation(facts);
  const issues = auditCanonicalHostIdPool(facts);
  process.stdout.write(
    `${JSON.stringify({
      ok: state === "ready",
      state,
      issues: issues.map(({ code }) => code),
    })}\n`,
  );
  if (state === "ready") process.exitCode = 0;
  else if (state === "absent-clean" && allowAbsent) process.exitCode = 10;
  else process.exitCode = 1;
} catch {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      state: "invalid",
      issues: ["HOST_ID_POOL_INSPECTION_FAILED"],
    })}\n`,
  );
  process.exitCode = 2;
}
