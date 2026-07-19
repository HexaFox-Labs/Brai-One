import { lstatSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  AsyncTransactionError,
  DatabaseBackupInProgressError,
  InvalidUserDatabasePathError,
  StoragePoolFullError,
  StorageQuotaExceededError,
  TransactionDeadlineExceededError,
  TransactionScopeClosedError,
  mapUserDatabaseError,
  openUserProjectDatabase,
} from "../src/index.js";

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "brai-user-db-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("user project SQLite database", () => {
  it("runs on the patched SQLite line", () => {
    expect(
      compareVersions(process.versions.sqlite ?? "0", "3.51.3"),
    ).toBeGreaterThanOrEqual(0);
  });

  it("opens a private WAL database with foreign keys and a busy timeout", () => {
    const root = temporaryRoot();
    const database = openUserProjectDatabase({
      busyTimeoutMs: 2_500,
      workspaceRoot: root,
    });

    try {
      expect(
        database.get<{ journal_mode: string }>("PRAGMA journal_mode"),
      ).toMatchObject({ journal_mode: "wal" });
      expect(
        database.get<{ foreign_keys: number }>("PRAGMA foreign_keys"),
      ).toMatchObject({ foreign_keys: 1 });
      expect(
        database.get<{ timeout: number }>("PRAGMA busy_timeout"),
      ).toMatchObject({ timeout: 2_500 });
      expect(lstatSync(database.path).mode & 0o777).toBe(0o600);

      database.exec(`
        CREATE TABLE parent(id INTEGER PRIMARY KEY) STRICT;
        CREATE TABLE child(
          id INTEGER PRIMARY KEY,
          parent_id INTEGER NOT NULL REFERENCES parent(id)
        ) STRICT;
      `);
      expect(() => {
        database.run("INSERT INTO child(id, parent_id) VALUES (?, ?)", 1, 99);
      }).toThrow(/FOREIGN KEY constraint failed/iu);
    } finally {
      database.close();
    }
  });

  it("commits synchronous bounded work and rolls back async callbacks", async () => {
    const root = temporaryRoot();
    const database = openUserProjectDatabase({ workspaceRoot: root });
    database.exec(
      "CREATE TABLE item(id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT",
    );

    try {
      const id = database.transaction((transaction) => {
        transaction.run("INSERT INTO item(name) VALUES (?)", "committed");
        return 7;
      });
      expect(id).toBe(7);

      let asyncContinuation: Promise<void> | undefined;
      expect(() =>
        database.transaction((transaction) => {
          transaction.run("INSERT INTO item(name) VALUES (?)", "rolled-back");
          asyncContinuation = Promise.resolve().then(() => {
            expect(() =>
              transaction.run(
                "INSERT INTO item(name) VALUES (?)",
                "escaped-transaction",
              ),
            ).toThrow(TransactionScopeClosedError);
          });
          return asyncContinuation;
        }),
      ).toThrow(AsyncTransactionError);
      await asyncContinuation;

      expect(
        database.all<{ name: string }>("SELECT name FROM item ORDER BY id"),
      ).toEqual([{ name: "committed" }]);
    } finally {
      database.close();
    }
  });

  it("rolls back work that exceeds its transaction limit", () => {
    const root = temporaryRoot();
    const database = openUserProjectDatabase({ workspaceRoot: root });
    database.exec("CREATE TABLE item(id INTEGER PRIMARY KEY) STRICT");

    try {
      expect(() =>
        database.transaction(
          (transaction) => {
            transaction.run("INSERT INTO item DEFAULT VALUES");
            const deadline = performance.now() + 5;
            while (performance.now() < deadline) {
              // Exercise the post-callback commit guard without asynchronous work.
            }
          },
          { maximumMs: 1 },
        ),
      ).toThrow(TransactionDeadlineExceededError);
      expect(
        database.get<{ count: number }>("SELECT count(*) AS count FROM item"),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("creates and atomically replaces a healthy backup from WAL state", async () => {
    const root = temporaryRoot();
    const database = openUserProjectDatabase({ workspaceRoot: root });
    database.exec("CREATE TABLE note(value TEXT NOT NULL) STRICT");
    database.run("INSERT INTO note(value) VALUES (?)", "before");

    try {
      const first = await database.backupTo("backups/project.sqlite");
      expect(first.strategy).toBe("sqlite-backup-api");
      database.run("INSERT INTO note(value) VALUES (?)", "after");
      await database.backupTo("backups/project.sqlite");

      const backup = new DatabaseSync(join(root, "backups/project.sqlite"), {
        readOnly: true,
      });
      try {
        expect(
          backup.prepare("SELECT value FROM note ORDER BY rowid").all(),
        ).toEqual([{ value: "before" }, { value: "after" }]);
        expect(backup.prepare("PRAGMA quick_check").get()).toEqual({
          quick_check: "ok",
        });
      } finally {
        backup.close();
      }
      expect(lstatSync(join(root, "backups/project.sqlite")).mode & 0o777).toBe(
        0o600,
      );
    } finally {
      database.close();
    }
  });

  it("does not allow connection use while an online backup is in progress", async () => {
    const root = temporaryRoot();
    const database = openUserProjectDatabase({ workspaceRoot: root });
    database.exec("CREATE TABLE note(value TEXT NOT NULL) STRICT");
    database.run("INSERT INTO note(value) VALUES (?)", "snapshot");

    try {
      const backup = database.backupTo("backups/concurrent.sqlite");
      expect(() => database.get("SELECT count(*) AS count FROM note")).toThrow(
        DatabaseBackupInProgressError,
      );
      await backup;
      expect(
        database.get<{ count: number }>("SELECT count(*) AS count FROM note"),
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  it("checkpoints WAL explicitly", () => {
    const root = temporaryRoot();
    const database = openUserProjectDatabase({ workspaceRoot: root });
    database.exec("CREATE TABLE item(id INTEGER PRIMARY KEY) STRICT");
    database.run("INSERT INTO item DEFAULT VALUES");

    try {
      expect(database.checkpoint("truncate")).toMatchObject({
        busy: 0,
        checkpointedPages: expect.any(Number),
        logPages: expect.any(Number),
      });
    } finally {
      database.close();
    }
  });

  it("rejects database and backup paths outside the user root", async () => {
    const root = temporaryRoot();
    expect(() =>
      openUserProjectDatabase({
        databaseFile: "../escaped.sqlite",
        workspaceRoot: root,
      }),
    ).toThrow(InvalidUserDatabasePathError);

    const database = openUserProjectDatabase({ workspaceRoot: root });
    try {
      await expect(
        database.backupTo("../escaped-backup.sqlite"),
      ).rejects.toBeInstanceOf(InvalidUserDatabasePathError);
      await expect(
        database.backupTo("data/project.sqlite-wal"),
      ).rejects.toBeInstanceOf(InvalidUserDatabasePathError);
    } finally {
      database.close();
    }
  });

  it("rejects symlink aliases for live database files", () => {
    const root = temporaryRoot();
    const target = join(root, "target.sqlite");
    const seed = new DatabaseSync(target);
    seed.close();
    symlinkSync(target, join(root, "alias.sqlite"));

    expect(() =>
      openUserProjectDatabase({
        databaseFile: "alias.sqlite",
        workspaceRoot: root,
      }),
    ).toThrow(InvalidUserDatabasePathError);
  });

  it("rejects intermediate symlinks before creating database directories", () => {
    const root = temporaryRoot();
    const outside = temporaryRoot();
    symlinkSync(outside, join(root, "alias"));

    expect(() =>
      openUserProjectDatabase({
        databaseFile: "alias/new-directory/project.sqlite",
        workspaceRoot: root,
      }),
    ).toThrow(InvalidUserDatabasePathError);
    expect(() => lstatSync(join(outside, "new-directory"))).toThrow();
  });

  it("distinguishes per-user quota from shared-pool exhaustion", () => {
    const sqliteFull = Object.assign(new Error("database or disk is full"), {
      code: "ERR_SQLITE_ERROR",
      errcode: 13,
    });
    const diskFull = Object.assign(new Error("no space"), { code: "ENOSPC" });
    const unrelated = Object.assign(new Error("locked"), {
      code: "ERR_SQLITE_ERROR",
      errcode: 5,
    });

    expect(mapUserDatabaseError(sqliteFull)).toBeInstanceOf(
      StorageQuotaExceededError,
    );
    expect(mapUserDatabaseError(diskFull)).toBeInstanceOf(StoragePoolFullError);
    expect(mapUserDatabaseError(unrelated)).toBe(unrelated);
  });
});

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
