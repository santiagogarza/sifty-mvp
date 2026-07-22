# Review: review-kanban-board-f2eb

## Run 1 — 2026-07-22 01:40 UTC

Scoped review of kanban board view on `cursor/kanban-board-view-f2eb`.

Files reviewed:
- `lib/domain/lifecycle.ts`
- `lib/store/store.ts`
- `components/tasks/view-mode-toggle.tsx`
- `components/tasks/task-board.tsx`
- `components/tasks/task-board-card.tsx`
- `components/tasks/task-view.tsx`
- `components/app-shell/page-shell.tsx`
- `components/tasks/task-detail-sheet.tsx`

Context: list/board preference, pointer DnD across lifecycle columns, keyboard left/right status moves, hydration-safe wiring, `setLifecycle` → `updateTask` → `notifyTask` sync path.

### Drag end swallows the next card click
**File:** `components/tasks/task-board.tsx` L158–L181, L314–L319; `components/tasks/task-board-card.tsx` L57–L60
**What's wrong:** Crossing `DRAG_THRESHOLD_PX` sets `suppressClickRef.current = true`, but the card's `onClick` bails on the React `dragging` prop before calling `onOpen`, so the suppress flag is never cleared. After a drag, `pointerup` → `setDrag(null)` is batched; the following `click` still sees stale `dragging === true` and returns early. The *next* real click hits `suppressClickRef` and is discarded. Same leak on `pointercancel` / touch drags where `click` never fires.
**Fix:** Drive click suppression from a ref consulted in the click path (not React `dragging` state). Set the suppress flag in `endDrag` when `session.active`, clear it in that click handler *and* via `queueMicrotask`/`setTimeout(0)` fallback so a missing click cannot stick. Do not leave clearing solely on `onOpen`.

### Keyboard left/right drops focus after status change
**File:** `components/tasks/task-board.tsx` L234–L238
**What's wrong:** `ArrowLeft`/`ArrowRight` call `setLifecycle` but do not refocus the card. Moving columns unmounts the card from one parent and mounts it in another (keys are per-column), so DOM focus is lost. `activeTaskId` stays set (roving `tabIndex={0}`), but further arrow/j/k handling requires a focused card — the advertised keyboard path breaks after one move.
**Fix:** After a successful adjacent move, refocus the same `task.id` post-commit (e.g. `focusTask` in `requestAnimationFrame` / `useEffect` keyed on lifecycle+activeTaskId). Structure it so focus restoration is the default after any board-driven lifecycle change, not an optional follow-up.

### View toggle is interactive before rehydration
**File:** `components/tasks/task-view.tsx` L50–L65; `components/tasks/view-mode-toggle.tsx` L22–L46
**What's wrong:** While `!hydrated`, the header still renders `ViewModeToggle` against the default `"list"`. Users with a persisted `"board"` preference see List pressed, then it flips. Clicks during that window can also race zustand rehydrate and be overwritten by the persisted value.
**Fix:** Disable or omit the toggle until `hydrated` is true (same gate as choosing list vs board content). Optionally show a neutral/skeleton control so the pressed state never lies.

### Header title flashes list chrome then “Board”
**File:** `components/tasks/task-view.tsx` L59–L65, L68–L76
**What's wrong:** The `!hydrated` branch renders the route list title/description (`Inbox`, `Today`, …). After rehydrate with `tasksViewMode === "board"`, the header jumps to title `"Board"` and a different description. Combined with `PageShell` widening only after hydrate, board-preference reloads flash narrow list chrome then wide board.
**Fix:** Until hydrated, keep the header mode-agnostic (generic title/actions only, or defer title until hydrate). Align `PageShell` wide gating with the same moment the board chrome appears so width and title switch together without a list-shaped intermediate.

### `touch-none` on every card blocks scroll gestures
**File:** `components/tasks/task-board-card.tsx` L64
**What's wrong:** `touch-none` on the whole card prevents the browser from using touch starts on cards for horizontal board panning or vertical page scroll. On a dense board, almost every touch starts on a card, so scrolling becomes unreliable unless the user hits column chrome.
**Fix:** Keep `touch-none` only after the drag threshold activates (toggle a class/style from the drag session), or limit it to a dedicated drag handle. Default card surface should allow native scrolling until a drag is claimed.

### Board listbox lacks container-level keyboard navigation
**File:** `components/tasks/task-board.tsx` L254–L265, L228–L248
**What's wrong:** `TaskList` focuses the listbox and handles j/k/arrows on the container. `TaskBoard` marks the listbox `tabIndex={0}` but attaches no `onKeyDown` there and never auto-focuses it. j/k/arrows only work after tabbing into a card, which is a keyboard regression vs list mode on the same routes.
**Fix:** Mirror `TaskList`: initial focus on the board container, container `onKeyDown` that moves `activeTaskId` / calls `focusTask`, and keep card handlers as the focused-option path. Ensure selection changes always move DOM focus.

