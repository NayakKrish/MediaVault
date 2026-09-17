import { useCallback, useMemo, useState } from "react";
import { AssetDetail } from "@/features/assets/AssetDetail";
import { AssetFilters } from "@/features/assets/AssetFilters";
import { AssetGrid } from "@/features/assets/AssetGrid";
import { BulkBar, BulkNoticeBanner } from "@/features/assets/BulkBar";
import { TopBar } from "@/features/assets/TopBar";
import { serializeFilters } from "@/features/assets/urlQuery";
import { useAssetFilters } from "@/hooks/useAssetFilters";
import { useAssets } from "@/hooks/useAssets";
import { useBulkStatus } from "@/hooks/useBulkStatus";
import { useSelection } from "@/hooks/useSelection";
import type { Asset } from "@/lib/types";

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

  const [activeId, setActiveId] = useState<string | null>(null);

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
    patchAssets,
    upsertAssets,
  } = useAssets(assetQuery);

  const filterKey = serializeFilters(filters);
  const selection = useSelection(items, filterKey);
  const bulk = useBulkStatus({
    items,
    patchAssets,
    upsertAssets,
    replaceSelection: selection.replace,
  });

  const loadedIds = useMemo(() => items.map((asset) => asset.id), [items]);
  const allLoadedSelected =
    items.length > 0 &&
    items.every((asset) => selection.selectedIds.has(asset.id));

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

  const handleOpen = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const handleClose = useCallback(() => {
    setActiveId(null);
  }, []);

  const handleSaved = useCallback(
    (asset: Asset) => {
      upsertAssets([asset]);
    },
    [upsertAssets],
  );

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

      <BulkBar
        loadedCount={items.length}
        selectedCount={selection.selectedIds.size}
        busy={bulk.busy}
        allLoadedSelected={allLoadedSelected}
        onSelectAll={() => selection.selectAll(loadedIds)}
        onClear={selection.clear}
        onApply={(status) => bulk.apply([...selection.selectedIds], status)}
      />

      {bulk.notice && (
        <BulkNoticeBanner
          notice={bulk.notice}
          busy={bulk.busy}
          onRetry={bulk.retryFailed}
          onUndo={bulk.undo}
          onDismiss={bulk.dismiss}
        />
      )}

      <main className="content">
        <AssetGrid
          assets={items}
          selectedIds={selection.selectedIds}
          activeId={activeId}
          onToggleSelect={selection.toggle}
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
