# Review: review-kanban-board-e5d5

Scope: full branch diff `master...HEAD` on `cursor/kanban-board-view-e5d5` — Kanban board route (`/board`), drag-to-change-status (`task-board` / `board-column` / `board-card`), Today↔Board `ViewToggle`, shared `task-meta` + `displayedAssigneeName`, shell wiring (sidebar, command palette, keyboard, page-shell `wide`, layout CSS vars), middleware gate + test, `@dnd-kit/core` dependency, README shortcuts.

Checks at review time (after fixes): `pnpm biome check --write` on touched files clean; `pnpm tsc --noEmit` clean; `pnpm test` 72/72 pass.

## Run 1 — 2026-07-22T10:31Z

Findings ordered by importance (no severity labels).

### 1. Roving focus desyncs after a cross-column drop
**File:** `components/tasks/task-board.tsx` L326-L335 (pre-fix)
**What's wrong:** `focus` is a `{ status, index }` pair that drives which card gets `tabIndex={0}` and where arrow/j/k navigation walks. `onDragEnd` updates lifecycle but never re-homes that pair. After moving the focused card out of a column, React moves the same DOM node (key=`task.id`) into the destination while `focus` still points at the old slot — so `tabIndex={0}` lands on a different card, and `onBoardKeyDown` keeps navigating the source column even though DOM focus is on the moved card. Keyboard users lose the board's single-tab-stop contract the moment they complete the primary gesture.
**Fix:** After a successful `updateTask`, resolve the card's index in `COLUMN_SELECTORS[to](useStore.getState().tasks)` and `setFocus({ status: to, index })`.

### 2. KeyboardSensor smooth-scrolls under `prefers-reduced-motion`
**File:** `components/tasks/task-board.tsx` L310-L318 (pre-fix)
**What's wrong:** Drop animation correctly nulls out when `usePrefersReducedMotion()` is true, and globals.css zeroes CSS transitions/animations. Keyboard column hops still use dnd-kit's default `scrollBehavior: "smooth"` for `scrollTo`/`scrollBy` on overflow ancestors — a JS scroll that the CSS media query never touches. Reduced-motion users get animated horizontal board scrolling during the documented ←/→ drag path.
**Fix:** Pass `scrollBehavior: reducedMotion ? "instant" : "smooth"` into `useSensor(KeyboardSensor, …)`.

### 3. Board never auto-focuses a card, unlike every list view
**File:** `components/tasks/task-board.tsx` (missing effect); compare `components/tasks/task-list.tsx` L48-L52
**What's wrong:** `TaskList` focuses its listbox once tasks exist so j/k work immediately. The board requires an explicit Tab into the roving card before any of the README-documented ←/→/j/k shortcuts fire (`onBoardKeyDown` bails unless `event.target` is inside `[data-task-id]`). On a keyboard-forward app that just added Board shortcuts to the README, landing on `/board` from the sidebar/palette leaves those shortcuts dead until the user Tabs through the top bar.
**Fix:** After hydration, once `focusTarget` resolves, `focus({ preventScroll: true })` the corresponding card (same one-shot ref pattern as `TaskList`).

### 4. Cards have no grab cursor — drag affordance is copy-only
**File:** `components/tasks/board-card.tsx` L68-L71 (pre-fix)
**What's wrong:** The whole card is the drag handle by design, but resting cards use the default cursor; only the overlay gets `cursor-grabbing` while lifted. The page description is the sole feedforward that cards are draggable. That fails the Act stage of B.I.A.S. for pointer users scanning a dense board (Fitts + affordance): the interaction model is invisible until the first accidental 4px activation.
**Fix:** Add `cursor-grab active:cursor-grabbing` on the draggable card root.

### 5. Direct `@dnd-kit/utilities` dependency is unused
**File:** `package.json` L26-L27 (pre-fix)
**What's wrong:** `@dnd-kit/utilities` is declared alongside `@dnd-kit/core` but nothing in the branch imports it. It already arrives transitively via `@dnd-kit/core`. The direct pin is dead weight that will drift independently in the lockfile.
**Fix:** Remove the direct dependency and refresh the lockfile.

Verified non-issues (investigated, no action):
- Middleware gates `/board` (and `/board/*`); test covers the unauthenticated redirect with `next=%2Fboard`.
- Click-after-drag open is guarded (`draggingRef` + 250ms `dragEndedAt`); KeyboardSensor `handleEnd` `preventDefault`s Enter/Space so the card's Enter→open path does not race a drop.
- `GlobalKeyboard` suppresses capture/palette while `aria-pressed="true"` on a dnd-kit draggable — verified against `@dnd-kit/core@6.3.1` attribute wiring.
- Dropped status intentionally omitted via `STATUS_VIEWS` (same as sidebar); `COLUMN_SELECTORS.dropped` exists only for `Record<Lifecycle, …>` exhaustiveness.
- Board columns reuse list selectors (`selectInboxTasks` / `selectFocusTasks` / `selectDoneTasks` / `selectByLifecycle`) — ordering cannot drift from list views.
- `displayedAssigneeName` + `task-meta` correctly collapse the prior row/card duplication; detail sheet still uses the richer delegation meta helpers on purpose.
- CSS `.board-card-lifted` is covered by the global `prefers-reduced-motion` duration kill switch; WAAPI drop settle is the one that needed the JS null-out (already present).
- Mobile reachability: Board is available via Today’s `ViewToggle` and the command palette (palette trigger is phone-visible from prior work); bottom-nav omission matches Waiting/Someday/Done.
- `PageShell wide` + negative-margin scroller math matches the five-column 1440px comment; main `pb` + board height calc do not double-subtract bottom-nav space.
- `closestCorners` accepts the filtered `DroppableContainer[]` candidates array (iterates with `for…of`, same shape DndContext passes from `getEnabled()`).

### Fixes applied on branch
1–5 addressed in this run: focus re-home on drop, KeyboardSensor `scrollBehavior`, board initial focus, grab cursor, drop unused `@dnd-kit/utilities`.
