# Submission

Keep this tight. Bullet points are fine. We read this before we read your code,
and a clear account of your reasoning carries real weight — including where you
chose not to do something.

## Video walkthrough

Paste your Loom (or equivalent) link here. 5–10 minutes.

**Link:**

---

## How to run it

Anything we need to know beyond `npm install && npm run dev`.

## Time spent

Roughly, and how you split it.

---

## Baseline defects found

| #   | Defect                                                                                                                                                                            | Where                              | Fixed / left / out of scope |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------- |
| 1   | Bulk update sends every selected id in one request; API rejects >50 (`400 too_many_ids`)                                                                                          | `App.tsx` `applyBulkStatus`        | fixed                       |
| 2   | Search/filter race: in-flight `listAssets` is never aborted or sequenced, so a slow earlier response can overwrite a newer query                                                  | `useAssets.ts`                     | fixed                       |
| 3   | Every keystroke fires a list request (no debounce/throttle) → burns the 80/10s rate limit and amplifies flakiness                                                                 | `App.tsx` → `useAssets`            | fixed                       |
| 4   | Empty / loading / error are conflated: with `items=[]`, the grid always shows “Nothing matches…”, including on initial load and after a failed fetch (error banner + false empty) | `AssetGrid.tsx`, `App.tsx`         | fixed                       |
| 5   | `nextCursor` is stored but never used — only the first page (~24) of up to 12.4k assets is reachable                                                                              | `useAssets.ts`, `App.tsx`          | fixed                       |
| 6   | Grid mounts every asset it is given (no windowing); DOM/memory grow with scroll depth once pagination exists                                                                      | `AssetGrid.tsx`                    | fixed                       |
| 7   | Any selection toggle re-renders every card (`selectedIds` Set + unmemoized list)                                                                                                  | `AssetGrid.tsx`                    | fixed                       |
| 8   | Cards are mouse-only `<div onClick>` — not focusable, no arrow/Enter/Space model, checkboxes have no accessible name tied to the asset                                            | `AssetGrid.tsx`                    | knowingly left              |
| 9   | Thumbnails always requested; `hasThumbnail === false` yields a broken `<img>` (no placeholder, layout risk)                                                                       | `AssetGrid.tsx`, `AssetDetail.tsx` | fixed                       |
| 10  | Detail `PATCH` success never updates the list (`handleSaved` is a no-op); bulk success also leaves stale status pills and clears selection even when `failed > 0`                 | `App.tsx`                          | fixed                       |
| 11  | Client has no retries, ignores `Retry-After`, and collapses errors to a string — callers cannot tell 503/429 (retry) from 409/422 (don’t)                                         | `api/client.ts`                    | knowingly left              |
| 12  | Detail panel: opening/closing does not move or restore focus; Escape does not close; rapid id changes race the same way as the list                                               | `AssetDetail.tsx`                  | knowingly left              |

---

## Key decisions

For each significant choice: what you did, what you rejected, and why. Three to
six of these is about right.

**Data fetching and caching**

Plain `fetch` with a small in-flight GET map (refcounted abort). Rejected React Query for now — Task 1 needs cancel + dedupe + URL sync, not a full cache layer; adding one later is easy if Task 2/4 need it.

**Stale response handling**

`AbortController` on every list call; effect cleanup aborts. On query change we clear `items` immediately so a late response cannot paint under a newer filter (ignore-only would still flash wrong rows if we kept the previous page). Aborts are not surfaced as errors.

**Virtualization approach**

`@tanstack/react-virtual` over rows of a CSS grid (not react-window / Virtuoso). It is on the allowed list, small, and leaves card markup ours. Column count is derived from scroller width (`minmax(220px)`). The detail panel is an overlay so opening it does not shrink the scroller or reset scroll. Cursor pagination lives in `useAssets` (`loadMore`, page size 50); a filter change still aborts and replaces the list so `stale_cursor` cannot appear.

**Optimistic updates and rollback**

