import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset } from "@/lib/types";

/**
 * Selection over the current loaded order. Shift-click extends a contiguous
 * range from the anchor; select-all / clear are a single Set swap.
 */
export function useSelection(items: Asset[], resetKey: string) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const anchorRef = useRef(anchorId);
  anchorRef.current = anchorId;

  useEffect(() => {
    setSelectedIds(new Set());
    setAnchorId(null);
  }, [resetKey]);

  const toggle = useCallback((id: string, shift = false) => {
    const ordered = itemsRef.current;
    const anchor = anchorRef.current;

    setSelectedIds((prev) => {
      if (shift && anchor) {
        const a = ordered.findIndex((asset) => asset.id === anchor);
        const b = ordered.findIndex((asset) => asset.id === id);
        if (a !== -1 && b !== -1) {
          const from = Math.min(a, b);
          const to = Math.max(a, b);
          const next = new Set(prev);
          for (let i = from; i <= to; i++) {
            const asset = ordered[i];
            if (asset) next.add(asset.id);
          }
          return next;
        }
      }

      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

    if (!shift) {
      anchorRef.current = id;
      setAnchorId(id);
    }
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
    setAnchorId(ids[0] ?? null);
  }, []);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    setAnchorId(null);
  }, []);

  const replace = useCallback((ids: Iterable<string>) => {
    const next = new Set(ids);
    const first = next.values().next().value ?? null;
    setSelectedIds(next);
    setAnchorId(first);
  }, []);

  return { selectedIds, toggle, selectAll, clear, replace };
}
