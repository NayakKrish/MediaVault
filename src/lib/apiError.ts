import { isAbortError } from "@/lib/abort";

const RETRYABLE_STATUS = new Set([429, 503, 500]);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterMs: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function isOfflineError(err: unknown): boolean {
  return isApiError(err) && (err.code === "offline" || err.status === 0);
}

/** Retry by HTTP status / error class — never by message text. */
export function isRetryableError(err: unknown): boolean {
  if (isAbortError(err) || isOfflineError(err)) return false;
  if (isApiError(err)) return RETRYABLE_STATUS.has(err.status);
  return err instanceof TypeError;
}
