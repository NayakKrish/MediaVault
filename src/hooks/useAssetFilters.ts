import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_FILTERS,
  type FilterState,
  filtersEqual,
  filtersToAssetQuery,
  parseFiltersFromSearch,
  serializeFilters,
} from "@/features/assets/urlQuery";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { AssetKind, AssetStatus } from "@/lib/types";

/** Debounce for search + tag inputs. Long enough to coalesce keystrokes under the
 * 80/10s rate limit; short enough that a pause still feels like search-as-you-type. */
export const SEARCH_DEBOUNCE_MS = 300;

function writeFiltersToUrl(filters: FilterState) {
  const next = serializeFilters(filters);
  const current = window.location.search.startsWith("?")
    ? window.location.search.slice(1)
    : window.location.search;
  if (next === current) return;
  const url = next
    ? `${window.location.pathname}?${next}`
    : window.location.pathname;
  window.history.replaceState(null, "", url);
}

/**
 * Filter state lives in the URL (replaceState — no history entry per keystroke).
 * Search and tag text fields update immediately for typing; the committed filter
 * (and network query) wait for debounce.
 */
export function useAssetFilters() {
  const initial = useMemo(() => parseFiltersFromSearch(), []);
  const [qInput, setQInput] = useState(initial.q);
  const [tagInput, setTagInput] = useState(initial.tag.join(", "));
  const [filters, setFilters] = useState<FilterState>(initial);

  const debouncedQ = useDebouncedValue(qInput, SEARCH_DEBOUNCE_MS);
  const debouncedTagInput = useDebouncedValue(tagInput, SEARCH_DEBOUNCE_MS);

  const debouncedTags = useMemo(
    () =>
      debouncedTagInput
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .filter((t, i, arr) => arr.indexOf(t) === i),
    [debouncedTagInput],
  );

  // Commit debounced text fields into filter state.
  useEffect(() => {
    setFilters((prev) => {
      const next: FilterState = {
        ...prev,
        q: debouncedQ.trim(),
        tag: debouncedTags,
      };
      return filtersEqual(prev, next) ? prev : next;
    });
  }, [debouncedQ, debouncedTags]);

  // Mirror filters → URL.
  useEffect(() => {
    writeFiltersToUrl(filters);
  }, [filters]);

  // Browser back/forward (if anything pushed) or external URL edits.
  useEffect(() => {
    const onPopState = () => {
      const parsed = parseFiltersFromSearch();
      setFilters(parsed);
      setQInput(parsed.q);
      setTagInput(parsed.tag.join(", "));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const setStatus = useCallback((status: AssetStatus[]) => {
    setFilters((prev) => ({ ...prev, status }));
  }, []);

  const setKind = useCallback((kind: AssetKind[]) => {
    setFilters((prev) => ({ ...prev, kind }));
  }, []);

  const setSort = useCallback((sort: FilterState["sort"]) => {
    setFilters((prev) => ({ ...prev, sort }));
  }, []);

  const toggleStatus = useCallback((s: AssetStatus, on: boolean) => {
    setFilters((prev) => ({
      ...prev,
      status: on ? [...prev.status, s] : prev.status.filter((x) => x !== s),
    }));
  }, []);

  const toggleKind = useCallback((k: AssetKind, on: boolean) => {
    setFilters((prev) => ({
      ...prev,
      kind: on ? [...prev.kind, k] : prev.kind.filter((x) => x !== k),
    }));
  }, []);

  const resetFilters = useCallback(() => {
    setQInput("");
    setTagInput("");
    setFilters(DEFAULT_FILTERS);
  }, []);

  // Cursor is React-only; drop it whenever the filter identity changes so we
  // never reuse a cursor from a different query (stale_cursor).
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const filterKey = serializeFilters(filters);
  const prevFilterKey = useRef(filterKey);
  useEffect(() => {
    if (prevFilterKey.current !== filterKey) {
      prevFilterKey.current = filterKey;
      setCursor(undefined);
    }
  }, [filterKey]);

  const assetQuery = useMemo(
    () => filtersToAssetQuery(filters, { limit: 24, cursor }),
    [filters, cursor],
  );

  return {
    qInput,
    setQInput,
    tagInput,
    setTagInput,
    filters,
    setStatus,
    setKind,
    setSort,
    toggleStatus,
    toggleKind,
    resetFilters,
    cursor,
    setCursor,
    assetQuery,
  };
}
