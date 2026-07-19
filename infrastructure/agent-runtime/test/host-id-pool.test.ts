import {
  BRAI_SANDBOX_ID_POOL_COUNT,
  BRAI_SANDBOX_ID_POOL_END,
  BRAI_SANDBOX_ID_POOL_PRINCIPAL,
  BRAI_SANDBOX_ID_POOL_START,
  BRAI_SANDBOX_ID_POOL_SLOT_COUNT,
  LINUX_SIGNED_ID_BOUNDARY,
  SYSTEMD_FOREIGN_ID_POOL_START,
  SYSTEMD_NSPAWN_AUTO_ID_POOL_END,
} from "@brai/contracts";
import { describe, expect, it } from "vitest";
import {
  auditCanonicalHostIdPool,
  classifyHostIdPoolInstallation,
  parseGroupDocument,
  parsePasswdDocument,
  parseSubidDocument,
} from "../src/host-id-pool.js";
import { canonicalHostIdPoolFacts } from "./host-id-pool.fixture.js";

describe("canonical host ID pool", () => {
  it("is exactly the bounded systemd gap and provides 2047 user slots", () => {
    expect(BRAI_SANDBOX_ID_POOL_START).toBe(0x7000_0000);
    expect(BRAI_SANDBOX_ID_POOL_END).toBe(0x7ffd_ffff);
    expect(BRAI_SANDBOX_ID_POOL_COUNT).toBe(268_304_384);
    expect(BRAI_SANDBOX_ID_POOL_SLOT_COUNT).toBe(2_047);
    expect(BRAI_SANDBOX_ID_POOL_START).toBe(
      SYSTEMD_NSPAWN_AUTO_ID_POOL_END + 1,
    );
    expect(BRAI_SANDBOX_ID_POOL_END).toBe(SYSTEMD_FOREIGN_ID_POOL_START - 1);
    expect(BRAI_SANDBOX_ID_POOL_END).toBeLessThan(LINUX_SIGNED_ID_BOUNDARY);
  });

  it("accepts one exact locked no-login principal reservation", () => {
    const facts = canonicalHostIdPoolFacts();
    expect(auditCanonicalHostIdPool(facts)).toEqual([]);
    expect(classifyHostIdPoolInstallation(facts)).toBe("ready");
  });

  it("accepts only deterministic per-slot rootless-engine delegations", () => {
    const facts = canonicalHostIdPoolFacts();
    const engineName = "brai-eng-0";
    const engineId = BRAI_SANDBOX_ID_POOL_START + 1_000;
    const engine = {
      owner: String(engineId),
      start: BRAI_SANDBOX_ID_POOL_START + 65_536,
      count: 65_536,
    };
    expect(
      auditCanonicalHostIdPool({
        ...facts,
        passwdEntries: [
          ...facts.passwdEntries,
          {
            name: engineName,
            uid: engineId,
            gid: engineId,
            home: "/nonexistent",
            shell: "/usr/sbin/nologin",
          },
        ],
        groupEntries: [
          ...facts.groupEntries,
          { name: engineName, gid: engineId, members: [] },
        ],
        passwordLockedAccounts: [...facts.passwordLockedAccounts, engineName],
        subuidEntries: [...facts.subuidEntries, engine],
        subgidEntries: [...facts.subgidEntries, engine],
      }),
    ).toEqual([]);
    expect(
      auditCanonicalHostIdPool({
        ...facts,
        subuidEntries: [
          ...facts.subuidEntries,
          { ...engine, owner: "unexpected-user" },
        ],
      }).map(({ code }) => code),
    ).toContain("HOST_ID_POOL_SUBUID_OVERLAP");
    expect(
      auditCanonicalHostIdPool({
        ...facts,
        subgidEntries: [...facts.subgidEntries, engine, engine],
      }).map(({ code }) => code),
    ).toContain("HOST_ID_POOL_SUBGID_OVERLAP");
  });

  it("recognizes only a completely absent and collision-free install state", () => {
    const facts = canonicalHostIdPoolFacts();
    const absent = {
      ...facts,
      passwdEntries: facts.passwdEntries.filter(
        ({ name }) => name !== BRAI_SANDBOX_ID_POOL_PRINCIPAL,
      ),
      groupEntries: facts.groupEntries.filter(
        ({ name }) => name !== BRAI_SANDBOX_ID_POOL_PRINCIPAL,
      ),
      reservationPasswordLocked: null,
      subuidEntries: facts.subuidEntries.filter(
        ({ owner }) => owner !== BRAI_SANDBOX_ID_POOL_PRINCIPAL,
      ),
      subgidEntries: facts.subgidEntries.filter(
        ({ owner }) => owner !== BRAI_SANDBOX_ID_POOL_PRINCIPAL,
      ),
    };
    expect(classifyHostIdPoolInstallation(absent)).toBe("absent-clean");
    expect(
      classifyHostIdPoolInstallation({
        ...absent,
        subuidEntries: [
          ...absent.subuidEntries,
          {
            owner: "future-user",
            start: BRAI_SANDBOX_ID_POOL_START,
            count: 65_536,
          },
        ],
      }),
    ).toBe("invalid");
  });

  it("rejects a shifted, duplicate, partial, or unlocked reservation", () => {
    const facts = canonicalHostIdPoolFacts();
    const invalid = {
      ...facts,
      reservationPasswordLocked: false,
      subuidEntries: [
        ...facts.subuidEntries,
        {
          owner: BRAI_SANDBOX_ID_POOL_PRINCIPAL,
          start: BRAI_SANDBOX_ID_POOL_START,
          count: BRAI_SANDBOX_ID_POOL_COUNT,
        },
      ],
      subgidEntries: facts.subgidEntries.map((entry) =>
        entry.owner === BRAI_SANDBOX_ID_POOL_PRINCIPAL
          ? { ...entry, count: entry.count - 1 }
          : entry,
      ),
    };
    expect(auditCanonicalHostIdPool(invalid).map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "HOST_ID_POOL_PRINCIPAL_UNLOCKED",
        "HOST_ID_POOL_SUBUID_RESERVATION_INVALID",
        "HOST_ID_POOL_SUBGID_RESERVATION_INVALID",
      ]),
    );
  });

  it("rejects the reservation principal in every supplementary group", () => {
    const facts = canonicalHostIdPoolFacts();
    expect(
      auditCanonicalHostIdPool({
        ...facts,
        groupEntries: [
          ...facts.groupEntries,
          {
            name: "docker",
            gid: 999,
            members: [BRAI_SANDBOX_ID_POOL_PRINCIPAL],
          },
        ],
      }).map(({ code }) => code),
    ).toContain("HOST_ID_POOL_PRINCIPAL_INVALID");
  });

  it("rejects passwd/group IDs and a custom nspawn allocator in the pool", () => {
    const facts = canonicalHostIdPoolFacts();
    const issues = auditCanonicalHostIdPool({
      ...facts,
      passwdEntries: [
        ...facts.passwdEntries,
        {
          name: "future-user",
          uid: BRAI_SANDBOX_ID_POOL_START + 7,
          gid: 1000,
          home: "/home/future-user",
          shell: "/bin/bash",
        },
      ],
      groupEntries: [
        ...facts.groupEntries,
        {
          name: "future-group",
          gid: BRAI_SANDBOX_ID_POOL_END,
          members: [],
        },
      ],
      systemdContainerIdRange: {
        start: BRAI_SANDBOX_ID_POOL_START,
        count: 65_536,
      },
    });
    expect(issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "HOST_ID_POOL_PASSWD_COLLISION",
        "HOST_ID_POOL_GROUP_COLLISION",
        "HOST_ID_POOL_SYSTEMD_ALLOCATOR_COLLISION",
      ]),
    );
  });

  it("fails closed for non-enumerable NSS and non-files subid providers", () => {
    const facts = canonicalHostIdPoolFacts();
    expect(
      auditCanonicalHostIdPool({
        ...facts,
        passwdNssSources: ["files", "sss"],
        groupNssSources: ["files", "ldap"],
        subidNssSources: ["custom"],
      }).map(({ code }) => code),
    ).toContain("HOST_ID_POOL_NSS_SOURCE_UNSUPPORTED");
  });
});

