import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AssetCard } from "@/features/assets/AssetCard";
import { AssetGridSkeleton } from "@/features/assets/AssetGridSkeleton";
import { useElementSize } from "@/hooks/useElementSize";
import { useGridKeyboard } from "@/hooks/useGridKeyboard";
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
  onToggleSelect: (id: string, shift?: boolean) => void;
  onOpen: (id: string) => void;
  phase?: "loading" | "error" | "empty" | "ready";
  errorMessage?: string | null;
  onRetry?: () => void;
  onClearFilters?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreError?: string | null;
  onLoadMore?: () => void;
  restoreFocusId?: string | null;
  onRestoreFocusHandled?: () => void;
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

function StatusPane({
  children,
  role,
  live,
  className = "empty",
  restoreFocusId,
  onRestoreFocusHandled,
}: {
  children: ReactNode;
  role?: "status" | "alert";
  live?: "polite";
  className?: string;
  restoreFocusId?: string | null;
  onRestoreFocusHandled?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!restoreFocusId) return;
    ref.current?.focus();
    onRestoreFocusHandled?.();
  }, [restoreFocusId, onRestoreFocusHandled]);

  return (
    <div
      ref={ref}
      className={className}
      role={role}
      aria-live={live}
      tabIndex={-1}
    >
      {children}
    </div>
  );
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
  restoreFocusId,
  onRestoreFocusHandled,
}: Props) {
  if (phase === "loading") {
    return (
      <StatusPane
        className="skeleton-wrap"
        role="status"
        live="polite"
        restoreFocusId={restoreFocusId}
        onRestoreFocusHandled={onRestoreFocusHandled}
      >
        <p className="sr-only">Loading assets…</p>
        <AssetGridSkeleton />
      </StatusPane>
    );
  }

  if (phase === "error") {
    return (
      <StatusPane
        className="empty empty--error"
        role="alert"
        restoreFocusId={restoreFocusId}
        onRestoreFocusHandled={onRestoreFocusHandled}
      >
        <p className="empty__title">Couldn’t load assets</p>
        <p className="muted">
          {errorMessage ?? "Something went wrong. Try again."}
        </p>
        {onRetry && (
          <p>
            <button type="button" className="btn-accent" onClick={onRetry}>
              Try again
            </button>
          </p>
        )}
      </StatusPane>
    );
  }

  if (phase === "empty" || assets.length === 0) {
    return (
      <StatusPane
        restoreFocusId={restoreFocusId}
        onRestoreFocusHandled={onRestoreFocusHandled}
      >
        <p className="empty__title">Nothing matches these filters</p>
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
      </StatusPane>
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
      restoreFocusId={restoreFocusId}
      onRestoreFocusHandled={onRestoreFocusHandled}
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
  restoreFocusId,
  onRestoreFocusHandled,
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
  Pick<Props, "onLoadMore" | "restoreFocusId" | "onRestoreFocusHandled">) {
  const parentRef = useRef<HTMLDivElement>(null);
  const gridFocusRef = useRef(false);
  const { width } = useElementSize(parentRef);
  const ready = width > 0;

  const cols = ready ? columnCount(width) : 1;
  const rowSize = rowHeightFor(ready ? width : MIN_CARD_WIDTH, cols);
  const rowCount = ready ? Math.ceil(assets.length / cols) : 0;
  const estimateSize = useCallback(() => rowSize, [rowSize]);

  const [focusedId, setFocusedId] = useState<string | null>(
    () => assets[0]?.id ?? null,
  );

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
  const focusedMounted = virtualRows.some((row) => {
    const start = row.index * cols;
    return assets
      .slice(start, start + cols)
      .some((asset) => asset.id === focusedId);
  });

  useEffect(() => {
    if (!onLoadMore || !hasMore || loadingMore || loadMoreError) return;
    if (lastIndex < 0) return;
    if (rowCount - lastIndex - 1 <= LOAD_MORE_ROWS) onLoadMore();
  }, [lastIndex, rowCount, hasMore, loadingMore, loadMoreError, onLoadMore]);

  useEffect(() => {
    const onFocusIn = (event: Event) => {
      gridFocusRef.current = !!parentRef.current?.contains(
        event.target as Node,
      );
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  const focusCell = useCallback(
    (id: string | null) => {
      const root = parentRef.current;
      if (!root) return;
      if (!id) {
        root.focus();
        return;
      }
      const index = assets.findIndex((asset) => asset.id === id);
      if (index >= 0) virtualizer.scrollToIndex(Math.floor(index / cols));
      const tryFocus = () => {
        const cell = root.querySelector<HTMLElement>(
          `[data-asset-id="${CSS.escape(id)}"]`,
        );
        if (cell) cell.focus();
        else root.focus();
      };
      requestAnimationFrame(() => requestAnimationFrame(tryFocus));
    },
    [assets, cols, virtualizer],
  );

  useLayoutEffect(() => {
    if (assets.length === 0) return;
    if (focusedId && assets.some((asset) => asset.id === focusedId)) return;
    const next = assets[0]?.id ?? null;
    setFocusedId(next);
    if (gridFocusRef.current) focusCell(next);
  }, [assets, focusedId, focusCell]);

  useEffect(() => {
    if (!restoreFocusId) return;
    const exists = assets.some((asset) => asset.id === restoreFocusId);
    const target = exists ? restoreFocusId : (assets[0]?.id ?? null);
    setFocusedId(target);
    focusCell(target);
    onRestoreFocusHandled?.();
  }, [restoreFocusId, assets, focusCell, onRestoreFocusHandled]);

  const onMoveFocus = useCallback(
    (id: string, shift: boolean) => {
      setFocusedId(id);
      focusCell(id);
      if (shift) onToggleSelect(id, true);
    },
    [focusCell, onToggleSelect],
  );

  const onCellFocus = useCallback((id: string) => {
    setFocusedId(id);
  }, []);

  const ids = assets.map((asset) => asset.id);
  const onKeyDown = useGridKeyboard({
    ids,
    cols,
    focusedId,
    selectedIds,
    onMoveFocus,
    onToggleSelect,
    onOpen,
  });

  const onGridFocus = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (focusedId) focusCell(focusedId);
  };

  return (
    <div
      ref={parentRef}
      className="grid-scroller"
      role="grid"
      aria-label="Assets"
      aria-multiselectable="true"
      aria-rowcount={rowCount}
      aria-colcount={cols}
      tabIndex={focusedMounted ? -1 : 0}
      onKeyDown={onKeyDown}
      onFocus={onGridFocus}
    >
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
              role="row"
              aria-rowindex={virtualRow.index + 1}
              className="grid-row"
              style={{
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              }}
            >
              {rowAssets.map((asset, col) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  selected={selectedIds.has(asset.id)}
                  active={activeId === asset.id}
                  focused={focusedId === asset.id}
                  colIndex={col + 1}
                  onToggleSelect={onToggleSelect}
                  onOpen={onOpen}
                  onCellFocus={onCellFocus}
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
        <div className="grid-footer grid-footer--error" role="alert">
          <span>Couldn’t load more. {loadMoreError}</span>
          {onLoadMore && (
            <button type="button" className="btn-accent" onClick={onLoadMore}>
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
