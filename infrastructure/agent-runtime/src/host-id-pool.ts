import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import {
  BRAI_SANDBOX_ID_POOL_COUNT,
  BRAI_SANDBOX_ID_POOL_END,
  BRAI_SANDBOX_ID_POOL_PRINCIPAL,
  BRAI_SANDBOX_ID_POOL_START,
  LINUX_SIGNED_ID_BOUNDARY,
  SYSTEMD_FOREIGN_ID_POOL_END,
  SYSTEMD_FOREIGN_ID_POOL_START,
} from "@brai/contracts";

const MAX_VALID_LINUX_ID = 0xffff_fffe;
const SYSTEMD_CONTAINER_BLOCK_SIZE = 65_536;
const REQUIRED_HOME = "/nonexistent";
const REQUIRED_SHELL = "/usr/sbin/nologin";

export interface HostPasswdEntry {
  readonly name: string;
  readonly uid: number;
  readonly gid: number;
  readonly home: string;
  readonly shell: string;
}

export interface HostGroupEntry {
  readonly name: string;
  readonly gid: number;
  readonly members: readonly string[];
}

export interface NamedSubidRange {
  readonly owner: string;
  readonly start: number;
  readonly count: number;
}

export interface HostIdPoolFacts {
  readonly inspectionCompleted: boolean;
  readonly parseIssues: readonly string[];
  readonly passwdEntries: readonly HostPasswdEntry[];
  readonly groupEntries: readonly HostGroupEntry[];
  /** null means the reservation principal has no readable shadow record. */
  readonly reservationPasswordLocked: boolean | null;
  /** Every locally enumerated account whose password field is locked. */
  readonly passwordLockedAccounts: readonly string[];
  readonly subuidEntries: readonly NamedSubidRange[];
  readonly subgidEntries: readonly NamedSubidRange[];
  readonly passwdNssSources: readonly string[];
  readonly groupNssSources: readonly string[];
  /** null means shadow-utils' documented files fallback is active. */
  readonly subidNssSources: readonly string[] | null;
  readonly systemdContainerIdRange: {
    readonly start: number;
    readonly count: number;
  } | null;
}

export type HostIdPoolIssueCode =
  | "HOST_ID_POOL_INSPECTION_INCOMPLETE"
  | "HOST_ID_POOL_SOURCE_PARSE_INVALID"
  | "HOST_ID_POOL_NSS_SOURCE_UNSUPPORTED"
  | "HOST_ID_POOL_SYSTEMD_ALLOCATOR_UNVERIFIED"
  | "HOST_ID_POOL_SYSTEMD_ALLOCATOR_COLLISION"
  | "HOST_ID_POOL_CANONICAL_BOUNDS_INVALID"
  | "HOST_ID_POOL_PASSWD_COLLISION"
  | "HOST_ID_POOL_GROUP_COLLISION"
  | "HOST_ID_POOL_PRINCIPAL_INVALID"
  | "HOST_ID_POOL_PRINCIPAL_UNLOCKED"
  | "HOST_ID_POOL_SUBUID_OVERLAP"
  | "HOST_ID_POOL_SUBGID_OVERLAP"
  | "HOST_ID_POOL_SUBUID_RESERVATION_INVALID"
  | "HOST_ID_POOL_SUBGID_RESERVATION_INVALID";

export interface HostIdPoolIssue {
  readonly code: HostIdPoolIssueCode;
  readonly message: string;
}

export interface ParsedHostIdDocument<T> {
  readonly entries: readonly T[];
  readonly issues: readonly string[];
}

export type HostIdPoolInstallationState = "ready" | "absent-clean" | "invalid";

function rangeEnd(range: { readonly start: number; readonly count: number }) {
  return range.start + range.count - 1;
}

function rangesOverlap(
  left: { readonly start: number; readonly count: number },
  right: { readonly start: number; readonly count: number },
): boolean {
  return left.start <= rangeEnd(right) && right.start <= rangeEnd(left);
}

