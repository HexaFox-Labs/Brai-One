import { constants } from "node:fs";
import { chmod, mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  BRAI_SINGLE_RUNTIME_HOST_ID,
  INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
  LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
} from "@brai/contracts";

import {
  FilesystemDeveloperRunRegistry,
  type DeveloperRunRegistryRecord,
} from "../src/runtime-host-registry.js";

const roots: string[] = [];
const RUN_ID = "4f88bde1-2b49-46cb-914d-7500afdf82d6";

function envelope(purpose: "runtime-claim-v2" | "runtime-termination-v2") {
  return {
    version: 1 as const,
    purpose,
    key_id: "runtime-key:2026-07",
    payload: "{}",
    signature: "A".repeat(86),
  };
}

function record(): DeveloperRunRegistryRecord {
  const identity = {
    schemaVersion: 1 as const,
    profile: "developer" as const,
    runId: RUN_ID,
    jobDigestSha256: "a".repeat(64),
    unitName: `brai-developer-agent-${RUN_ID}.service`,
    bootId: "3f88bde1-2b49-46cb-914d-7500afdf82d6",
    invocationId: "b".repeat(32),
    controlGroup: `/system.slice/brai-developer-agent-${RUN_ID}.service`,
    controlGroupInode: "99117",
    mainPid: 4242,
    mainPidStartTimeTicks: "818181",
    uid: 1000,
    gid: 1000,
    supplementaryGids: [27, 999, 1000],
    systemd: {
      user: "mark" as const,
      group: "mark" as const,
      workingDirectory: "/srv/projects/brai-new" as const,
      umask: "0077" as const,
      killMode: "control-group" as const,
      noNewPrivileges: false as const,
    },
  };
  const launchReceipt = {
    kind: "developer-runtime-launched" as const,
    schemaVersion: 1 as const,
    observedAt: "2026-07-17T12:00:01.000Z",
    identity,
  };
  return {
    schema_version: 1,
    kind: "runtime",
    run_id: RUN_ID,
    phase: "held",
    launch_contract: {
      schema_version: INTERNAL_AGENT_LAUNCH_CONTRACT_SCHEMA_VERSION,
      run_id: RUN_ID,
      project_id: "1f88bde1-2b49-46cb-914d-7500afdf82d6",
      environment_id: null,
      runtime_host_id: BRAI_SINGLE_RUNTIME_HOST_ID,
      job: {
        reference: `brai.web-agent.codex-exec.v1:${"c".repeat(64)}`,
        command_sha256: "a".repeat(64),
      },
      access: {
        schema_version: LAUNCH_ACCESS_SNAPSHOT_SCHEMA_VERSION,
        user_id: "2f88bde1-2b49-46cb-914d-7500afdf82d6",
        profile: "developer",
        access_generation: 7,
        quota: { bytes: 5_368_709_120, inodes: 500_000 },
      },
      issued_at: "2026-07-17T12:00:00.000Z",
      expires_at: "2026-07-17T12:02:00.000Z",
      key_id: "launch-key:2026-07",
      signature: "A".repeat(86),
    },
    recovery: {
      rawLaunchReceipt: launchReceipt,
      mappedLaunchReceipt: launchReceipt,
      gate: {
        fifoPath: `/run/brai-agent-runtime/gates/${RUN_ID}.release`,
        readyPath: `/run/brai-agent-runtime/gates/${RUN_ID}.ready`,
        stdinPath: `/run/brai-agent-runtime/gates/${RUN_ID}.stdin`,
        token: "d".repeat(64),
      },
    },
    claim_receipt: envelope("runtime-claim-v2"),
    started_receipt: null,
    exit_receipt: null,
    termination_receipt: null,
    updated_at: "2026-07-17T12:00:01.000Z",
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

async function registry() {
  const root = await mkdtemp(`${tmpdir()}/brai-runtime-registry-`);
  roots.push(root);
  return {
    root,
    registry: new FilesystemDeveloperRunRegistry(root, false),
  };
}

describe("root-owned developer runtime registry", () => {
  it("atomically persists and reloads the exact recovery identity", async () => {
    const fixture = await registry();
    await fixture.registry.put(record());

    expect(await fixture.registry.get(RUN_ID)).toEqual(record());
    expect(await fixture.registry.listRecoverable()).toEqual([record()]);
    expect((await stat(`${fixture.root}/${RUN_ID}.json`)).mode & 0o7777).toBe(
      0o600,
    );
  });

  it("keeps a durable cancellation tombstone out of recovery", async () => {
    const fixture = await registry();
    await fixture.registry.put({
      schema_version: 1,
      kind: "cancellation",
      run_id: RUN_ID,
      project_id: "1f88bde1-2b49-46cb-914d-7500afdf82d6",
      user_id: "2f88bde1-2b49-46cb-914d-7500afdf82d6",
      access_generation: 7,
      termination_receipt: envelope("runtime-termination-v2"),
      updated_at: "2026-07-17T12:00:01.000Z",
    });

    expect((await fixture.registry.get(RUN_ID))?.kind).toBe("cancellation");
    expect(await fixture.registry.listRecoverable()).toEqual([]);
  });

  it("fails closed on a group-readable registry file", async () => {
    const fixture = await registry();
    await fixture.registry.put(record());
    await chmod(`${fixture.root}/${RUN_ID}.json`, 0o640);

    await expect(fixture.registry.get(RUN_ID)).rejects.toThrow(
      /ownership or mode/u,
    );
  });

  it("refuses a symlink-shaped record", async () => {
    const fixture = await registry();
    const target = `${fixture.root}/target`;
    const file = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    await file.close();
    await import("node:fs/promises").then(async ({ symlink }) => {
      await symlink(target, `${fixture.root}/${RUN_ID}.json`);
    });

    await expect(fixture.registry.get(RUN_ID)).rejects.toThrow(
      /ownership or mode/u,
    );
  });
});
