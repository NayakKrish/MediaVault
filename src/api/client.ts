import { isAbortError } from "@/lib/abort";
import { ApiError } from "@/lib/apiError";
import type { Asset, AssetPage, AssetQuery, BulkResult } from "@/lib/types";

/**
 * Baseline client. It works on a good network and falls apart on a bad one.
 *
 * Known gaps, all of which are yours to close:
 *   - no request cancellation
 *   - no retry, no backoff, no handling of Retry-After
 *   - no de-duplication of concurrent identical requests
 *   - error information is flattened into a string
 *   - callers cannot distinguish "retry this" from "do not retry this"
 */

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
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
    throw new ApiError(res.status, code, message);
  }
  return res.json() as Promise<T>;
}

type InflightEntry = {
  promise: Promise<unknown>;
  controller: AbortController;
  refs: number;
};

const inflightGets = new Map<string, InflightEntry>();

/**
 * Share one network call across concurrent identical GETs.
 * Abort only fires when the last subscriber cancels — so StrictMode remounts
 * and twin callers do not kill a still-needed request.
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
  // Note: the endpoint rejects more than 25 ids per call.
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
  // Note: the endpoint rejects more than 50 ids per call.
  return request<BulkResult>("/api/assets/bulk-status", {
    method: "POST",
    body: JSON.stringify({ ids, status }),
    signal,
  });
}

export const thumbnailUrl = (id: string) => `/api/thumb/${id}.svg`;
