import { useEffect, useState } from "react";
import { listAssets } from "@/api/client";
import { serializeFilters, type FilterState } from "@/features/assets/urlQuery";
import { isAbortError } from "@/lib/abort";
import type { Asset, AssetQuery } from "@/lib/types";

interface State {
  items: Asset[];
  total: number;
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
}

function queryFingerprint(query: AssetQuery): string {
  const filters: FilterState = {
    q: query.q ?? "",
    status: query.status ?? [],
    kind: query.kind ?? [],
    tag: query.tag ?? [],
    sort: query.sort ?? "updatedAt:desc",
  };
  return `${serializeFilters(filters)}|limit=${query.limit ?? ""}|cursor=${query.cursor ?? ""}`;
}

/**
 * Loads one page for the given query. Cancels the in-flight request when the
 * query changes or the component unmounts. Clears rows on filter change so a
 * slow prior response can never paint under a newer query.
 */
export function useAssets(query: AssetQuery) {
  const [state, setState] = useState<State>({
    items: [],
    total: 0,
    nextCursor: null,
    loading: true,
    error: null,
  });
  const [reloadToken, setReloadToken] = useState(0);

  const key = queryFingerprint(query);

  useEffect(() => {
    const controller = new AbortController();

    setState({
      items: [],
      total: 0,
      nextCursor: null,
      loading: true,
      error: null,
    });

    listAssets(query, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setState({
          items: page.items,
          total: page.total,
          nextCursor: page.nextCursor,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setState({
          items: [],
          total: 0,
          nextCursor: null,
          loading: false,
          error: err instanceof Error ? err.message : "Something went wrong",
        });
      });

    return () => controller.abort();
  }, [key, reloadToken, query]);

  return {
    ...state,
    retry: () => setReloadToken((n) => n + 1),
  };
}