function parseCanonicalInteger(
  value: string,
  options: { readonly positive?: boolean } = {},
): number | null {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) return null;
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < (options.positive ? 1 : 0) ||
    parsed > MAX_VALID_LINUX_ID
  ) {
    return null;
  }
  return parsed;
}

function validDatabaseName(value: string): boolean {
  return value !== "" && !/[:\s]/u.test(value);
}

export function parsePasswdDocument(
  content: string,
): ParsedHostIdDocument<HostPasswdEntry> {
  const entries: HostPasswdEntry[] = [];
  const issues: string[] = [];
  const names = new Set<string>();
  const uids = new Set<number>();

  content.split("\n").forEach((line, index) => {
    if (line === "") return;
    const fields = line.split(":");
    if (fields.length !== 7) {
      issues.push(`passwd:${index + 1}:field-count`);
      return;
    }
    const [name, , uidText, gidText, , home, shell] = fields;
    const uid = parseCanonicalInteger(uidText ?? "");
    const gid = parseCanonicalInteger(gidText ?? "");
    if (
      name === undefined ||
      !validDatabaseName(name) ||
      uid === null ||
      gid === null ||
      home === undefined ||
      home === "" ||
      shell === undefined ||
      shell === ""
    ) {
      issues.push(`passwd:${index + 1}:invalid`);
      return;
    }
    if (names.has(name)) issues.push(`passwd:${index + 1}:duplicate-name`);
    if (uids.has(uid)) issues.push(`passwd:${index + 1}:duplicate-uid`);
    names.add(name);
    uids.add(uid);
    entries.push({ name, uid, gid, home, shell });
  });

  return { entries, issues };
}

export function parseGroupDocument(
  content: string,
): ParsedHostIdDocument<HostGroupEntry> {
  const entries: HostGroupEntry[] = [];
  const issues: string[] = [];
  const names = new Set<string>();
  const gids = new Set<number>();

  content.split("\n").forEach((line, index) => {
    if (line === "") return;
    const fields = line.split(":");
    if (fields.length !== 4) {
      issues.push(`group:${index + 1}:field-count`);
      return;
    }
    const [name, , gidText, membersText] = fields;
    const gid = parseCanonicalInteger(gidText ?? "");
    const members =
      membersText === "" || membersText === undefined
        ? []
        : membersText.split(",");
    if (
      name === undefined ||
      !validDatabaseName(name) ||
      gid === null ||
      members.some((member) => !validDatabaseName(member))
    ) {
      issues.push(`group:${index + 1}:invalid`);
      return;
    }
    if (names.has(name)) issues.push(`group:${index + 1}:duplicate-name`);
    if (gids.has(gid)) issues.push(`group:${index + 1}:duplicate-gid`);
    names.add(name);
    gids.add(gid);
    entries.push({ name, gid, members });
  });

  return { entries, issues };
}

export function parseSubidDocument(
  content: string,
  label: "subuid" | "subgid",
): ParsedHostIdDocument<NamedSubidRange> {
  const entries: NamedSubidRange[] = [];
  const issues: string[] = [];

  content.split("\n").forEach((line, index) => {
    if (line === "") return;
    const fields = line.split(":");
    if (fields.length !== 3) {
      issues.push(`${label}:${index + 1}:field-count`);
      return;
    }
    const [owner, startText, countText] = fields;
    const start = parseCanonicalInteger(startText ?? "");
    const count = parseCanonicalInteger(countText ?? "", { positive: true });
    if (
      owner === undefined ||
      !validDatabaseName(owner) ||
      start === null ||
      count === null ||
      start + count - 1 > MAX_VALID_LINUX_ID
    ) {
      issues.push(`${label}:${index + 1}:invalid`);
      return;
    }
    entries.push({ owner, start, count });
  });

  const sorted = entries
    .map((range, index) => ({ range, index }))
    .sort(
      (left, right) =>
        left.range.start - right.range.start ||
        left.range.count - right.range.count ||
        left.range.owner.localeCompare(right.range.owner),
    );
  let furthest:
    { readonly range: NamedSubidRange; readonly index: number } | undefined;
  for (const current of sorted) {
    if (
      furthest !== undefined &&
      rangesOverlap(furthest.range, current.range) &&
      !isReservationDelegationPair(furthest.range, current.range)
    ) {
      issues.push(
        `${label}:${current.index + 1}:overlap-with:${furthest.index + 1}`,
      );
    }
    if (
      furthest === undefined ||
      rangeEnd(current.range) > rangeEnd(furthest.range)
    ) {
      furthest = current;
    }
  }

  return { entries, issues };
}

