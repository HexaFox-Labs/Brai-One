import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import * as sqlite from "node:sqlite";
import type {
  DatabaseSync,
  SQLInputValue,
  SQLOutputValue,
  StatementResultingChanges,
} from "node:sqlite";
import { randomUUID } from "node:crypto";

import {
  AsyncTransactionError,
  DatabaseBackupInProgressError,
  DatabaseClosedError,
  InvalidUserDatabasePathError,
  NestedTransactionError,
  TransactionScopeClosedError,
  TransactionDeadlineExceededError,
  UnsupportedDatabaseRuntimeError,
  mapUserDatabaseError,
} from "./errors.js";
import { resolveBackupDestination, resolveDatabasePath } from "./paths.js";

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const DEFAULT_TRANSACTION_LIMIT_MS = 5_000;
const MAX_TRANSACTION_LIMIT_MS = 30_000;
const DEFAULT_WAL_AUTOCHECKPOINT_PAGES = 1_000;
const MINIMUM_SQLITE_VERSION = "3.51.3";

export type SQLiteInputValue = SQLInputValue;
export type SQLiteOutputValue = SQLOutputValue;
export type SQLiteRow = Record<string, SQLiteOutputValue>;
export type TransactionMode = "deferred" | "immediate" | "exclusive";
export type CheckpointMode = "passive" | "full" | "restart" | "truncate";

export interface OpenUserProjectDatabaseOptions {
  readonly workspaceRoot: string;
  readonly databaseFile?: string;
  readonly busyTimeoutMs?: number;
  readonly transactionLimitMs?: number;
}

export interface UserDatabaseTransactionOptions {
  readonly mode?: TransactionMode;
  readonly maximumMs?: number;
}

export interface UserDatabaseTransaction {
  exec(sql: string): void;
  run(
    sql: string,
    ...parameters: SQLiteInputValue[]
  ): StatementResultingChanges;
  get<TRow extends SQLiteRow = SQLiteRow>(
    sql: string,
    ...parameters: SQLiteInputValue[]
  ): TRow | undefined;
  all<TRow extends SQLiteRow = SQLiteRow>(
    sql: string,
    ...parameters: SQLiteInputValue[]
  ): TRow[];
}

export interface UserDatabaseCheckpointResult {
  readonly busy: number;
  readonly logPages: number;
  readonly checkpointedPages: number;
}

export interface UserDatabaseBackupResult {
  readonly destination: string;
  readonly strategy: "sqlite-backup-api" | "vacuum-into";
  readonly pagesCopied?: number;
}

interface ConfiguredUserProjectDatabase {
  readonly database: DatabaseSync;
  readonly path: string;
  readonly transactionLimitMs: number;
  readonly workspaceRoot: string;
}

export class UserProjectDatabase implements Disposable {
  readonly path: string;
  readonly workspaceRoot: string;
  readonly transactionLimitMs: number;

  readonly #database: DatabaseSync;
  #backupOpen = false;
  #closed = false;
  #transactionOpen = false;

  private constructor(
    database: DatabaseSync,
    path: string,
    workspaceRoot: string,
    transactionLimitMs: number,
  ) {
    this.#database = database;
    this.path = path;
    this.workspaceRoot = workspaceRoot;
    this.transactionLimitMs = transactionLimitMs;
  }

  static open(options: OpenUserProjectDatabaseOptions): UserProjectDatabase {
    const configured = configureUserProjectDatabase(options);
    return new UserProjectDatabase(
      configured.database,
      configured.path,
      configured.workspaceRoot,
      configured.transactionLimitMs,
    );
  }

  exec(sql: string): void {
    this.#assertOpen();
    try {
      this.#database.exec(sql);
    } catch (error) {
      throw mapUserDatabaseError(error);
    }
  }

  run(
    sql: string,
    ...parameters: SQLiteInputValue[]
  ): StatementResultingChanges {
    this.#assertOpen();
    try {
      return this.#database.prepare(sql).run(...parameters);
    } catch (error) {
      throw mapUserDatabaseError(error);
    }
  }

  get<TRow extends SQLiteRow = SQLiteRow>(
    sql: string,
    ...parameters: SQLiteInputValue[]
  ): TRow | undefined {
    this.#assertOpen();
    try {
      return this.#database.prepare(sql).get(...parameters) as TRow | undefined;
    } catch (error) {
      throw mapUserDatabaseError(error);
    }
  }

  all<TRow extends SQLiteRow = SQLiteRow>(
    sql: string,
    ...parameters: SQLiteInputValue[]
  ): TRow[] {
    this.#assertOpen();
    try {
      return this.#database.prepare(sql).all(...parameters) as TRow[];
    } catch (error) {
      throw mapUserDatabaseError(error);
    }
  }

