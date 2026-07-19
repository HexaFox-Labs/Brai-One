import {
  BRAI_SANDBOX_ID_POOL_COUNT,
  BRAI_SANDBOX_ID_POOL_PRINCIPAL,
  BRAI_SANDBOX_ID_POOL_START,
  SYSTEMD_NSPAWN_AUTO_ID_POOL_END,
  SYSTEMD_NSPAWN_AUTO_ID_POOL_START,
} from "@brai/contracts";
import type { HostIdPoolFacts } from "../src/host-id-pool.js";

export function canonicalHostIdPoolFacts(): HostIdPoolFacts {
  return {
    inspectionCompleted: true,
    parseIssues: [],
    passwdEntries: [
      { name: "root", uid: 0, gid: 0, home: "/root", shell: "/bin/bash" },
      {
        name: BRAI_SANDBOX_ID_POOL_PRINCIPAL,
        uid: 990,
        gid: 990,
        home: "/nonexistent",
        shell: "/usr/sbin/nologin",
      },
    ],
    groupEntries: [
      { name: "root", gid: 0, members: [] },
      {
        name: BRAI_SANDBOX_ID_POOL_PRINCIPAL,
        gid: 990,
        members: [],
      },
    ],
    reservationPasswordLocked: true,
    passwordLockedAccounts: [BRAI_SANDBOX_ID_POOL_PRINCIPAL],
    subuidEntries: [
      { owner: "mark", start: 100_000, count: 65_536 },
      {
        owner: BRAI_SANDBOX_ID_POOL_PRINCIPAL,
        start: BRAI_SANDBOX_ID_POOL_START,
        count: BRAI_SANDBOX_ID_POOL_COUNT,
      },
    ],
    subgidEntries: [
      { owner: "mark", start: 100_000, count: 65_536 },
      {
        owner: BRAI_SANDBOX_ID_POOL_PRINCIPAL,
        start: BRAI_SANDBOX_ID_POOL_START,
        count: BRAI_SANDBOX_ID_POOL_COUNT,
      },
    ],
    passwdNssSources: ["files", "systemd"],
    groupNssSources: ["files", "systemd"],
    subidNssSources: null,
    systemdContainerIdRange: {
      start: SYSTEMD_NSPAWN_AUTO_ID_POOL_START,
      count:
        SYSTEMD_NSPAWN_AUTO_ID_POOL_END - SYSTEMD_NSPAWN_AUTO_ID_POOL_START + 1,
    },
  };
}
