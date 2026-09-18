const PLACEHOLDERS = Array.from({ length: 12 }, (_, i) => i);

export function AssetGridSkeleton() {
  return (
    <div className="skeleton-grid" aria-hidden="true">
      {PLACEHOLDERS.map((i) => (
        <div key={i} className="skeleton-card">
          <div className="skeleton skeleton--thumb" />
          <div className="skeleton-card__body">
            <div className="skeleton skeleton--line skeleton--line-wide" />
            <div className="skeleton skeleton--line skeleton--line-mid" />
            <div className="skeleton skeleton--pill" />
          </div>
        </div>
      ))}
    </div>
  );
}