Bulk apply patches the list first, then `POST /api/assets/bulk-status` in **50-id chunks** with **3** in flight. Per-id `207` results keep successes (upsert server assets) and roll back only failures. `conflict` is retryable; `legal_hold` is listed and excluded from Retry. Undo re-applies each success’s prior status through the same chunk/pool path. Shift-click extends a contiguous range in loaded order; “Select all loaded” swaps one Set.

On `409 version_conflict` the detail panel **refetches** and updates the list row instead of silently re-applying the click — a concurrent edit should not be overwritten. The user can apply again if they still want the change.

**Retry and backoff policy**

_(Task 4 — client still has no retries.)_

**State placement and URL sync**

`q`, `status`, `kind`, `tag`, `sort` are the source of truth in the URL via `history.replaceState` (no history entry per keystroke). Search/tag inputs are local and commit after **300ms** debounce — coalesces typing under the 80/10s rate limit without feeling sticky. The list cursor is owned by `useAssets`, never written to the URL, and dropped whenever the filter identity changes.

---

## Performance

Measured on a Mac (macOS 26.5.1) in the Cursor/Playwright Chromium tab. The 5,000-row run used `CHAOS=0 LATENCY=0` so pagination could finish; all other checks used the default hostile API. Selection isolation used a DEV-only `window.__mvCardRenders` counter on `AssetCard`.

| Metric                                          | Before                                                                     | After                                                                             | How measured                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Rendered DOM nodes at 5,000 rows loaded         | Baseline never reached 5k (24 cards). ~36k card nodes if every row mounted | **72 cards / 517 nodes** in the scroller at 5,100 loaded (551 in `document.body`) | `querySelectorAll` after scrolling until the summary read `5100 of 12,400`       |
| Cards re-rendered when toggling one selection   | Every mounted card                                                         | **1 card** (2 function calls in StrictMode)                                       | Reset `__mvCardRenders`, dispatch `change` on one checkbox, read the counter     |
| Longest task during sustained scroll            | Not measured (no windowing)                                                | **33ms** max frame; **0 frames > 50ms** over 304 frames                           | `requestAnimationFrame` deltas while scrolling ~12k px after 5k rows were loaded |
| Requests fired while typing a 6-character query | 6 (one per key)                                                            | **1**                                                                             | Network log while typing `camera` at 60ms/key; 300ms debounce                    |
| Production bundle, gzipped                      | **48 kB**                                                                  | **58.9 kB** JS (`index-Ow1vJ0uT.js`) + 1.4 kB CSS                                 | `npm run build` (Vite gzip report)                                               |

What was the actual bottleneck, and how did you find it?

The first-page-only list hid it. Once cursor pagination was on, the cost was **mounting every card**, not fetching. Virtualizing rows dropped DOM from thousands to ~72. A first measurement looked like every card re-rendered on select — that was Playwright `locator.click()` scrolling the card into view and shifting the window. Dispatching `change` in place showed memo working. Jump-to-end loading produced a 180ms frame (append + layout); after the 5k were in memory, sustained scroll stayed under 50ms. The +11 kB gzip is `@tanstack/react-virtual` plus the extra list UI.

---

## Accessibility

- Keyboard model you implemented, in one paragraph.
- How you tested it, including any screen reader.
- Known gaps.

---

## Interface decisions

Three or four sentences: what you were optimising for, and the decisions that
follow from it. Then briefly:

- **Visual system.** Your colour, spacing and type decisions, and where they live.
- **Status treatment.** How the four statuses read as a progression, and how they
  stay distinguishable without relying on colour.
- **States.** What you did with loading, empty, error, offline and partial
  failure.
- **Contrast.** What you checked against, and with what.
- **Copy.** Any user-facing message you rewrote and why.

Screenshots in the repo are welcome — link them here.

---

## Trade-offs and cuts

What you deliberately did not do, and what you would do with another day.

## Critique of the API

What you would change about the backend contract, and what it forced you to do in
the client that you would rather not have.

## Anything you would like us to look at

Code you are proud of, or a decision you are unsure about and want to discuss.
