import { memo, useState } from "react";
import { thumbnailUrl } from "@/api/client";
import { formatBytes, formatDate, statusLabel } from "@/lib/format";
import type { Asset } from "@/lib/types";

interface Props {
  asset: Asset;
  selected: boolean;
  active: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
}

function AssetThumb({ asset }: { asset: Asset }) {
  const [failed, setFailed] = useState(false);

  if (!asset.hasThumbnail || failed) {
    return (
      <div className="card__thumb card__thumb--missing" aria-hidden="true" />
    );
  }

  return (
    <img
      className="card__thumb"
      src={thumbnailUrl(asset.id)}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export const AssetCard = memo(function AssetCard({
  asset,
  selected,
  active,
  onToggleSelect,
  onOpen,
}: Props) {
  if (import.meta.env.DEV && typeof window !== "undefined") {
    const w = window as Window & { __mvCardRenders?: number };
    w.__mvCardRenders = (w.__mvCardRenders ?? 0) + 1;
  }

  return (
    <div
      className={
        "card" +
        (selected ? " card--selected" : "") +
        (active ? " card--active" : "")
      }
      onClick={() => onOpen(asset.id)}
    >
      <AssetThumb asset={asset} />
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
        checked={selected}
        aria-label={`Select ${asset.name}`}
        onClick={(e) => e.stopPropagation()}
        onChange={() => onToggleSelect(asset.id)}
      />
    </div>
  );
});
