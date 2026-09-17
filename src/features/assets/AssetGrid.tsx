import { useCallback, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AssetCard } from "@/features/assets/AssetCard";
import { useElementSize } from "@/hooks/useElementSize";
import type { Asset } from "@/lib/types";

const MIN_CARD_WIDTH = 220;
const GAP = 12;
const PAD_X = 16;
const PAD_Y = 16;
const BODY_HEIGHT = 92;
const BORDER_Y = 2;
const THUMB_RATIO = 10 / 16;
const OVERSCAN_ROWS = 4;
const LOAD_MORE_ROWS = 4;

interface Props {
  assets: Asset[];
  selectedIds: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
  phase?: "loading" | "error" | "empty" | "ready";
  errorMessage?: string | null;
  onRetry?: () => void;
  onClearFilters?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreError?: string | null;
  onLoadMore?: () => void;
}

function columnCount(width: number): number {
  const inner = Math.max(0, width - PAD_X * 2);
  return Math.max(1, Math.floor((inner + GAP) / (MIN_CARD_WIDTH + GAP)));
}

function rowHeightFor(width: number, cols: number): number {
  const inner = Math.max(0, width - PAD_X * 2);
  const cardWidth = (inner - GAP * (cols - 1)) / cols;
  const thumbHeight = cardWidth * THUMB_RATIO;
  return thumbHeight + BODY_HEIGHT + BORDER_Y + GAP;
}

export function AssetGrid({
  assets,
  selectedIds,
  activeId,
  onToggleSelect,
  onOpen,
  phase = "ready",
  errorMessage,
  onRetry,
  onClearFilters,
  hasMore = false,
  loadingMore = false,
  loadMoreError = null,
  onLoadMore,
}: Props) {
  if (phase === "loading") {
    return (
      <div className="empty" role="status" aria-live="polite">
        <p className="muted">Loading assets…</p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="empty" role="alert">
        <p>Couldn’t load assets.</p>
        <p className="muted">{errorMessage ?? "Something went wrong."}</p>
        {onRetry && (
          <p>
            <button type="button" onClick={onRetry}>
              Try again
            </button>
          </p>
        )}
      </div>
    );
  }

  if (phase === "empty" || assets.length === 0) {
    return (
      <div className="empty">
        <p>Nothing matches these filters.</p>
        <p className="muted">
          Clear the search box or widen the status filter.
        </p>
        {onClearFilters && (
          <p>
            <button type="button" onClick={onClearFilters}>
              Clear filters
            </button>
          </p>
        )}
      </div>
    );
  }

  return (
    <VirtualGrid
      assets={assets}
      selectedIds={selectedIds}
      activeId={activeId}
      onToggleSelect={onToggleSelect}
      onOpen={onOpen}
      hasMore={hasMore}
      loadingMore={loadingMore}
      loadMoreError={loadMoreError}
      onLoadMore={onLoadMore}
    />
  );
}

function VirtualGrid({
  assets,
  selectedIds,
  activeId,
  onToggleSelect,
  onOpen,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
}: Required<
  Pick<
    Props,
    | "assets"
    | "selectedIds"
    | "activeId"
    | "onToggleSelect"
    | "onOpen"
    | "hasMore"
    | "loadingMore"
    | "loadMoreError"
  >
> &
  Pick<Props, "onLoadMore">) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(parentRef);
  const ready = width > 0;

  const cols = ready ? columnCount(width) : 1;
  const rowSize = rowHeightFor(ready ? width : MIN_CARD_WIDTH, cols);
  const rowCount = ready ? Math.ceil(assets.length / cols) : 0;
  const estimateSize = useCallback(() => rowSize, [rowSize]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: OVERSCAN_ROWS,
    paddingStart: PAD_Y,
    paddingEnd: PAD_Y,
    getItemKey: (index) => index,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowSize, cols]);

  const virtualRows = virtualizer.getVirtualItems();
  const lastIndex = virtualRows.at(-1)?.index ?? -1;

  useEffect(() => {
    if (!onLoadMore || !hasMore || loadingMore || loadMoreError) return;
    if (lastIndex < 0) return;
    if (rowCount - lastIndex - 1 <= LOAD_MORE_ROWS) onLoadMore();
  }, [lastIndex, rowCount, hasMore, loadingMore, loadMoreError, onLoadMore]);

  return (
    <div ref={parentRef} className="grid-scroller">
      <div
        className="grid-spacer"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualRows.map((virtualRow) => {
          const start = virtualRow.index * cols;
          const rowAssets = assets.slice(start, start + cols);
          return (
            <div
              key={virtualRow.key}
              className="grid-row"
              style={{
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              }}
            >
              {rowAssets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  selected={selectedIds.has(asset.id)}
                  active={activeId === asset.id}
                  onToggleSelect={onToggleSelect}
                  onOpen={onOpen}
                />
              ))}
            </div>
          );
        })}
      </div>
      {loadingMore && (
        <div className="grid-footer" role="status">
          Loading more…
        </div>
      )}
      {loadMoreError && (
        <div className="grid-footer" role="alert">
          <span>Couldn’t load more. {loadMoreError}</span>
          {onLoadMore && (
            <button type="button" onClick={onLoadMore}>
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
