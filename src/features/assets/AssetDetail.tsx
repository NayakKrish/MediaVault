import { useEffect, useRef, useState } from "react";
import { getAsset, thumbnailUrl, updateAsset } from "@/api/client";
import {
  formatBytes,
  formatDate,
  formatDuration,
  statusLabel,
} from "@/lib/format";
import { isAbortError } from "@/lib/abort";
import { isApiError } from "@/lib/apiError";
import { userMessage } from "@/lib/userMessage";
import type { Asset, AssetStatus } from "@/lib/types";

const STATUSES: AssetStatus[] = ["draft", "in_review", "approved", "archived"];

function DetailSkeleton() {
  return (
    <div className="panel-skeleton" role="status" aria-live="polite">
      <p className="sr-only">Loading asset…</p>
      <div className="skeleton skeleton--thumb-lg" aria-hidden="true" />
      <div className="skeleton skeleton--line skeleton--line-wide" aria-hidden="true" />
      <div className="skeleton skeleton--line skeleton--line-mid" aria-hidden="true" />
      <div className="skeleton-facts" aria-hidden="true">
        <div className="skeleton skeleton--line" />
        <div className="skeleton skeleton--line" />
        <div className="skeleton skeleton--line" />
        <div className="skeleton skeleton--line" />
      </div>
    </div>
  );
}

interface Props {
  id: string;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
}

/**
 * Overlay detail panel. Width is taken out of the layout flow so the grid
 * scroll container does not shrink when this opens.
 */
export function AssetDetail({ id, onClose, onSaved }: Props) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setAsset(null);
    setError(null);
    setConflict(null);
    setThumbFailed(false);
    getAsset(id, controller.signal)
      .then(setAsset)
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        setError(userMessage(err));
      });
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    closeRef.current?.focus();
  }, [id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function setStatus(status: AssetStatus) {
    if (!asset) return;
    setSaving(true);
    setError(null);
    setConflict(null);
    try {
      const updated = await updateAsset(asset.id, asset.version, { status });
      setAsset(updated);
      onSaved(updated);
    } catch (err) {
      if (
        isApiError(err) &&
        (err.status === 409 || err.code === "version_conflict")
      ) {
        try {
          const fresh = await getAsset(asset.id);
          setAsset(fresh);
          onSaved(fresh);
          setConflict(userMessage(err));
        } catch (refetchErr) {
          setError(userMessage(refetchErr));
        }
      } else {
        setError(userMessage(err));
      }
    } finally {
      setSaving(false);
    }
  }

  const showThumb = asset?.hasThumbnail && !thumbFailed;
  const titleId = "asset-detail-title";

  return (
    <aside
      className="panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="panel__head">
        <h2 id={titleId}>Asset detail</h2>
        <button ref={closeRef} type="button" onClick={onClose}>
          Close
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {conflict && <p className="notice notice--warn panel__notice">{conflict}</p>}
      {!asset && !error && <DetailSkeleton />}

      {asset && (
        <div className="panel__body">
          {showThumb ? (
            <img
              className="panel__thumb"
              src={thumbnailUrl(asset.id)}
              alt=""
              onError={() => setThumbFailed(true)}
            />
          ) : (
            <div
              className="panel__thumb panel__thumb--missing"
              aria-hidden="true"
            />
          )}
          <h3>{asset.name}</h3>
          <dl className="facts">
            <dt>Id</dt>
            <dd>{asset.id}</dd>
            <dt>Kind</dt>
            <dd>{asset.kind}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(asset.sizeBytes)}</dd>
            {asset.width && (
              <>
                <dt>Dimensions</dt>
                <dd>
                  {asset.width}×{asset.height}
                </dd>
              </>
            )}
            {asset.durationSec && (
              <>
                <dt>Duration</dt>
                <dd>{formatDuration(asset.durationSec)}</dd>
              </>
            )}
            <dt>Owner</dt>
            <dd>{asset.owner.name}</dd>
            <dt>Updated</dt>
            <dd>{formatDate(asset.updatedAt)}</dd>
            <dt>Version</dt>
            <dd>{asset.version}</dd>
          </dl>

          {asset.tags.length > 0 && (
            <ul className="tags">
              {asset.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}

          <p className="muted">Status</p>
          <div className="row">
            {STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                className={`status-btn status-btn--${status}`}
                disabled={saving || status === asset.status}
                onClick={() => setStatus(status)}
              >
                {statusLabel(status)}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
