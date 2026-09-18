import type { AssetQuery } from "@/lib/types";
import type { FilterState } from "./urlQuery";

const SORTS: Array<{ value: NonNullable<AssetQuery["sort"]>; label: string }> =
  [
    { value: "updatedAt:desc", label: "Recently updated" },
    { value: "name:asc", label: "Name A-Z" },
    { value: "sizeBytes:desc", label: "Largest first" },
    { value: "createdAt:desc", label: "Newest" },
  ];

interface Props {
  q: string;
  onQChange: (value: string) => void;
  tagInput: string;
  onTagInputChange: (value: string) => void;
  sort: FilterState["sort"];
  onSortChange: (sort: FilterState["sort"]) => void;
}

export function TopBar({
  q,
  onQChange,
  tagInput,
  onTagInputChange,
  sort,
  onSortChange,
}: Props) {
  return (
    <header className="topbar">
      <h1 className="brand">MediaVault</h1>
      <input
        className="search"
        type="search"
        placeholder="Search assets"
        value={q}
        onChange={(e) => onQChange(e.target.value)}
        aria-label="Search assets"
      />
      <input
        className="search search--tags"
        type="text"
        placeholder="Tags (comma-separated)"
        value={tagInput}
        onChange={(e) => onTagInputChange(e.target.value)}
        aria-label="Filter by tags"
      />
      <select
        className="sort"
        value={sort}
        onChange={(e) => onSortChange(e.target.value as FilterState["sort"])}
        aria-label="Sort assets"
      >
        {SORTS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </header>
  );
}