function isCanonicalEngineDelegation(range: NamedSubidRange): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(range.owner)) return false;
  const owner = Number(range.owner);
  if (!Number.isSafeInteger(owner) || range.count !== 65_536) return false;
  const relativeOwner = owner - BRAI_SANDBOX_ID_POOL_START - 1_000;
  if (relativeOwner < 0 || relativeOwner % 131_072 !== 0) {
    return false;
  }
  const slot = relativeOwner / 131_072;
  return (
    slot >= 0 &&
    slot <= 2_046 &&
    range.start === BRAI_SANDBOX_ID_POOL_START + slot * 131_072 + 65_536
  );
}

function canonicalEngineSlot(name: string): number | null {
  const match = /^brai-eng-([0-9a-z]+)$/u.exec(name);
  const suffix = match?.[1];
  if (suffix === undefined) return null;
  const slot = Number.parseInt(suffix, 36);
  return Number.isSafeInteger(slot) &&
    slot >= 0 &&
    slot <= 2_046 &&
    slot.toString(36) === suffix
    ? slot
    : null;
}

function canonicalEngineId(slot: number): number {
  return BRAI_SANDBOX_ID_POOL_START + slot * 131_072 + 1_000;
}

function isCanonicalEngineAccount(entry: HostPasswdEntry): boolean {
  const slot = canonicalEngineSlot(entry.name);
  if (slot === null) return false;
  const id = canonicalEngineId(slot);
  return (
    entry.uid === id &&
    entry.gid === id &&
    entry.home === REQUIRED_HOME &&
    entry.shell === REQUIRED_SHELL
  );
}

function isCanonicalEngineGroup(entry: HostGroupEntry): boolean {
  const slot = canonicalEngineSlot(entry.name);
  return (
    slot !== null &&
    entry.gid === canonicalEngineId(slot) &&
    entry.members.length === 0
  );
}

function isReservationDelegationPair(
  left: NamedSubidRange,
  right: NamedSubidRange,
): boolean {
  const isReservation = (range: NamedSubidRange): boolean =>
    range.owner === BRAI_SANDBOX_ID_POOL_PRINCIPAL &&
    range.start === BRAI_SANDBOX_ID_POOL_START &&
    range.count === BRAI_SANDBOX_ID_POOL_COUNT;
  return (
    (isReservation(left) && isCanonicalEngineDelegation(right)) ||
    (isReservation(right) && isCanonicalEngineDelegation(left))
  );
}

function parseShadowAccounts(content: string): ParsedHostIdDocument<{
  readonly name: string;
  readonly passwordLocked: boolean;
}> {
  const entries: { readonly name: string; readonly passwordLocked: boolean }[] =
    [];
  const issues: string[] = [];
  const seen = new Set<string>();
  content.split("\n").forEach((line, index) => {
    if (line === "") return;
    const fields = line.split(":");
    const name = fields[0];
    if (fields.length !== 9 || name === undefined || name === "") {
      issues.push(`shadow:${index + 1}:invalid`);
      return;
    }
    if (seen.has(name)) issues.push(`shadow:${index + 1}:duplicate-name`);
    seen.add(name);
    const password = fields[1] ?? "";
    entries.push({ name, passwordLocked: /^[!*]/u.test(password) });
  });
  return { entries, issues };
}

