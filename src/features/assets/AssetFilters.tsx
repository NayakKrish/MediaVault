import { kindLabel, statusLabel } from "@/lib/format";
import type { AssetKind, AssetStatus } from "@/lib/types";

const STATUSES: AssetStatus[] = ["draft", "in_review", "approved", "archived"];
const KINDS: AssetKind[] = ["image", "video", "document"];

interface Props {
  status: AssetStatus[];
  kind: AssetKind[];
  onToggleStatus: (status: AssetStatus, on: boolean) => void;
  onToggleKind: (kind: AssetKind, on: boolean) => void;
  summary: string;
}

export function AssetFilters({
  status,
  kind,
  onToggleStatus,
  onToggleKind,
  summary,
}: Props) {
  return (
    <div className="filters">
      <fieldset className="filters__group">
        <legend className="filters__legend">Status</legend>
        {STATUSES.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              checked={status.includes(s)}
              onChange={(e) => onToggleStatus(s, e.target.checked)}
            />
            {statusLabel(s)}
          </label>
        ))}
      </fieldset>
      <fieldset className="filters__group">
        <legend className="filters__legend">Kind</legend>
        {KINDS.map((k) => (
          <label key={k}>
            <input
              type="checkbox"
              checked={kind.includes(k)}
              onChange={(e) => onToggleKind(k, e.target.checked)}
            />
            {kindLabel(k)}
          </label>
        ))}
      </fieldset>
      <span className="muted" aria-live="polite">
        {summary}
      </span>
    </div>
  );
}
