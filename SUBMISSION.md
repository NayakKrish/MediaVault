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
| 1   | Bulk update sends every selected id in one request; API rejects >50 (`400 too_many_ids`)                                                                                          | `App.tsx` `applyBulkStatus`        | knowingly left              |
| 2   | Search/filter race: in-flight `listAssets` is never aborted or sequenced, so a slow earlier response can overwrite a newer query                                                  | `useAssets.ts`                     | fixed                       |
| 3   | Every keystroke fires a list request (no debounce/throttle) → burns the 80/10s rate limit and amplifies flakiness                                                                 | `App.tsx` → `useAssets`            | fixed                       |
| 4   | Empty / loading / error are conflated: with `items=[]`, the grid always shows “Nothing matches…”, including on initial load and after a failed fetch (error banner + false empty) | `AssetGrid.tsx`, `App.tsx`         | fixed                       |
| 5   | `nextCursor` is stored but never used — only the first page (~24) of up to 12.4k assets is reachable                                                                              | `useAssets.ts`, `App.tsx`          | knowingly left              |
| 6   | Grid mounts every asset it is given (no windowing); DOM/memory grow with scroll depth once pagination exists                                                                      | `AssetGrid.tsx`                    | knowingly left              |
| 7   | Any selection toggle re-renders every card (`selectedIds` Set + unmemoized list)                                                                                                  | `AssetGrid.tsx`                    | knowingly left              |
| 8   | Cards are mouse-only `<div onClick>` — not focusable, no arrow/Enter/Space model, checkboxes have no accessible name tied to the asset                                            | `AssetGrid.tsx`                    | knowingly left              |
| 9   | Thumbnails always requested; `hasThumbnail === false` yields a broken `<img>` (no placeholder, layout risk)                                                                       | `AssetGrid.tsx`, `AssetDetail.tsx` | knowingly left              |
| 10  | Detail `PATCH` success never updates the list (`handleSaved` is a no-op); bulk success also leaves stale status pills and clears selection even when `failed > 0`                 | `App.tsx`                          | knowingly left              |
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

_(Task 2)_

**Optimistic updates and rollback**

_(Task 3)_

**Retry and backoff policy**

_(Task 4 — client still has no retries.)_

**State placement and URL sync**

`q`, `status`, `kind`, `tag`, `sort` are the source of truth in the URL via `history.replaceState` (no history entry per keystroke). Search/tag inputs are local and commit after **300ms** debounce — coalesces typing under the 80/10s rate limit without feeling sticky. Cursor stays in React state only and is cleared whenever the filter identity changes, so a `stale_cursor` from a reused cursor cannot reach the UI.

---

## Performance

Fill in real measurements, not estimates. Say which machine and browser.

| Metric                                          | Before | After | How measured |
| ----------------------------------------------- | ------ | ----- | ------------ |
| Rendered DOM nodes at 5,000 rows loaded         |        |       |              |
| Cards re-rendered when toggling one selection   |        |       |              |
| Longest task during sustained scroll            |        |       |              |
| Requests fired while typing a 6-character query |        |       |              |
| Production bundle, gzipped                      |        |       |              |

What was the actual bottleneck, and how did you find it?

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
