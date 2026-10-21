export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export type ApiErrorDetail = {
  field: string;
  message: string;
};

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: readonly ApiErrorDetail[];

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    details: readonly ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function authenticationRequired(
  message = "Autenticación requerida",
): AppError {
  return new AppError("AUTH_REQUIRED", 401, message);
}
