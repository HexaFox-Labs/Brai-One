export class IdempotencyConflictError extends Error {
  public constructor() {
    super("Idempotency key already belongs to a different Activity");
    this.name = "IdempotencyConflictError";
  }
}

export class InvalidCursorError extends Error {
  public constructor() {
    super("Activity cursor is invalid");
    this.name = "InvalidCursorError";
  }
}

export class PersistenceError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PersistenceError";
  }
}
