const SQLITE_FULL_ERROR_CODES = new Set(["ERR_SQLITE_FULL", "SQLITE_FULL"]);

const SQLITE_FULL_ERROR_NUMBER = 13;

interface ErrorDetails {
  code?: unknown;
  errno?: unknown;
  errcode?: unknown;
  message?: unknown;
}

export class StorageQuotaExceededError extends Error {
  readonly code = "storage_quota_exceeded" as const;

  constructor(cause: unknown) {
    super("The user storage quota has been exhausted.", { cause });
    this.name = "StorageQuotaExceededError";
  }
}

export class StoragePoolFullError extends Error {
  readonly code = "storage_pool_full" as const;

  constructor(cause: unknown) {
    super("The shared user-storage pool has no space available.", { cause });
    this.name = "StoragePoolFullError";
  }
}

export class InvalidUserDatabasePathError extends Error {
  readonly code = "invalid_user_database_path" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidUserDatabasePathError";
  }
}

export class UnsupportedUserDatabaseFilesystemError extends Error {
  readonly code = "unsupported_user_database_filesystem" as const;

  constructor(filesystemType: bigint) {
    super(
      `SQLite WAL requires a local filesystem; filesystem type 0x${filesystemType.toString(16)} is not allowed.`,
    );
    this.name = "UnsupportedUserDatabaseFilesystemError";
  }
}

export class DatabaseClosedError extends Error {
  readonly code = "user_database_closed" as const;

  constructor() {
    super("The user project database is closed.");
    this.name = "DatabaseClosedError";
  }
}

export class DatabaseBackupInProgressError extends Error {
  readonly code = "database_backup_in_progress" as const;

  constructor() {
    super(
      "The user project database is unavailable while its backup is running.",
    );
    this.name = "DatabaseBackupInProgressError";
  }
}

export class UnsupportedDatabaseRuntimeError extends Error {
  readonly code = "unsupported_database_runtime" as const;

  constructor(sqliteVersion: string | undefined) {
    super(
      `The runtime SQLite version must be 3.51.3 or newer; received ${sqliteVersion ?? "unknown"}.`,
    );
    this.name = "UnsupportedDatabaseRuntimeError";
  }
}

export class NestedTransactionError extends Error {
  readonly code = "nested_transaction_not_supported" as const;

  constructor() {
    super("Nested user database transactions are not supported.");
    this.name = "NestedTransactionError";
  }
}

export class AsyncTransactionError extends Error {
  readonly code = "async_transaction_not_supported" as const;

  constructor() {
    super("A user database transaction callback must be synchronous.");
    this.name = "AsyncTransactionError";
  }
}

export class TransactionScopeClosedError extends Error {
  readonly code = "transaction_scope_closed" as const;

  constructor() {
    super("This transaction scope is no longer active.");
    this.name = "TransactionScopeClosedError";
  }
}

export class TransactionDeadlineExceededError extends Error {
  readonly code = "transaction_deadline_exceeded" as const;
  readonly elapsedMs: number;
  readonly maximumMs: number;

  constructor(elapsedMs: number, maximumMs: number) {
    super(
      `The transaction ran for ${elapsedMs.toFixed(1)} ms, exceeding its ${maximumMs} ms limit.`,
    );
    this.name = "TransactionDeadlineExceededError";
    this.elapsedMs = elapsedMs;
    this.maximumMs = maximumMs;
  }
}

export function mapUserDatabaseError(error: unknown): unknown {
  if (
    error instanceof StorageQuotaExceededError ||
    error instanceof StoragePoolFullError
  ) {
    return error;
  }

  if (!isErrorDetails(error)) {
    return error;
  }

  const code = typeof error.code === "string" ? error.code : undefined;
  const message = typeof error.message === "string" ? error.message : "";
  const isSqliteFullCode =
    code !== undefined && SQLITE_FULL_ERROR_CODES.has(code);
  const isSqliteFull =
    error.errcode === SQLITE_FULL_ERROR_NUMBER ||
    (error.code === "ERR_SQLITE_ERROR" &&
      /(?:database or disk is full|disk full|quota exceeded|no space left on device)/iu.test(
        message,
      ));
  const isOperatingSystemQuota = code === "EDQUOT" || error.errno === "EDQUOT";
  const isOperatingSystemPoolFull =
    code === "ENOSPC" || error.errno === "ENOSPC";

  if (isOperatingSystemPoolFull) return new StoragePoolFullError(error);
  if (isOperatingSystemQuota || isSqliteFullCode || isSqliteFull) {
    return new StorageQuotaExceededError(error);
  }
  return error;
}

function isErrorDetails(value: unknown): value is ErrorDetails {
  return typeof value === "object" && value !== null;
}
