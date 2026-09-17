import type { AssetKind, AssetQuery, AssetStatus } from "@/lib/types";

const STATUSES = new Set<AssetStatus>([
  "draft",
  "in_review",
  "approved",
  "archived",
]);
const KINDS = new Set<AssetKind>(["image", "video", "document"]);
const SORTS = new Set<NonNullable<AssetQuery["sort"]>>([
  "updatedAt:desc",
  "updatedAt:asc",
  "name:asc",
  "name:desc",
  "sizeBytes:desc",
  "createdAt:desc",
]);

export interface FilterState {
  q: string;
  status: AssetStatus[];
  kind: AssetKind[];
  tag: string[];
  sort: NonNullable<AssetQuery["sort"]>;
}

export const DEFAULT_FILTERS: FilterState = {
  q: "",
  status: [],
  kind: [],
  tag: [],
  sort: "updatedAt:desc",
};

function parseList<T extends string>(raw: string | null, allowed: Set<T>): T[] {
  if (!raw) return [];
  const seen = new Set<T>();
  for (const part of raw.split(",")) {
    const value = part.trim() as T;
    if (allowed.has(value) && !seen.has(value)) seen.add(value);
  }
  return [...seen];
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const value = part.trim().toLowerCase();
    if (value && !seen.has(value)) seen.add(value);
  }
  return [...seen];
}

/** Read filter state from the current location search string. */
export function parseFiltersFromSearch(
  search = window.location.search,
): FilterState {
  const params = new URLSearchParams(search);
  const sortRaw = params.get("sort");
  const sort =
    sortRaw && SORTS.has(sortRaw as FilterState["sort"])
      ? (sortRaw as FilterState["sort"])
      : DEFAULT_FILTERS.sort;

  return {
    q: params.get("q")?.trim() ?? "",
    status: parseList(params.get("status"), STATUSES),
    kind: parseList(params.get("kind"), KINDS),
    tag: parseTags(params.get("tag")),
    sort,
  };
}

/** Serialize filters to a search string without leading `?`. Omits defaults. */
export function serializeFilters(filters: FilterState): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status.length)
    params.set("status", [...filters.status].sort().join(","));
  if (filters.kind.length)
    params.set("kind", [...filters.kind].sort().join(","));
  if (filters.tag.length) params.set("tag", [...filters.tag].sort().join(","));
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set("sort", filters.sort);
  return params.toString();
}

export function filtersToAssetQuery(
  filters: FilterState,
  extras?: Pick<AssetQuery, "limit" | "cursor">,
): AssetQuery {
  return {
    q: filters.q || undefined,
    status: filters.status.length ? filters.status : undefined,
    kind: filters.kind.length ? filters.kind : undefined,
    tag: filters.tag.length ? filters.tag : undefined,
    sort: filters.sort,
    limit: extras?.limit,
    cursor: extras?.cursor,
  };
}

export function filtersEqual(a: FilterState, b: FilterState): boolean {
  return serializeFilters(a) === serializeFilters(b);
}
