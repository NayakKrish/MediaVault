import { isAbortError } from "@/lib/abort";
import { ApiError, isApiError, isRetryableError } from "@/lib/apiError";
import type { Asset, AssetPage, AssetQuery, BulkResult } from "@/lib/types";

const MAX_ATTEMPTS = 4;

function toSearchParams(query: AssetQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status?.length)
    params.set("status", [...query.status].sort().join(","));
  if (query.kind?.length) params.set("kind", [...query.kind].sort().join(","));
  if (query.tag?.length) params.set("tag", [...query.tag].sort().join(","));
  if (query.collectionId) params.set("collectionId", query.collectionId);
  if (query.owner) params.set("owner", query.owner);
  if (query.sort) params.set("sort", query.sort);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  return params.toString();
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - Date.now());
}

function backoffMs(attempt: number, retryAfterMs: number | null): number {
  const exp = Math.min(8000, 300 * 2 ** attempt + Math.random() * 300);
  return Math.max(retryAfterMs ?? 0, exp);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfOffline(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new ApiError(0, "offline", "You’re offline.");
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const signal = init?.signal ?? undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    throwIfOffline(signal);
    try {
      const res = await fetch(path, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
      if (!res.ok) {
        let code = "http_error";
        let message = res.statusText || `Request failed (${res.status})`;
        try {
          const body = await res.json();
          code = body?.error?.code ?? code;
          message = body?.error?.message ?? message;
        } catch {
          /* response was not JSON */
        }
        const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
        throw new ApiError(res.status, code, message, retryAfterMs);
      }
      return res.json() as Promise<T>;
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err;
      const canRetry = isRetryableError(err) && attempt < MAX_ATTEMPTS - 1;
      if (!canRetry) throw err;
      throwIfOffline(signal);
      const retryAfterMs = isApiError(err) ? err.retryAfterMs : null;
      await sleep(backoffMs(attempt, retryAfterMs), signal);
    }
  }

  throw lastError;
}

type InflightEntry = {
  promise: Promise<unknown>;
  controller: AbortController;
  refs: number;
};

const inflightGets = new Map<string, InflightEntry>();

/**
 * Share one network call (including its retry chain) across concurrent identical GETs.
 * Abort only fires when the last subscriber cancels.
 */
function getDeduped<T>(path: string, signal?: AbortSignal): Promise<T> {
  let entry = inflightGets.get(path);
  if (!entry) {
    const controller = new AbortController();
    const promise = request<T>(path, { signal: controller.signal }).finally(
      () => {
        const current = inflightGets.get(path);
        if (current?.promise === promise) inflightGets.delete(path);
      },
    );
    entry = { promise, controller, refs: 0 };
    inflightGets.set(path, entry);
  }

  entry.refs += 1;

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      entry!.refs -= 1;
      fn();
    };

    const onAbort = () => {
      finish(() => {
        if (entry!.refs <= 0) {
          inflightGets.delete(path);
          entry!.controller.abort();
        }
        reject(new DOMException("Aborted", "AbortError"));
      });
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort);

    entry.promise.then(
      (value) => finish(() => resolve(value as T)),
      (err) =>
        finish(() => {
          if (signal?.aborted || isAbortError(err)) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          reject(err);
        }),
    );
  });
}

export function listAssets(
  query: AssetQuery,
  signal?: AbortSignal,
): Promise<AssetPage> {
  return getDeduped<AssetPage>(`/api/assets?${toSearchParams(query)}`, signal);
}

export function getAsset(id: string, signal?: AbortSignal): Promise<Asset> {
  return getDeduped<Asset>(`/api/assets/${id}`, signal);
}

export function getAssetsByIds(
  ids: string[],
  signal?: AbortSignal,
): Promise<{ items: Asset[]; missing: string[] }> {
  return getDeduped(`/api/assets/batch?ids=${ids.join(",")}`, signal);
}

export function updateAsset(
  id: string,
  version: number,
  patch: Partial<Pick<Asset, "name" | "status" | "tags">>,
  signal?: AbortSignal,
): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ version, patch }),
    signal,
  });
}

export function bulkSetStatus(
  ids: string[],
  status: Asset["status"],
  signal?: AbortSignal,
): Promise<BulkResult> {
  return request<BulkResult>("/api/assets/bulk-status", {
    method: "POST",
    body: JSON.stringify({ ids, status }),
    signal,
  });
}

export const thumbnailUrl = (id: string) => `/api/thumb/${id}.svg`;