describe("host identity source parsers", () => {
  it("rejects malformed and uint32-overflow subordinate ranges", () => {
    const parsed = parseSubidDocument(
      [
        "mark:100000:65536",
        "missing-field:100000",
        "negative:-1:65536",
        "leading-zero:010000:65536",
        "overflow:4294967294:2",
      ].join("\n"),
      "subuid",
    );
    expect(parsed.entries).toEqual([
      { owner: "mark", start: 100_000, count: 65_536 },
    ]);
    expect(parsed.issues).toHaveLength(4);
  });

  it("rejects duplicate and nested subordinate ranges globally", () => {
    const parsed = parseSubidDocument(
      [
        "first:100000:65536",
        "duplicate:100000:65536",
        "nested:110000:100",
      ].join("\n"),
      "subgid",
    );
    expect(parsed.issues).toHaveLength(2);
    expect(parsed.issues.every((issue) => issue.includes("overlap-with"))).toBe(
      true,
    );
  });

  it("rejects malformed and duplicate passwd/group records", () => {
    expect(
      parsePasswdDocument(
        [
          "root:x:0:0:root:/root:/bin/bash",
          "alias:x:0:0:alias:/nonexistent:/usr/sbin/nologin",
          "broken:x:not-a-number:1:broken:/nonexistent:/bin/false",
        ].join("\n"),
      ).issues,
    ).toEqual(["passwd:2:duplicate-uid", "passwd:3:invalid"]);
    expect(
      parseGroupDocument(["root:x:0:", "alias:x:0:", "broken:x:01:"].join("\n"))
        .issues,
    ).toEqual(["group:2:duplicate-gid", "group:3:invalid"]);
  });
});
