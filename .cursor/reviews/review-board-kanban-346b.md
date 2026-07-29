# Review: review-board-kanban-346b

## Run 1 — 2026-07-29T19:17:01Z

Branch: `cursor/board-view-kanban-cb8b` vs `master`

Context: Board (Kanban) view — Notion PRD, Figma, plan at `/opt/cursor/artifacts/plans/board_view_kanban_f9f2c210.plan.md`. Decisions 1–7 accepted (do not re-litigate). Quality gate already green.

### Long-press Move-to also opens the detail sheet
**Severity:** important
**File:** `components/tasks/board/board-card.tsx` L108–L136, L105
**What's wrong:** When the long-press timer fires it opens the Move-to sheet, but nothing suppresses the synthetic `click` that mobile browsers dispatch on `touchend`. That click still runs `onOpen?.(task.id)` and opens the detail sheet on top of (or racing with) Move-to.
**Fix:** Set a `suppressClickRef` when the long-press callback fires; in `onClick`, if the flag is set, clear it and return without opening. Clear the flag on a short timeout as a safety net. Architecture: make “long-press consumed this gesture” a single flag owned by the card so future handlers can’t forget.

### Body keyboard router dies when the selected task leaves the board
**Severity:** important
**File:** `components/tasks/board/board-view.tsx` L249–L264, L271–L276
**What's wrong:** `tabStopId` correctly falls back when `selectedId` is no longer in any column (e.g. Dropped via the detail Status picker, or deleted). The body keydown router still keys off raw `selectedId`: it finds the dropped task in the store, `onCardKeyDown` returns early (`colIndex === -1`), and j/k/⇧→/Enter do nothing while a tab stop exists on another card with no selection ring.
**Fix:** When computing `tabStopId`, if `selectedId` is absent from columns, also `setSelectedId(null)` (or sync selection to `tabStopId`). Body routing should resolve the task only among column tasks (same set as `tabStopId`), never a lifecycle outside `STATUS_VIEWS`. Make “selection ⊆ visible board cards” an invariant enforced in one place.

### Space opens from a focused card but not after detail → Escape
**Severity:** important
**File:** `components/tasks/board/board-view.tsx` L54, L237–L239, L249–L254
**What's wrong:** `onCardKeyDown` treats `Enter` and ` ` as open, but `BOARD_KEYS` omits `" "`. After the detail sheet closes, focus is on `<body>` and Space is ignored while Enter still works — the escape-recovery path is incomplete for a key the board itself claims.
**Fix:** Add `" "` to `BOARD_KEYS` (or derive the allowlist from the same branches as `onCardKeyDown` so the two can’t drift).

### Remembered Board preference flashes List on cold load
**Severity:** important
**File:** `lib/store/view-mode.ts` L41–L50; consumers in `app/(app)/*/page.tsx`
**What's wrong:** `stored` starts as `null` and is read in `useEffect`, so `mode` is `"list"` for the first client paint whenever the URL has no `?view=`. Returning users with `localStorage` = board see List (narrow shell + list skeleton/content) then flip to Board (wide shell). Theme avoids FOUC with an inline boot script; view mode does not.
**Fix:** Treat “storage not read yet” as a distinct state and keep the page on a neutral skeleton (or withhold List/Board) until `readStored` runs; and/or on mount, if stored is board and the param is missing, `replace` `?view=board` before painting content. Prefer not rendering the wrong mode at all — correctness by not having a “default list then correct” frame.

### Undo window timer resets when “Saved locally” flips
**Severity:** nit
**File:** `components/tasks/board/board-view.tsx` L150–L158, L132–L135
**What's wrong:** The 6s expiry effect depends on the whole `undo` object. When `savedLocally` becomes true, the effect re-runs and starts a fresh 6s window, so a late sync failure can extend Undo well past the intended offer.
**Fix:** Key the timer on `undo.seq` only (store `seq` in a ref / depend on `undo?.seq`), and update `savedLocally` without resetting expiry. Expiry should be “6s from the move,” not “6s from the last undo-state change.”

### List ↔ Board toggle drops selection (PRD soft criterion)
**Severity:** nit
**File:** `components/tasks/task-view.tsx` L71–L84; `components/tasks/board/board-view.tsx` L80; `components/tasks/task-list.tsx` L37
**What's wrong:** PRD acceptance: “Toggling List/Board preserves selection where sensible.” Board `selectedId` and list `activeIndex` are isolated; remounting on mode change clears both.
**Fix:** Lift a shared `selectedTaskId` (URL `?task=` already exists for the open sheet — a lighter option is to seed Board/List selection from the last focused task id held on `TaskView` across mode changes). Only preserve when that id is still visible in the target mode.

---

**Out of scope / not re-raised:** five columns always; dropped omitted; no rollback on failed sync; search UI unwired; mobile long-press not touch-drag; `@dnd-kit/core` only; explicit `completedAt` on the wire. `completedAt` client/store/pg/memory/sync path looks consistent with Undo.
