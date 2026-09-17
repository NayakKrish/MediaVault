import { useCallback, useRef, useState } from "react";
import { bulkSetStatus } from "@/api/client";
import { chunk } from "@/lib/chunk";
import { mapPool } from "@/lib/pool";
import type { Asset, AssetStatus, BulkResult } from "@/lib/types";

export const BULK_CHUNK_SIZE = 50;
export const BULK_CONCURRENCY = 3;

export interface BulkFailure {
  id: string;
  name: string;
  code: string;
  message: string;
  retryable: boolean;
  priorStatus: AssetStatus;
}

export interface BulkNotice {
  target: AssetStatus;
  applied: number;
  failed: number;
  failures: BulkFailure[];
  /** Successful ids → status before the apply (for undo). */
  undoById: Record<string, AssetStatus>;
}

interface Snapshot {
  status: AssetStatus;
  name: string;
}

interface Deps {
  items: Asset[];
  patchAssets: (ids: string[], patch: Partial<Pick<Asset, "status">>) => void;
  upsertAssets: (assets: Asset[]) => void;
  replaceSelection: (ids: Iterable<string>) => void;
}

function isRetryable(code: string): boolean {
  return code !== "legal_hold";
}

function failureMessage(code: string, fallback?: string): string {
  if (code === "legal_hold")
    return "On legal hold — this status cannot be applied.";
  if (code === "conflict")
    return "Someone else edited this row — retry is safe.";
  if (code === "not_found") return "No longer in the library.";
  if (code === "request_failed")
    return fallback ?? "The request did not complete.";
  return fallback ?? "Could not update this asset.";
}

function snapshotSelected(
  items: Asset[],
  ids: string[],
): Map<string, Snapshot> {
  const want = new Set(ids);
  const snap = new Map<string, Snapshot>();
  for (const asset of items) {
    if (!want.has(asset.id)) continue;
    snap.set(asset.id, { status: asset.status, name: asset.name });
  }
  return snap;
}

function rollbackStatuses(
  failures: BulkFailure[],
  patchAssets: Deps["patchAssets"],
) {
  const byStatus = new Map<AssetStatus, string[]>();
  for (const failure of failures) {
    const list = byStatus.get(failure.priorStatus) ?? [];
    list.push(failure.id);
    byStatus.set(failure.priorStatus, list);
  }
  for (const [status, ids] of byStatus) {
    patchAssets(ids, { status });
  }
}

async function sendChunks(
  ids: string[],
  status: AssetStatus,
): Promise<Array<{ chunk: string[]; result?: BulkResult; error?: unknown }>> {
  const groups = chunk(ids, BULK_CHUNK_SIZE);
  return mapPool(groups, BULK_CONCURRENCY, async (group) => {
    try {
      const result = await bulkSetStatus(group, status);
      return { chunk: group, result };
    } catch (error) {
      return { chunk: group, error };
    }
  });
}

function mergeChunkOutcomes(
  outcomes: Array<{ chunk: string[]; result?: BulkResult; error?: unknown }>,
  snap: Map<string, Snapshot>,
): { successes: Asset[]; failures: BulkFailure[] } {
  const successes: Asset[] = [];
  const failures: BulkFailure[] = [];

  for (const outcome of outcomes) {
    if (outcome.error || !outcome.result) {
      const message =
        outcome.error instanceof Error
          ? outcome.error.message
          : "The request did not complete.";
      for (const id of outcome.chunk) {
        const prior = snap.get(id);
        failures.push({
          id,
          name: prior?.name ?? id,
          code: "request_failed",
          message: failureMessage("request_failed", message),
          retryable: true,
          priorStatus: prior?.status ?? "draft",
        });
      }
      continue;
    }

    for (const row of outcome.result.results) {
      const prior = snap.get(row.id);
      if (row.ok) {
        successes.push(row.asset);
      } else {
        failures.push({
          id: row.id,
          name: prior?.name ?? row.id,
          code: row.code,
          message: failureMessage(row.code, row.message),
          retryable: isRetryable(row.code),
          priorStatus: prior?.status ?? "draft",
        });
      }
    }
  }

  return { successes, failures };
}

export function useBulkStatus({
  items,
  patchAssets,
  upsertAssets,
  replaceSelection,
}: Deps) {
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<BulkNotice | null>(null);
  const busyRef = useRef(false);

  const apply = useCallback(
    async (ids: string[], target: AssetStatus) => {
      const unique = [...new Set(ids)];
      if (unique.length === 0 || busyRef.current) return;

      const snap = snapshotSelected(itemsRef.current, unique);
      const knownIds = unique.filter((id) => snap.has(id));
      if (knownIds.length === 0) return;

      busyRef.current = true;
      setBusy(true);
      setNotice(null);
      patchAssets(knownIds, { status: target });

      try {
        const outcomes = await sendChunks(knownIds, target);
        const { successes, failures } = mergeChunkOutcomes(outcomes, snap);

        upsertAssets(successes);
        rollbackStatuses(failures, patchAssets);
        replaceSelection(failures.map((f) => f.id));

        const undoById: Record<string, AssetStatus> = {};
        for (const asset of successes) {
          const prior = snap.get(asset.id);
          if (prior) undoById[asset.id] = prior.status;
        }

        setNotice({
          target,
          applied: successes.length,
          failed: failures.length,
          failures,
          undoById,
        });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [patchAssets, replaceSelection, upsertAssets],
  );

  const retryFailed = useCallback(async () => {
    if (!notice) return;
    const ids = notice.failures.filter((f) => f.retryable).map((f) => f.id);
    await apply(ids, notice.target);
  }, [apply, notice]);

  const undo = useCallback(async () => {
    if (!notice || Object.keys(notice.undoById).length === 0 || busyRef.current)
      return;

    const groups = new Map<AssetStatus, string[]>();
    for (const [id, status] of Object.entries(notice.undoById)) {
      const list = groups.get(status) ?? [];
      list.push(id);
      groups.set(status, list);
    }

    setBusy(true);
    busyRef.current = true;
    try {
      const allSuccess: Asset[] = [];
      const allFail: BulkFailure[] = [];
      const remainingUndo: Record<string, AssetStatus> = { ...notice.undoById };

      for (const [status, ids] of groups) {
        const snap = snapshotSelected(itemsRef.current, ids);
        patchAssets(ids, { status });
        const outcomes = await sendChunks(ids, status);
        const { successes, failures } = mergeChunkOutcomes(outcomes, snap);
        allSuccess.push(...successes);
        allFail.push(...failures);
        for (const id of ids) {
          if (successes.some((asset) => asset.id === id))
            delete remainingUndo[id];
        }
      }

      upsertAssets(allSuccess);
      rollbackStatuses(allFail, patchAssets);
      replaceSelection(allFail.map((f) => f.id));

      setNotice({
        target: notice.target,
        applied: allSuccess.length,
        failed: allFail.length,
        failures: allFail,
        undoById: remainingUndo,
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [notice, patchAssets, replaceSelection, upsertAssets]);

  return {
    busy,
    notice,
    dismiss: () => setNotice(null),
    apply,
    retryFailed,
    undo,
  };
}