  transaction<T>(
    work: (database: UserDatabaseTransaction) => T,
    options: UserDatabaseTransactionOptions = {},
  ): T {
    this.#assertOpen();
    if (this.#transactionOpen) {
      throw new NestedTransactionError();
    }

    const maximumMs = boundedInteger(
      options.maximumMs ?? this.transactionLimitMs,
      "Transaction duration",
      1,
      MAX_TRANSACTION_LIMIT_MS,
    );
    const mode = options.mode ?? "immediate";
    const startedAt = performance.now();
    this.#transactionOpen = true;
    let scopeActive = true;
    const assertScopeActive = (): void => {
      if (!scopeActive) {
        throw new TransactionScopeClosedError();
      }
    };
    const transaction: UserDatabaseTransaction = {
      all: <TRow extends SQLiteRow = SQLiteRow>(
        sql: string,
        ...parameters: SQLiteInputValue[]
      ): TRow[] => {
        assertScopeActive();
        return this.all<TRow>(sql, ...parameters);
      },
      exec: (sql: string): void => {
        assertScopeActive();
        this.exec(sql);
      },
      get: <TRow extends SQLiteRow = SQLiteRow>(
        sql: string,
        ...parameters: SQLiteInputValue[]
      ): TRow | undefined => {
        assertScopeActive();
        return this.get<TRow>(sql, ...parameters);
      },
      run: (
        sql: string,
        ...parameters: SQLiteInputValue[]
      ): StatementResultingChanges => {
        assertScopeActive();
        return this.run(sql, ...parameters);
      },
    };

    try {
      this.#database.exec(`BEGIN ${mode.toUpperCase()}`);
      const result = work(transaction);
      if (isThenable(result)) {
        throw new AsyncTransactionError();
      }

      const elapsedMs = performance.now() - startedAt;
      if (elapsedMs > maximumMs) {
        throw new TransactionDeadlineExceededError(elapsedMs, maximumMs);
      }

      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the original error; SQLite may already have rolled back.
      }
      throw mapUserDatabaseError(error);
    } finally {
      scopeActive = false;
      this.#transactionOpen = false;
    }
  }

  checkpoint(mode: CheckpointMode = "passive"): UserDatabaseCheckpointResult {
    this.#assertOpen();
    if (this.#transactionOpen) {
      throw new NestedTransactionError();
    }

    try {
      const row = this.#database
        .prepare(`PRAGMA wal_checkpoint(${mode.toUpperCase()})`)
        .get() as SQLiteRow | undefined;
      if (row === undefined) {
        throw new Error("SQLite did not return a WAL checkpoint result.");
      }
      return {
        busy: asNumber(row.busy, "busy"),
        logPages: asNumber(row.log, "log"),
        checkpointedPages: asNumber(row.checkpointed, "checkpointed"),
      };
    } catch (error) {
      throw mapUserDatabaseError(error);
    }
  }

  async backupTo(destinationFile: string): Promise<UserDatabaseBackupResult> {
    this.#assertOpen();
    if (this.#transactionOpen) {
      throw new NestedTransactionError();
    }

    let destination: string;
    try {
      destination = resolveBackupDestination(
        this.workspaceRoot,
        this.path,
        destinationFile,
      );
    } catch (error) {
      throw mapUserDatabaseError(error);
    }
    const temporary = join(
      dirname(destination),
      `.${basename(destination)}.${randomUUID()}.partial`,
    );
    this.#backupOpen = true;

    try {
      let result: UserDatabaseBackupResult;
      if (typeof sqlite.backup === "function") {
        reserveRegularFile(temporary);
        const pagesCopied = await sqlite.backup(this.#database, temporary, {
          rate: 100,
        });
        result = {
          destination,
          pagesCopied,
          strategy: "sqlite-backup-api",
        };
      } else {
        // Node releases without sqlite.backup use SQLite's consistent snapshot
        // primitive. The random, validated target is deliberately nonexistent.
        this.#database.exec(`VACUUM INTO ${quoteSqliteString(temporary)}`);
        result = { destination, strategy: "vacuum-into" };
      }

      assertHealthyBackup(temporary);
      chmodSync(temporary, 0o600);
      fsyncFile(temporary);
      renameSync(temporary, destination);
      fsyncDirectory(dirname(destination));
      return result;
    } catch (error) {
      try {
        safeUnlink(temporary);
      } catch {
        // Cleanup failure must not hide a quota or backup failure.
      }
      throw mapUserDatabaseError(error);
    } finally {
      this.#backupOpen = false;
    }
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    if (this.#transactionOpen) {
      throw new NestedTransactionError();
    }
    if (this.#backupOpen) {
      throw new DatabaseBackupInProgressError();
    }
    this.#database.close();
    this.#closed = true;
  }

  [Symbol.dispose](): void {
    this.close();
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new DatabaseClosedError();
    }
    if (this.#backupOpen) {
      throw new DatabaseBackupInProgressError();
    }
  }
}

