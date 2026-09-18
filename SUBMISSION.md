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
| 8   | Cards are mouse-only `<div onClick>` — not focusable, no arrow/Enter/Space model, checkboxes have no accessible name tied to the asset                                            | `AssetGrid.tsx`                    | fixed                       |
| 9   | Thumbnails always requested; `hasThumbnail === false` yields a broken `<img>` (no placeholder, layout risk)                                                                       | `AssetGrid.tsx`, `AssetDetail.tsx` | fixed                       |
| 10  | Detail `PATCH` success never updates the list (`handleSaved` is a no-op); bulk success also leaves stale status pills and clears selection even when `failed > 0`                 | `App.tsx`                          | fixed                       |
| 11  | Client has no retries, ignores `Retry-After`, and collapses errors to a string — callers cannot tell 503/429 (retry) from 409/422 (don’t)                                         | `api/client.ts`                    | fixed                       |
| 12  | Detail panel: opening/closing does not move or restore focus; Escape does not close; rapid id changes race the same way as the list                                               | `AssetDetail.tsx`                  | fixed                       |

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

Max **4** attempts (1 initial + 3 retries). Delay is `max(Retry-After, min(8000, 300 * 2^attempt + random(0..300)))` ms. `Retry-After` is honoured as delta-seconds or an HTTP-date (`retry-after` header). Retry only on structural `ApiError.status` in `{429, 503, 500}` or a network `TypeError`; never on `400`, `409`, `422`, `AbortError`, or offline. Offline is fail-fast (no retry loop, no write queue) — a banner pauses updates and `retry()` runs once on reconnect. GET dedupe shares the full retry chain so identical in-flight lists are one storm, not N. UI copy goes through `userMessage`, never raw `429: Too many requests…`. An `ErrorBoundary` wraps the app shell.

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

The grid is a `role="grid"` with one roving `tabIndex={0}` cell (checkboxes are `tabIndex={-1}` so they are not extra stops). Arrow keys move in two dimensions from the current column count; Enter opens; Space toggles; Shift+arrows move and extend the same contiguous range as Shift+click. Opening the detail panel (`role="dialog"`) focuses Close; Escape or Close returns focus to the opened card, or to the grid if that id was filtered out. Result counts, bulk outcomes, and the offline banner use polite live regions; load/error use `role="alert"`. Search is debounced so the count does not announce per keystroke.

Tested from the keyboard in Chromium (Tab into the grid, arrows, Space, Shift+arrows, Enter, Escape, Tab out of the dialog). I did not run a screen reader.

Known gaps: the dialog is not a focus trap (Tab can leave — required). Off-screen virtualized cells are not in the accessibility tree until scrolled into view. I did not add Home/End/PageUp.

---

## Interface decisions

Optimising for all-day scanning in a hostile API: the grid has to stay quiet so name, status, and selection pop without chrome competing. A cool slate page wash with elevated white bars, one blue accent, and IBM Plex Sans (400/500/600) replace the wireframe system-ui stack. Spacing and radius live as `--space-*` / `--radius-*` on `:root` in `src/styles.css` — no one-off pixel soup. Initial load and detail fetch use skeleton cards (shimmer off under `prefers-reduced-motion`) so the layout doesn’t flash empty.

- **Visual system.** Surfaces `--bg` / `--bg-soft` / `--bg-elevated`; ink `--ink` / `--ink-soft` / `--ink-muted`; accent `#1D4ED8` + `--accent-soft` for selection. Applied across topbar, filter chips, bulk strip, cards, and the detail sheet.
- **Status treatment.** Draft (slate, round mark) → In review (amber, square mark) → Approved (green, check) → Archived (dashed, dash mark). The label is always visible; the mark is a second, non-colour channel.
- **States.** Loading: 12-card skeleton + sr-only “Loading assets…”. Empty/error: titled panel + next action. Offline: warn banner. Partial bulk: warn/ok notice with Retry / Undo. Load-more stays a footer line, not a second skeleton.
- **Contrast.** WCAG 2 relative-luminance (same formula as WebAIM). Body ink on white **15.8:1**, on slate wash **14.3:1**; `--ink-soft` **8.4 / 7.6**; muted meta **5.4 / 4.9**; white on accent **6.7**; pill text: draft **8.8**, in review **7.3**, approved **7.5**, archived **9.5**. All ≥ 4.5:1.
- **Copy.** API strings stay behind `userMessage` (e.g. 429 → “The server is busy…”). Empty/error titles drop the trailing period and say what to do next.

---

## Trade-offs and cuts

Offline writes are detected and surfaced, not queued. A write queue would need durable storage, conflict replay against `version`, and a way to drop `legal_hold` / `400` without surprising the user — too much machinery for a session that already fails fast and retries the list on reconnect.

## Critique of the API

What you would change about the backend contract, and what it forced you to do in
the client that you would rather not have.

## Anything you would like us to look at

Code you are proud of, or a decision you are unsure about and want to discuss.
