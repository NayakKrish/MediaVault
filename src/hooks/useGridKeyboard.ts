import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";

const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

export function neighborIndex(
  current: number,
  key: string,
  cols: number,
  length: number,
): number | null {
  if (length === 0 || current < 0) return null;
  let next = current;
  switch (key) {
    case "ArrowRight":
      next = Math.min(length - 1, current + 1);
      break;
    case "ArrowLeft":
      next = Math.max(0, current - 1);
      break;
    case "ArrowDown":
      next = Math.min(length - 1, current + cols);
      break;
    case "ArrowUp":
      next = Math.max(0, current - cols);
      break;
    default:
      return null;
  }
  return next;
}

interface Options {
  ids: string[];
  cols: number;
  focusedId: string | null;
  selectedIds: Set<string>;
  onMoveFocus: (id: string, shift: boolean) => void;
  onToggleSelect: (id: string, shift?: boolean) => void;
  onOpen: (id: string) => void;
}

/**
 * Roving-tabindex key map for the asset grid. Arrows move; Space toggles;
 * Shift+arrows extend the existing selection range; Enter opens.
 */
export function useGridKeyboard({
  ids,
  cols,
  focusedId,
  selectedIds,
  onMoveFocus,
  onToggleSelect,
  onOpen,
}: Options) {
  return useCallback(
    (event: ReactKeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("button")) return;

      const id = focusedId;
      if (!id) return;

      if (event.key === "Enter") {
        event.preventDefault();
        onOpen(id);
        return;
      }

      if (event.key === " ") {
        event.preventDefault();
        onToggleSelect(id, false);
        return;
      }

      if (!ARROWS.has(event.key)) return;

      const current = ids.indexOf(id);
      const next = neighborIndex(current, event.key, cols, ids.length);
      if (next === null) return;
      const nextId = ids[next];
      if (!nextId) return;

      event.preventDefault();

      if (event.shiftKey && !selectedIds.has(id)) {
        onToggleSelect(id, false);
      }
      onMoveFocus(nextId, event.shiftKey);
    },
    [ids, cols, focusedId, selectedIds, onMoveFocus, onToggleSelect, onOpen],
  );
}
