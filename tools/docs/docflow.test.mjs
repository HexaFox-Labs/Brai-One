import assert from "node:assert/strict";
import test from "node:test";

import {
  classify,
  deriveSurfaces,
  requiredReviews,
  validateFinalization,
} from "./docflow.mjs";

const completeData = {
  files: ["packages/example/src/index.ts"],
  changed: [{ file: "packages/example/src/index.ts" }],
  checks: [{ name: "targeted-markdown", status: "passed" }],
};

test("classifies a typo as quick without durable reviews", () => {
  const classification = classify({
    intent: "fix a typo in the docs",
    files: ["docs/README.md"],
  });
  assert.equal(classification.route, "quick");
  assert.deepEqual(
    requiredReviews(
      {
        intent: "fix a typo in the docs",
        files: ["docs/README.md"],
      },
      classification,
    ),
    {
      docs: true,
      spec: false,
      adr: false,
      memory: false,
      deployment: false,
    },
  );
});

test("classifies a DB-only behavior change as full when it changes a contract", () => {
  const context = {
    source: "task-db",
    taskId: "task-42",
    intent: "change the NATS contract",
    files: ["packages/contracts/src/activity.ts"],
  };
  const classification = classify(context);
  assert.equal(classification.route, "full");
  assert.equal(classification.source, "task-db");
  assert.equal(classification.taskId, "task-42");
  assert.equal(requiredReviews(context, classification).spec, true);
  assert.equal(requiredReviews(context, classification).adr, true);
});

test("keeps an OpenSpec Change as the selected source", () => {
  const classification = classify({
    changeId: "docflow-governance",
    intent: "update the agent workflow",
    files: ["openspec/changes/docflow-governance/tasks.md"],
  });
  assert.equal(classification.source, "openspec");
  assert.equal(classification.changeId, "docflow-governance");
  assert.equal(classification.route, "full");
});

test("keeps a docs-only current-state update on the normal route", () => {
  const context = {
    intent: "update the current documentation",
    files: ["docs/reference/commands.md"],
  };
  const classification = classify(context);
  assert.equal(classification.source, "direct");
  assert.equal(classification.route, "normal");
  assert.equal(requiredReviews(context, classification).docs, true);
});

test("does not escalate an explicitly internal refactor", () => {
  const classification = classify({
    intent: "internal refactor without behavior change",
    files: ["packages/contracts/src/activity.ts"],
  });
  assert.equal(classification.route, "quick");
  assert.equal(
    requiredReviews(
      {
        intent: "internal refactor without behavior change",
        files: ["packages/contracts/src/activity.ts"],
      },
      classification,
    ).spec,
    false,
  );
});

test("keeps source mapping separate from task hierarchy", () => {
  assert.deepEqual(
    deriveSurfaces([
      "docs/decisions/0001-documentation-structure.md",
      "openspec/specs/documentation-governance/spec.md",
      "memory-bank/activeContext.md",
      "tools/docs/docflow.mjs",
    ]),
    ["adr", "code", "docs", "memory", "spec"],
  );
});

test("bounded uncertainty escalates to normal instead of inventing impact", () => {
  const classification = classify({ uncertain: true });
  assert.equal(classification.route, "normal");
  assert.equal(classification.uncertain, true);
  assert.equal(classification.signals.hardFull, false);
});

test("keeps spec drift open during finalization", () => {
  const context = {
    status: "spec-drift",
    intent: "change behavior",
    files: ["packages/example/src/index.ts"],
    docs: { status: "updated", links: ["docs/reference/example.md"] },
    spec: { status: "unchanged", reason: "higher-level decision required" },
    adr: { status: "not-required", reason: "no durable decision was made" },
    evidence: ["targeted test"],
  };
  const classification = classify(context);
  const errors = validateFinalization(
    context,
    classification,
    requiredReviews(context, classification),
    completeData,
  );
  assert.ok(errors.some((error) => error.includes("spec-drift")));
});

test("requires evidence for pending governance and conflict states", () => {
  for (const status of ["pending-governance", "conflict"]) {
    const context = {
      status,
      intent: "update current behavior",
      files: ["packages/example/src/index.ts"],
      docs: { status: "updated" },
      spec: { status: "unchanged", reason: "normative contract unchanged" },
      adr: { status: "not-required", reason: "no durable decision" },
      evidence: ["implementation test"],
    };
    const classification = classify(context);
    const errors = validateFinalization(
      context,
      classification,
      requiredReviews(context, classification),
      completeData,
    );
    assert.ok(errors.some((error) => error.includes(status)));
  }
});
