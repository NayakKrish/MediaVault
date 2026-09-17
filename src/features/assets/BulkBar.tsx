import { statusLabel } from "@/lib/format";
import type { BulkNotice } from "@/hooks/useBulkStatus";
import type { AssetStatus } from "@/lib/types";

const STATUSES: AssetStatus[] = ["draft", "in_review", "approved", "archived"];

interface Props {
  loadedCount: number;
  selectedCount: number;
  busy: boolean;
  allLoadedSelected: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onApply: (status: AssetStatus) => void;
}

export function BulkBar({
  loadedCount,
  selectedCount,
  busy,
  allLoadedSelected,
  onSelectAll,
  onClear,
  onApply,
}: Props) {
  if (loadedCount === 0) return null;

  return (
    <div className="bulkbar">
      <button
        type="button"
        onClick={onSelectAll}
        disabled={busy || allLoadedSelected}
      >
        Select all loaded ({loadedCount})
      </button>
      {selectedCount > 0 && (
        <>
          <span>
            {selectedCount} selected{busy ? " — updating…" : ""}
          </span>
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => onApply(s)}
            >
              Set {statusLabel(s).toLowerCase()}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={onClear}>
            Clear selection
          </button>
        </>
      )}
    </div>
  );
}

interface NoticeProps {
  notice: BulkNotice;
  busy: boolean;
  onRetry: () => void;
  onUndo: () => void;
  onDismiss: () => void;
}

export function BulkNoticeBanner({
  notice,
  busy,
  onRetry,
  onUndo,
  onDismiss,
}: NoticeProps) {
  const retryable = notice.failures.filter((f) => f.retryable);
  const permanent = notice.failures.filter((f) => !f.retryable);
  const canUndo = Object.keys(notice.undoById).length > 0;

  return (
    <div className="notice" role="status">
      <p>
        {notice.applied === 0 && notice.failed === 0
          ? "Nothing to update."
          : `${notice.applied} updated${notice.failed ? `, ${notice.failed} could not change` : ""}.`}
      </p>
      {notice.failures.length > 0 && (
        <ul className="notice__list">
          {notice.failures.slice(0, 12).map((failure) => (
            <li key={failure.id}>
              {failure.name}: {failure.message}
            </li>
          ))}
          {notice.failures.length > 12 && (
            <li>…and {notice.failures.length - 12} more</li>
          )}
        </ul>
      )}
      {permanent.length > 0 && retryable.length === 0 && (
        <p className="muted">Legal hold cannot be retried.</p>
      )}
      <div className="notice__actions">
        {retryable.length > 0 && (
          <button type="button" disabled={busy} onClick={onRetry}>
            Retry {retryable.length} failed
          </button>
        )}
        {canUndo && (
          <button type="button" disabled={busy} onClick={onUndo}>
            Undo
          </button>
        )}
        <button type="button" disabled={busy} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
