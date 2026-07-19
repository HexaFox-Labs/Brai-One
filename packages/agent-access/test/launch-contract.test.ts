import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createInitialUserAccessState,
  issueInternalAgentLaunchContract,
  selectLaunchAccess,
  verifyInternalAgentLaunchContract,
} from "../src/index.js";

const USER_ID = "3f88bde1-2b49-46cb-914d-7500afdf82d6";
const RUN_ID = "4f88bde1-2b49-46cb-914d-7500afdf82d6";
const PROJECT_ID = "5f88bde1-2b49-46cb-914d-7500afdf82d6";
const ENVIRONMENT_ID = "6f88bde1-2b49-46cb-914d-7500afdf82d6";
const NOW = new Date("2026-07-17T02:00:00.000Z");
const EXPIRES = new Date("2026-07-17T02:05:00.000Z");

function keys() {
  return generateKeyPairSync("ed25519");
}

function issue() {
  const pair = keys();
  const contract = issueInternalAgentLaunchContract({
    runId: RUN_ID,
    projectId: PROJECT_ID,
    environmentId: ENVIRONMENT_ID,
    job: {
      reference: `brai-job:${RUN_ID}`,
      command_sha256: "a".repeat(64),
    },
    access: selectLaunchAccess(
      createInitialUserAccessState({ userId: USER_ID }),
    ),
    issuedAt: NOW,
    expiresAt: EXPIRES,
    keyId: "launch-key:2026-07",
    privateKey: pair.privateKey,
  });
  return { contract, pair };
}

describe("signed internal launch contracts", () => {
  it("issues and verifies an Ed25519 contract", () => {
    const { contract, pair } = issue();

    expect(
      verifyInternalAgentLaunchContract(contract, {
        now: new Date("2026-07-17T02:02:00.000Z"),
        resolvePublicKey: (keyId) =>
          keyId === contract.key_id ? pair.publicKey : undefined,
      }),
    ).toEqual(contract);
  });

  it("rejects every signed-field mutation", () => {
    const { contract, pair } = issue();
    const tampered = {
      ...contract,
      access: {
        ...contract.access,
        access_generation: contract.access.access_generation + 1,
      },
    };

    expect(() =>
      verifyInternalAgentLaunchContract(tampered, {
        now: new Date("2026-07-17T02:02:00.000Z"),
        resolvePublicKey: () => pair.publicKey,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "launch_contract_signature_invalid" }),
    );
  });

  it("binds project, environment, host, job reference and command digest", () => {
    const { contract, pair } = issue();
    for (const tampered of [
      { ...contract, project_id: USER_ID },
      { ...contract, environment_id: USER_ID },
      { ...contract, job: { ...contract.job, command_sha256: "b".repeat(64) } },
    ]) {
      expect(() =>
        verifyInternalAgentLaunchContract(tampered, {
          now: new Date("2026-07-17T02:02:00.000Z"),
          resolvePublicKey: () => pair.publicKey,
        }),
      ).toThrowError(
        expect.objectContaining({ code: "launch_contract_signature_invalid" }),
      );
    }
  });

  it("requires a sandbox environment and forbids one for developer", () => {
    const pair = keys();
    const sandboxAccess = selectLaunchAccess(
      createInitialUserAccessState({ userId: USER_ID }),
    );
    expect(() =>
      issueInternalAgentLaunchContract({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        environmentId: null,
        job: {
          reference: `brai-job:${RUN_ID}`,
          command_sha256: "a".repeat(64),
        },
        access: sandboxAccess,
        issuedAt: NOW,
        expiresAt: EXPIRES,
        keyId: "launch-key:2026-07",
        privateKey: pair.privateKey,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "launch_contract_invalid" }),
    );
  });

  it("fails closed for unknown keys and expired contracts", () => {
    const { contract, pair } = issue();

    expect(() =>
      verifyInternalAgentLaunchContract(contract, {
        now: new Date("2026-07-17T02:02:00.000Z"),
        resolvePublicKey: () => undefined,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "launch_contract_key_unknown" }),
    );

    expect(() =>
      verifyInternalAgentLaunchContract(contract, {
        now: new Date("2026-07-17T02:06:00.001Z"),
        clockSkewMs: 0,
        resolvePublicKey: () => pair.publicKey,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "launch_contract_expired" }),
    );
  });

  it("rejects contracts with an excessive lifetime", () => {
    const pair = keys();
    expect(() =>
      issueInternalAgentLaunchContract({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        environmentId: ENVIRONMENT_ID,
        job: {
          reference: `brai-job:${RUN_ID}`,
          command_sha256: "a".repeat(64),
        },
        access: selectLaunchAccess(
          createInitialUserAccessState({ userId: USER_ID }),
        ),
        issuedAt: NOW,
        expiresAt: new Date("2026-07-17T02:05:00.001Z"),
        keyId: "launch-key:2026-07",
        privateKey: pair.privateKey,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "launch_contract_invalid" }),
    );
  });
});