function parseNsswitchDocument(content: string): {
  readonly passwdSources: readonly string[];
  readonly groupSources: readonly string[];
  readonly subidSources: readonly string[] | null;
  readonly issues: readonly string[];
} {
  const databases = new Map<string, string[]>();
  const issues: string[] = [];
  content.split("\n").forEach((rawLine, index) => {
    const line = rawLine.replace(/#.*$/u, "").trim();
    if (line === "") return;
    const match = /^([a-z][a-z0-9_-]*):\s*(.*?)\s*$/u.exec(line);
    if (match === null) {
      issues.push(`nsswitch:${index + 1}:invalid`);
      return;
    }
    const [, database, value] = match;
    if (database === undefined || value === undefined) return;
    if (!["passwd", "group", "subid"].includes(database)) return;
    if (databases.has(database)) {
      issues.push(`nsswitch:${index + 1}:duplicate-${database}`);
      return;
    }
    const sources = value === "" ? [] : value.split(/\s+/u);
    if (sources.some((source) => !/^[a-z][a-z0-9_-]*$/u.test(source))) {
      issues.push(`nsswitch:${index + 1}:unsupported-actions`);
    }
    databases.set(database, sources);
  });
  return {
    passwdSources: databases.get("passwd") ?? [],
    groupSources: databases.get("group") ?? [],
    subidSources: databases.get("subid") ?? null,
    issues,
  };
}

function parseSystemdContainerRange(
  content: string,
): ParsedHostIdDocument<{ readonly start: number; readonly count: number }> {
  const values = new Map<string, number>();
  const issues: string[] = [];
  for (const [index, line] of content.split("\n").entries()) {
    const match =
      /^(container_uid_base_min|container_uid_base_max)=([0-9]+)$/u.exec(line);
    if (match === null) continue;
    const [, key, rawValue] = match;
    const value = parseCanonicalInteger(rawValue ?? "");
    if (key === undefined || value === null || values.has(key)) {
      issues.push(`systemd.pc:${index + 1}:invalid-container-boundary`);
      continue;
    }
    values.set(key, value);
  }
  const start = values.get("container_uid_base_min");
  const maximumBase = values.get("container_uid_base_max");
  if (start === undefined || maximumBase === undefined) {
    issues.push("systemd.pc:missing-container-boundary");
    return { entries: [], issues };
  }
  const end = maximumBase + SYSTEMD_CONTAINER_BLOCK_SIZE - 1;
  if (
    start % SYSTEMD_CONTAINER_BLOCK_SIZE !== 0 ||
    maximumBase % SYSTEMD_CONTAINER_BLOCK_SIZE !== 0 ||
    maximumBase < start ||
    end > MAX_VALID_LINUX_ID
  ) {
    issues.push("systemd.pc:invalid-container-range");
    return { entries: [], issues };
  }
  return { entries: [{ start, count: end - start + 1 }], issues };
}

function poolRange() {
  return {
    start: BRAI_SANDBOX_ID_POOL_START,
    count: BRAI_SANDBOX_ID_POOL_COUNT,
  } as const;
}

function supportedNssSources(sources: readonly string[]): boolean {
  return (
    sources.includes("files") &&
    sources.every((source) => source === "files" || source === "systemd")
  );
}

function exactReservation(entries: readonly NamedSubidRange[]): boolean {
  const owned = entries.filter(
    ({ owner }) => owner === BRAI_SANDBOX_ID_POOL_PRINCIPAL,
  );
  return (
    owned.length === 1 &&
    owned[0]?.start === BRAI_SANDBOX_ID_POOL_START &&
    owned[0]?.count === BRAI_SANDBOX_ID_POOL_COUNT
  );
}

function overlapsPool(range: {
  readonly start: number;
  readonly count: number;
}) {
  return rangesOverlap(range, poolRange());
}

export function auditCanonicalHostIdPool(
  facts: HostIdPoolFacts,
): readonly HostIdPoolIssue[] {
  const issues: HostIdPoolIssue[] = [];
  const add = (code: HostIdPoolIssueCode, message: string): void => {
    issues.push({ code, message });
  };

  if (!facts.inspectionCompleted) {
    add(
      "HOST_ID_POOL_INSPECTION_INCOMPLETE",
      "Every host identity database and allocator boundary must be read.",
    );
  }
  if (facts.parseIssues.length > 0) {
    add(
      "HOST_ID_POOL_SOURCE_PARSE_INVALID",
      `Host identity sources contain ${facts.parseIssues.length} malformed, duplicate, or overlapping record(s).`,
    );
  }
  if (
    !supportedNssSources(facts.passwdNssSources) ||
    !supportedNssSources(facts.groupNssSources) ||
    (facts.subidNssSources !== null &&
      (facts.subidNssSources.length !== 1 ||
        facts.subidNssSources[0] !== "files"))
  ) {
    add(
      "HOST_ID_POOL_NSS_SOURCE_UNSUPPORTED",
      "passwd/group NSS must be locally enumerable files[/systemd], and subid must use files or its documented files fallback.",
    );
  }

  const canonical = poolRange();
  if (
    canonical.start !== 0x7000_0000 ||
    rangeEnd(canonical) !== 0x7ffd_ffff ||
    BRAI_SANDBOX_ID_POOL_END >= LINUX_SIGNED_ID_BOUNDARY ||
    rangesOverlap(canonical, {
      start: SYSTEMD_FOREIGN_ID_POOL_START,
      count: SYSTEMD_FOREIGN_ID_POOL_END - SYSTEMD_FOREIGN_ID_POOL_START + 1,
    })
  ) {
    add(
      "HOST_ID_POOL_CANONICAL_BOUNDS_INVALID",
      "The canonical pool must remain 0x70000000..0x7FFDFFFF and below signed-32/foreign IDs.",
    );
  }
  if (facts.systemdContainerIdRange === null) {
    add(
      "HOST_ID_POOL_SYSTEMD_ALLOCATOR_UNVERIFIED",
      "The installed systemd automatic container allocation range was not measured.",
    );
  } else if (rangesOverlap(canonical, facts.systemdContainerIdRange)) {
    add(
      "HOST_ID_POOL_SYSTEMD_ALLOCATOR_COLLISION",
      "The canonical pool overlaps the installed systemd-nspawn automatic allocator.",
    );
  }

  const poolPasswd = facts.passwdEntries.filter(
    (entry) =>
      overlapsPool({ start: entry.uid, count: 1 }) &&
      (!isCanonicalEngineAccount(entry) ||
        !facts.passwordLockedAccounts.includes(entry.name)),
  );
  if (poolPasswd.length > 0) {
    add(
      "HOST_ID_POOL_PASSWD_COLLISION",
      `${poolPasswd.length} passwd UID(s) are not canonical locked engine principals.`,
    );
  }
  const canonicalEngineAccounts = facts.passwdEntries.filter(
    isCanonicalEngineAccount,
  );
  const canonicalEngineGroups = facts.groupEntries.filter(
    isCanonicalEngineGroup,
  );
  const poolGroups = facts.groupEntries.filter(
    (entry) =>
      overlapsPool({ start: entry.gid, count: 1 }) &&
      !isCanonicalEngineGroup(entry),
  );
  const enginePairMismatch =
    canonicalEngineAccounts.some(
      (account) =>
        !canonicalEngineGroups.some(
          (group) => group.name === account.name && group.gid === account.gid,
        ),
    ) ||
    canonicalEngineGroups.some(
      (group) =>
        !canonicalEngineAccounts.some(
          (account) => account.name === group.name && account.gid === group.gid,
        ),
    ) ||
    facts.groupEntries.some(({ members }) =>
      members.some((name) => canonicalEngineSlot(name) !== null),
    );
  if (poolGroups.length > 0 || enginePairMismatch) {
    add(
      "HOST_ID_POOL_GROUP_COLLISION",
      "A pool group is non-canonical, unpaired, or grants supplementary membership.",
    );
  }

  const principalAccounts = facts.passwdEntries.filter(
    ({ name }) => name === BRAI_SANDBOX_ID_POOL_PRINCIPAL,
  );
  const principalGroups = facts.groupEntries.filter(
    ({ name }) => name === BRAI_SANDBOX_ID_POOL_PRINCIPAL,
  );
  const supplementaryGroups = facts.groupEntries.filter(({ members }) =>
    members.includes(BRAI_SANDBOX_ID_POOL_PRINCIPAL),
  );
  const account = principalAccounts[0];
  const group = principalGroups[0];
  if (
    principalAccounts.length !== 1 ||
    principalGroups.length !== 1 ||
    account === undefined ||
    group === undefined ||
    account.uid === 0 ||
    account.gid !== group.gid ||
    overlapsPool({ start: account.uid, count: 1 }) ||
    overlapsPool({ start: group.gid, count: 1 }) ||
    account.home !== REQUIRED_HOME ||
    account.shell !== REQUIRED_SHELL ||
    group.members.length !== 0 ||
    supplementaryGroups.length !== 0
  ) {
    add(
      "HOST_ID_POOL_PRINCIPAL_INVALID",
      `The ${BRAI_SANDBOX_ID_POOL_PRINCIPAL} service principal must be unique, unprivileged, home-less, group-isolated, and use ${REQUIRED_SHELL}.`,
    );
  }
  if (facts.reservationPasswordLocked !== true) {
    add(
      "HOST_ID_POOL_PRINCIPAL_UNLOCKED",
      `The ${BRAI_SANDBOX_ID_POOL_PRINCIPAL} password must be locked.`,
    );
  }

  if (
    facts.parseIssues.some((issue) => issue.startsWith("subuid:")) ||
    facts.subuidEntries.some(
      (entry) =>
        entry.owner !== BRAI_SANDBOX_ID_POOL_PRINCIPAL &&
        !isCanonicalEngineDelegation(entry) &&
        overlapsPool(entry),
    ) ||
    facts.subuidEntries.some(
      (entry) =>
        isCanonicalEngineDelegation(entry) &&
        facts.subuidEntries.filter(({ owner }) => owner === entry.owner)
          .length !== 1,
    )
  ) {
    add(
      "HOST_ID_POOL_SUBUID_OVERLAP",
      "The subordinate UID database is malformed or has a conflicting range.",
    );
  }
  if (
    facts.parseIssues.some((issue) => issue.startsWith("subgid:")) ||
    facts.subgidEntries.some(
      (entry) =>
        entry.owner !== BRAI_SANDBOX_ID_POOL_PRINCIPAL &&
        !isCanonicalEngineDelegation(entry) &&
        overlapsPool(entry),
    ) ||
    facts.subgidEntries.some(
      (entry) =>
        isCanonicalEngineDelegation(entry) &&
        facts.subgidEntries.filter(({ owner }) => owner === entry.owner)
          .length !== 1,
    )
  ) {
    add(
      "HOST_ID_POOL_SUBGID_OVERLAP",
      "The subordinate GID database is malformed or has a conflicting range.",
    );
  }
  if (!exactReservation(facts.subuidEntries)) {
    add(
      "HOST_ID_POOL_SUBUID_RESERVATION_INVALID",
      `Exactly one ${BRAI_SANDBOX_ID_POOL_PRINCIPAL}:${BRAI_SANDBOX_ID_POOL_START}:${BRAI_SANDBOX_ID_POOL_COUNT} subuid reservation is required.`,
    );
  }
  if (!exactReservation(facts.subgidEntries)) {
    add(
      "HOST_ID_POOL_SUBGID_RESERVATION_INVALID",
      `Exactly one ${BRAI_SANDBOX_ID_POOL_PRINCIPAL}:${BRAI_SANDBOX_ID_POOL_START}:${BRAI_SANDBOX_ID_POOL_COUNT} subgid reservation is required.`,
    );
  }

  return issues;
}

export function classifyHostIdPoolInstallation(
  facts: HostIdPoolFacts,
): HostIdPoolInstallationState {
  const issues = auditCanonicalHostIdPool(facts);
  if (issues.length === 0) return "ready";

  const principalExists =
    facts.passwdEntries.some(
      ({ name }) => name === BRAI_SANDBOX_ID_POOL_PRINCIPAL,
    ) ||
    facts.groupEntries.some(
      ({ name }) => name === BRAI_SANDBOX_ID_POOL_PRINCIPAL,
    ) ||
    facts.reservationPasswordLocked !== null ||
    facts.subuidEntries.some(
      ({ owner }) => owner === BRAI_SANDBOX_ID_POOL_PRINCIPAL,
    ) ||
    facts.subgidEntries.some(
      ({ owner }) => owner === BRAI_SANDBOX_ID_POOL_PRINCIPAL,
    );
  const absenceIssues = new Set<HostIdPoolIssueCode>([
    "HOST_ID_POOL_PRINCIPAL_INVALID",
    "HOST_ID_POOL_PRINCIPAL_UNLOCKED",
    "HOST_ID_POOL_SUBUID_RESERVATION_INVALID",
    "HOST_ID_POOL_SUBGID_RESERVATION_INVALID",
  ]);
  return !principalExists && issues.every(({ code }) => absenceIssues.has(code))
    ? "absent-clean"
    : "invalid";
}

async function readableFile(path: string): Promise<string | null> {
  try {
    await access(path, constants.R_OK);
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function readSystemdPc(): Promise<string | null> {
  const candidates = [
    "/usr/share/pkgconfig/systemd.pc",
    "/usr/lib/pkgconfig/systemd.pc",
    "/usr/lib/x86_64-linux-gnu/pkgconfig/systemd.pc",
    "/usr/lib/aarch64-linux-gnu/pkgconfig/systemd.pc",
  ];
  for (const path of candidates) {
    const content = await readableFile(path);
    if (content !== null) return content;
  }
  return null;
}

export async function collectHostIdPoolFacts(): Promise<HostIdPoolFacts> {
  const [passwd, group, shadow, subuid, subgid, nsswitch, systemdPc] =
    await Promise.all([
      readableFile("/etc/passwd"),
      readableFile("/etc/group"),
      readableFile("/etc/shadow"),
      readableFile("/etc/subuid"),
      readableFile("/etc/subgid"),
      readableFile("/etc/nsswitch.conf"),
      readSystemdPc(),
    ]);

  const passwdResult = parsePasswdDocument(passwd ?? "");
  const groupResult = parseGroupDocument(group ?? "");
  const shadowResult = parseShadowAccounts(shadow ?? "");
  const subuidResult = parseSubidDocument(subuid ?? "", "subuid");
  const subgidResult = parseSubidDocument(subgid ?? "", "subgid");
  const nsswitchResult = parseNsswitchDocument(nsswitch ?? "");
  const systemdResult = parseSystemdContainerRange(systemdPc ?? "");

  return {
    inspectionCompleted: [
      passwd,
      group,
      shadow,
      subuid,
      subgid,
      nsswitch,
      systemdPc,
    ].every((content) => content !== null),
    parseIssues: [
      ...passwdResult.issues,
      ...groupResult.issues,
      ...shadowResult.issues,
      ...subuidResult.issues,
      ...subgidResult.issues,
      ...nsswitchResult.issues,
      ...systemdResult.issues,
    ],
    passwdEntries: passwdResult.entries,
    groupEntries: groupResult.entries,
    reservationPasswordLocked:
      shadowResult.entries.find(
        ({ name }) => name === BRAI_SANDBOX_ID_POOL_PRINCIPAL,
      )?.passwordLocked ?? null,
    passwordLockedAccounts: shadowResult.entries
      .filter(({ passwordLocked }) => passwordLocked)
      .map(({ name }) => name),
    subuidEntries: subuidResult.entries,
    subgidEntries: subgidResult.entries,
    passwdNssSources: nsswitchResult.passwdSources,
    groupNssSources: nsswitchResult.groupSources,
    subidNssSources: nsswitchResult.subidSources,
    systemdContainerIdRange: systemdResult.entries[0] ?? null,
  };
}
