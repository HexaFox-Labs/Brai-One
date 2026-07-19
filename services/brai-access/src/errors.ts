export type AccessServiceErrorCode =
  | "access_admin_required"
  | "access_environment_unavailable"
  | "access_input_invalid"
  | "access_state_not_found"
  | "access_transition_not_found"
  | "access_trusted_context_required"
  | "access_store_inconsistent";

export class AccessServiceError extends Error {
  public readonly code: AccessServiceErrorCode;

  public constructor(
    code: AccessServiceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AccessServiceError";
    this.code = code;
  }
}

export class AccessPersistenceError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AccessPersistenceError";
  }
}
