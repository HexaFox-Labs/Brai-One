import {
  HTTP_ERROR_SCHEMA_VERSION,
  type HttpError,
  type HttpErrorCode,
} from "@brai/contracts";

export function createHttpError(
  requestId: string,
  code: HttpErrorCode,
  message: string,
): HttpError {
  return {
    schema_version: HTTP_ERROR_SCHEMA_VERSION,
    request_id: requestId,
    code,
    message,
  };
}
