import { useCallback, useState } from "react";
import { bulkSetStatus } from "@/api/client";
import { AssetDetail } from "@/features/assets/AssetDetail";
import { AssetFilters } from "@/features/assets/AssetFilters";
import { AssetGrid } from "@/features/assets/AssetGrid";
import { TopBar } from "@/features/assets/TopBar";
import { useAssetFilters } from "@/hooks/useAssetFilters";
import { useAssets } from "@/hooks/useAssets";
import { statusLabel } from "@/lib/format";
import type { Asset, AssetStatus } from "@/lib/types";

const STATUSES: AssetStatus[] = ["draft", "in_review", "approved", "archived"];

export function App() {
  const {
    qInput,
    setQInput,
    tagInput,
    setTagInput,
    filters,
    setSort,
    toggleStatus,
    toggleKind,
    resetFilters,
    assetQuery,
  } = useAssetFilters();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const {
    items,
    total,
    loading,
    loadingMore,
    error,
    loadMoreError,
    hasMore,
    loadMore,
    retry,
  } = useAssets(assetQuery);

  const phase =
    loading && items.length === 0
      ? "loading"
      : error && items.length === 0
        ? "error"
        : !loading && items.length === 0
          ? "empty"
          : "ready";

  const summary =
    loading && items.length === 0
      ? "Loading…"
      : error && items.length === 0
        ? "Failed to load"
        : `${items.length} of ${total.toLocaleString()} shown`;

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleOpen = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const handleClose = useCallback(() => {
    setActiveId(null);
  }, []);

  async function applyBulkStatus(next: AssetStatus) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setNotice(null);
    try {
      const result = await bulkSetStatus(ids, next);
      setNotice(`${result.applied} updated, ${result.failed} failed.`);
      setSelectedIds(new Set());
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Bulk update failed");
    }
  }

  function handleSaved(_asset: Asset) {
    // The list is not told that anything changed, so it shows stale rows.
  }

  return (
    <div className="app">
      <TopBar
        q={qInput}
        onQChange={setQInput}
        tagInput={tagInput}
        onTagInputChange={setTagInput}
        sort={filters.sort}
        onSortChange={setSort}
      />

      <AssetFilters
        status={filters.status}
        kind={filters.kind}
        onToggleStatus={toggleStatus}
        onToggleKind={toggleKind}
        summary={summary}
      />

      {selectedIds.size > 0 && (
        <div className="bulkbar">
          <span>{selectedIds.size} selected</span>
          {STATUSES.map((s) => (
            <button key={s} type="button" onClick={() => applyBulkStatus(s)}>
              Set {statusLabel(s).toLowerCase()}
            </button>
          ))}
          <button type="button" onClick={() => setSelectedIds(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {notice && <p className="notice">{notice}</p>}

      <main className="content">
        <AssetGrid
          assets={items}
          selectedIds={selectedIds}
          activeId={activeId}
          onToggleSelect={toggleSelect}
          onOpen={handleOpen}
          phase={phase}
          errorMessage={error}
          onRetry={retry}
          onClearFilters={resetFilters}
          hasMore={hasMore}
          loadingMore={loadingMore}
          loadMoreError={loadMoreError}
          onLoadMore={loadMore}
        />
        {activeId && (
          <AssetDetail
            id={activeId}
            onClose={handleClose}
            onSaved={handleSaved}
          />
        )}
      </main>
    </div>
  );
}