### Invalid listbox/option tree (a11y)
**File:** `components/tasks/task-board.tsx` L256–L327; `components/tasks/task-board-card.tsx` L53
**What's wrong:** `role="listbox"` wraps `<section>` columns; `role="option"` cards are not direct listbox children. That breaks the expected listbox/option accessibility tree and makes `aria-selected` / keyboard listbox semantics unreliable for AT.
**Fix:** Either (a) use non-listbox landmarks (`role="region"` per column + focusable cards with explicit keyboard docs), or (b) keep listbox but ensure options are owned correctly (e.g. `aria-owns` / flat option structure). Prefer matching whatever pattern AT already gets from `TaskList`, without intermediate section roles between listbox and options.

### `transition-all` on board complete control
**File:** `components/tasks/task-board-card.tsx` L83
**What's wrong:** Uses `transition-all`, which violates project convention (explicit property lists only) and can animate unintended properties during drag-related style changes.
**Fix:** Replace with an explicit list (e.g. `transition-[background,border-color]`), consistent with the card container.

---

**setLifecycle sync:** Drag and keyboard paths call `setLifecycle` → `updateTask` → `notifyTask` / `syncHooks.taskUpserted`. No sync-path defect found; not listed as an issue.

Found 8 issues.
## Run 2 — 2026-07-22 01:46 UTC

Re-review of working-tree fixes on `cursor/kanban-board-view-f2eb` (uncommitted deltas on board/view files vs HEAD). Same scoped file list.

### Prior findings disposition

1. **Drag end swallows next click** — Resolved. `armClickSuppression` sets the ref on `wasActive`, clears on suppressed `openTask`, and `setTimeout(0)` fallback; card `onClick` always calls `onOpen` (no React `dragging` gate).
2. **Keyboard left/right drops focus** — Resolved for remount. `pendingRefocusRef` + effect calls `focusTask` after board-driven lifecycle moves only.
3. **View toggle before rehydration** — Resolved. `ViewModeToggle disabled={!hydrated}`; pressed state suppressed while disabled (`active = !disabled && …`).
4. **Header title flashes list chrome** — Resolved. Pre-hydrate header is mode-agnostic skeletons; `PageShell` wide gated on `hydrated && board`.
5. **`touch-none` on every card** — Resolved. Applied on board when `drag.active` and on the source card when `dragging` only.
6. **Board listbox lacks container keyboard** — Resolved via equivalent path: auto-focus first card on mount + card-level j/k/arrows/Enter/Space (no invalid listbox container).
7. **Invalid listbox/option tree** — Resolved. Columns use `role="list"` with `role="listitem"` cards; outer listbox removed.
8. **`transition-all` on complete control** — Resolved. Explicit `transition-[background,border-color]` (card/column transitions also explicit).

### Keyboard focus does not bring off-screen columns into view
**File:** `components/tasks/task-board.tsx` L129–L132, L141–L147, L295–L301
**What's wrong:** `focusTask` always uses `focus({ preventScroll: true })`. After ArrowLeft/Right remount refocus, and on j/k across `flatIds` (column-major), the focused card can sit in a horizontally off-screen snap column—especially on mobile—while `activeTaskId` updates. Sighted keyboard users lose the card; the route-highlight path already knows to `scrollIntoView` columns, but keyboard moves do not.
**Fix:** Keep `preventScroll: true` only for the initial mount focus (avoid page jump). For user-driven navigation and `pendingRefocusRef` restoration, `focus()` without preventScroll, or `scrollIntoView({ inline: "nearest", block: "nearest", behavior })` on the card/column after focus—same reduced-motion gate as `highlightColumn`.

Found 1 issue.
## Run 3 — 2026-07-22 01:53 UTC

Re-review after focus/scroll fix on `cursor/kanban-board-view-f2eb` (HEAD `2561516`). Same scoped file list. Manual computer-use confirmation noted for list↔board, drag between columns, detail sheet after drag, return to list.

### Prior findings disposition

1. **Drag end swallows next click** — Still resolved (`armClickSuppression` + click-path clear + timeout fallback).
2. **Keyboard left/right drops focus** — Still resolved (`pendingRefocusRef` → `focusTask` after remount).
3. **View toggle before rehydration** — Still resolved.
4. **Header title flashes list chrome** — Still resolved.
5. **`touch-none` on every card** — Still resolved (board when `drag.active`, source card when `dragging`).
6. **Board listbox lacks container keyboard** — Still resolved via mount focus + card-level nav.
7. **Invalid listbox/option tree** — Still resolved (`role="list"` / `listitem`).
8. **`transition-all` on board complete control** — Still resolved.
9. **Keyboard focus does not bring off-screen columns into view** — Resolved. `focusTask` defaults to `preventScroll: false` and `scrollIntoView({ inline: "nearest", block: "nearest" })` with the same reduced-motion gate as column highlight; initial mount still passes `{ preventScroll: true }`. j/k and remount refocus both use the scrolling path.

### Checklist spot-check

- Zustand consumed via selectors; view mode persisted locally (store v3 migrate).
- No `transition-all` in new board UI; explicit transition property lists.
- Icon-only controls labeled; complete control stops pointer propagation so drag does not steal the click.
- `setLifecycle` → `updateTask` → sync notify path unchanged and correct.

## Run 3 — No issues found.
