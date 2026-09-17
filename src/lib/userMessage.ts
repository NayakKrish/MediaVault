import { isApiError, isOfflineError } from "@/lib/apiError";

/** Actionable copy for the user. Never leak raw API status lines. */
export function userMessage(err: unknown): string {
  if (isOfflineError(err)) {
    return "You’re offline. We’ll resume when the connection returns.";
  }

  if (isApiError(err)) {
    if (err.status === 429 || err.code === "rate_limited") {
      return "The server is busy. Wait a moment and try again.";
    }
    if (err.status === 503 || err.code === "upstream_unavailable") {
      return "Search is temporarily unavailable. Trying again…";
    }
    if (err.status === 500 || err.code === "write_failed") {
      return "The update didn’t go through. Try again.";
    }
    if (err.status === 409 || err.code === "version_conflict") {
      return "This asset was edited elsewhere. Showing the latest version — apply the status again if you still want the change.";
    }
    if (err.code === "legal_hold") {
      return "On legal hold — this status cannot be applied.";
    }
    if (err.status === 404 || err.code === "not_found") {
      return "This asset could not be found.";
    }
    return "Something went wrong. Try again.";
  }

  if (err instanceof TypeError) {
    return "Couldn’t reach the server. Try again.";
  }

  return "Something went wrong. Try again.";
}
