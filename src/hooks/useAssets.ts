import { useCallback, useEffect, useRef, useState } from "react";
import { listAssets } from "@/api/client";
import { serializeFilters, type FilterState } from "@/features/assets/urlQuery";
import { isAbortError } from "@/lib/abort";
import type { Asset, AssetQuery } from "@/lib/types";

export const PAGE_LIMIT = 50;

interface State {
  items: Asset[];
  total: number;
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMoreError: string | null;
}

function filterFingerprint(query: AssetQuery): string {
  const filters: FilterState = {
    q: query.q ?? "",
    status: query.status ?? [],
    kind: query.kind ?? [],
    tag: query.tag ?? [],
    sort: query.sort ?? "updatedAt:desc",
  };
  return `${serializeFilters(filters)}|limit=${query.limit ?? ""}`;
}

function appendUnique(prev: Asset[], next: Asset[]): Asset[] {
  if (next.length === 0) return prev;
  const seen = new Set(prev.map((asset) => asset.id));
  const extra = next.filter((asset) => !seen.has(asset.id));
  return extra.length === 0 ? prev : prev.concat(extra);
}

/**
 * Cursor-paginated loader. Filter changes abort in-flight work and replace the
 * list; `loadMore` appends the next page without flashing empty.
 */
export function useAssets(query: AssetQuery) {
  const [state, setState] = useState<State>({
    items: [],
    total: 0,
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: null,
    loadMoreError: null,
  });
  const [reloadToken, setReloadToken] = useState(0);

  const queryRef = useRef(query);
  queryRef.current = query;

  const nextCursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const moreControllerRef = useRef<AbortController | null>(null);

  const key = filterFingerprint(query);

  useEffect(() => {
    const controller = new AbortController();
    moreControllerRef.current?.abort();
    moreControllerRef.current = null;
    loadingMoreRef.current = false;
    nextCursorRef.current = null;

    setState({
      items: [],
      total: 0,
      nextCursor: null,
      loading: true,
      loadingMore: false,
      error: null,
      loadMoreError: null,
    });

    const { cursor: _ignored, ...filters } = queryRef.current;
    listAssets({ ...filters, cursor: undefined }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        nextCursorRef.current = page.nextCursor;
        setState({
          items: page.items,
          total: page.total,
          nextCursor: page.nextCursor,
          loading: false,
          loadingMore: false,
          error: null,
          loadMoreError: null,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        nextCursorRef.current = null;
        setState({
          items: [],
          total: 0,
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error: err instanceof Error ? err.message : "Something went wrong",
          loadMoreError: null,
        });
      });

    return () => {
      controller.abort();
      moreControllerRef.current?.abort();
    };
  }, [key, reloadToken]);

  const loadMore = useCallback(() => {
    const cursor = nextCursorRef.current;
    if (!cursor || loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setState((s) => ({ ...s, loadingMore: true, loadMoreError: null }));

    const controller = new AbortController();
    moreControllerRef.current = controller;

    const { cursor: _ignored, ...filters } = queryRef.current;
    listAssets({ ...filters, cursor }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        nextCursorRef.current = page.nextCursor;
        loadingMoreRef.current = false;
        setState((s) => ({
          ...s,
          items: appendUnique(s.items, page.items),
          total: page.total,
          nextCursor: page.nextCursor,
          loadingMore: false,
          loadMoreError: null,
        }));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        loadingMoreRef.current = false;
        setState((s) => ({
          ...s,
          loadingMore: false,
          loadMoreError:
            err instanceof Error ? err.message : "Something went wrong",
        }));
      });
  }, []);

  return {
    ...state,
    hasMore: Boolean(state.nextCursor),
    loadMore,
    retry: () => setReloadToken((n) => n + 1),
  };
}