export function openUserProjectDatabase(
  options: OpenUserProjectDatabaseOptions,
): UserProjectDatabase {
  return UserProjectDatabase.open(options);
}

function configureUserProjectDatabase(
  options: OpenUserProjectDatabaseOptions,
): ConfiguredUserProjectDatabase {
  if (compareVersions(process.versions.sqlite, MINIMUM_SQLITE_VERSION) < 0) {
    throw new UnsupportedDatabaseRuntimeError(process.versions.sqlite);
  }
  const busyTimeoutMs = boundedInteger(
    options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
    "Busy timeout",
    0,
    60_000,
  );
  const transactionLimitMs = boundedInteger(
    options.transactionLimitMs ?? DEFAULT_TRANSACTION_LIMIT_MS,
    "Transaction duration",
    1,
    MAX_TRANSACTION_LIMIT_MS,
  );
  let resolved: ReturnType<typeof resolveDatabasePath>;
  let created: boolean;
  try {
    resolved = resolveDatabasePath(
      options.workspaceRoot,
      options.databaseFile ?? "data/project.sqlite",
    );
    created = createPrivateFileIfMissing(resolved.path);
  } catch (error) {
    throw mapUserDatabaseError(error);
  }

  let database: DatabaseSync | undefined;
  try {
    database = new sqlite.DatabaseSync(resolved.path, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      timeout: busyTimeoutMs,
    });
    const journalMode = database.prepare("PRAGMA journal_mode = WAL").get() as
      SQLiteRow | undefined;
    if (journalMode?.journal_mode !== "wal") {
      throw new Error(
        "SQLite could not enable WAL mode on the user filesystem.",
      );
    }
    database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = NORMAL;
      PRAGMA trusted_schema = OFF;
      PRAGMA busy_timeout = ${busyTimeoutMs};
      PRAGMA wal_autocheckpoint = ${DEFAULT_WAL_AUTOCHECKPOINT_PAGES};
    `);
    chmodSync(resolved.path, 0o600);
    chmodSidecars(resolved.path);

    return {
      database,
      path: resolved.path,
      transactionLimitMs,
      workspaceRoot: resolved.workspaceRoot,
    };
  } catch (error) {
    try {
      database?.close();
    } catch {
      // Preserve the open/configuration error.
    }
    if (created) {
      for (const path of [
        resolved.path,
        `${resolved.path}-wal`,
        `${resolved.path}-shm`,
      ]) {
        try {
          safeUnlink(path);
        } catch {
          // Cleanup failure must not hide the open/configuration failure.
        }
      }
    }
    throw mapUserDatabaseError(error);
  }
}

function boundedInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${label} must be an integer between ${minimum} and ${maximum} ms.`,
    );
  }
  return value;
}

function createPrivateFileIfMissing(path: string): boolean {
  if (existsSync(path)) {
    const status = lstatSync(path);
    if (!status.isFile() || status.isSymbolicLink()) {
      throw new InvalidUserDatabasePathError(
        "Database must be a regular file and cannot be a symbolic link.",
      );
    }
    chmodSync(path, 0o600);
    return false;
  }

  const descriptor = openSync(
    path,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
    0o600,
  );
  closeSync(descriptor);
  return true;
}

function reserveRegularFile(path: string): void {
  const descriptor = openSync(
    path,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
    0o600,
  );
  closeSync(descriptor);
}

function assertHealthyBackup(path: string): void {
  const backupDatabase = new sqlite.DatabaseSync(path, {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    readOnly: true,
  });
  try {
    const row = backupDatabase.prepare("PRAGMA quick_check").get() as
      SQLiteRow | undefined;
    if (row?.quick_check !== "ok") {
      throw new Error("SQLite backup failed its integrity check.");
    }
  } finally {
    backupDatabase.close();
  }
}

function chmodSidecars(databasePath: string): void {
  for (const suffix of ["-wal", "-shm"] as const) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) {
      chmodSync(path, 0o600);
    }
  }
}

function quoteSqliteString(value: string): string {
  if (value.includes("\0")) {
    throw new InvalidUserDatabasePathError("Backup destination is invalid.");
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function fsyncFile(path: string): void {
  const descriptor = openSync(path, fsConstants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, fsConstants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function safeUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      throw error;
    }
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function asNumber(value: SQLiteOutputValue | undefined, label: string): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  throw new TypeError(`SQLite checkpoint field ${label} is not numeric.`);
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function compareVersions(left: string | undefined, right: string): number {
  const leftParts = (left ?? "0").split(".").map(Number);
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
