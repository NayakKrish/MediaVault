import { thumbnailUrl } from "@/api/client";
import { formatBytes, formatDate, statusLabel } from "@/lib/format";
import type { Asset } from "@/lib/types";

interface Props {
  assets: Asset[];
  selectedIds: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
  /** When set, grid does not claim “no matches” — parent owns empty/error/loading. */
  phase?: "loading" | "error" | "empty" | "ready";
  errorMessage?: string | null;
  onRetry?: () => void;
  onClearFilters?: () => void;
}

/**
 * Baseline grid. Still re-renders every card on selection (Task 2) and is not
 * fully keyboard-operable (Task 5). Empty/loading/error are now distinct.
 */
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
    <div className="grid">
      {assets.map((asset) => (
        <div
          key={asset.id}
          className={
            "card" +
            (selectedIds.has(asset.id) ? " card--selected" : "") +
            (activeId === asset.id ? " card--active" : "")
          }
          onClick={() => onOpen(asset.id)}
        >
          <img className="card__thumb" src={thumbnailUrl(asset.id)} alt="" />
          <div className="card__body">
            <p className="card__name">{asset.name}</p>
            <p className="muted">
              {asset.kind} · {formatBytes(asset.sizeBytes)} ·{" "}
              {formatDate(asset.updatedAt)}
            </p>
            <span className={`pill pill--${asset.status}`}>
              {statusLabel(asset.status)}
            </span>
          </div>
          <input
            type="checkbox"
            className="card__check"
            checked={selectedIds.has(asset.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelect(asset.id)}
          />
        </div>
      ))}
    </div>
  );
}
