# Review: review-kanban-board-4b9d

Branch: `cursor/kanban-board-view-b107` vs `master`
Scope: full branch diff (kanban board view: `lib/domain/lifecycle.ts`, `lib/store/selectors.ts`, `lib/utils/view-toggle.ts`, `components/app-shell/view-switch.tsx`, `keyboard.tsx`, `command-palette.tsx`, `page-shell.tsx`, `top-bar.tsx`, `app-frame.tsx`, `components/tasks/task-board.tsx`, `board-card.tsx`, `task-detail-sheet.tsx`, `app/(app)/board/page.tsx`, `middleware.ts`, `tests/e2e/board.spec.ts`).

## Run 1 — 2026-07-22 04:05 UTC

Verification performed: full-file reads of every changed file plus load-bearing context (`store.ts`, `sync.ts`, `run-triage.ts`, `apply-triage.ts`, `triage-merge.ts`, `task-list.tsx`, `task-row.tsx`, `task-view.tsx`, `sheet.tsx`, `app-frame.tsx`, `globals.css`, `middleware.ts`, `playwright.config.ts`). Caller reports biome/tsc/vitest/build clean and e2e passing; not re-run here.

Traced and intentionally NOT flagged:

- **Drag vs. triage race.** `applyTriageToTask` reads the task row *after* the LLM resolves and updates an explicit field list that excludes `lifecycle`; `mergeTriageIntoTask` never touches `lifecycle`; client adoption is dirty-guarded (`isTaskDirty`), and a board drag marks the task dirty for ≥400 ms + RTT. The residual adopt-stale-row window (PATCH clears dirty during the triage response's network transit) is milliseconds-narrow, self-heals on the next pull, and pre-exists on master via the detail-sheet lifecycle picker and `TaskRow.onComplete`. Not introduced or materially widened by this diff.
- **Drag during pull/reconcile.** `updateTask` marks dirty; reconcile keeps dirty-local; `pullInFlight` suppresses premature `clearDirty`. Standard path, already hardened (see review-sync-demo-45c2-b7e2).
- **completedAt semantics.** Store sets `completedAt` on entering done and clears it on leaving; board's done sort (`completedAt ?? updatedAt` desc) and the early-return on same-column drops are correct.
- **Sort parity.** Board columns match the list selectors exactly (inbox `createdAt` desc = `selectInboxTasks`; active focusScore asc = `selectFocusTasks` order; waiting/someday `updatedAt` desc = `selectByLifecycle`; done has no list counterpart).
- **`v` shortcut safety.** `keyboard.tsx` returns early on meta/ctrl/alt before the letter branches (no Cmd+V paste hijack); editable targets and `[role="dialog"]` are excluded. Shift+V yields `"V"` and is ignored.
- **BoardShell height math.** TopBar is sticky `h-14`; `main` has `pb-[80px] md:pb-0`; the two calc variants are exact. `dvh` handles mobile toolbars.
- **Sheet-close refocus ordering.** The Sheet has no exit animation, so Radix unmounts and restores focus synchronously when `open` flips false; the board's `requestAnimationFrame` focus lands after it. Deleted-task and beyond-preview cases are guarded (`cardNodes.get` miss → no-op).
- **`useSearchParams` suspension.** `AppFrame` wraps `{children}` in `React.Suspense`, so `TaskBoard`'s `useSearchParams` is inside a boundary; `pnpm build` clean confirms.
- **Middleware.** `/board` uses the exact-or-`/`-suffix prefix match; matcher covers it.
- **Empty state.** The fully-empty board renders the actionable capture empty state (allowed exception); empty columns are silent.

### 1. "Show all N" button is keyboard-broken and an invalid listbox child — Enter opens the wrong task's sheet
**File:** `components/tasks/task-board.tsx` L243-L316 (onBoardKeyDown), L373-L384 (footer), L503-L524 (listbox)
**What's wrong:** The footer Button renders inside the `role="listbox"` div (listbox children must be options — ARIA violation), and `onBoardKeyDown` sits on the group container above it. Tabbing to the button (the only other tab stop in the board) keeps `focusedId` pointing at the previously focused card, so Enter/Space hits `case "Enter" → e.preventDefault() → openCard(focusedId)`: the button's native activation is cancelled and the *last-focused card's detail sheet opens instead of expanding Done*. `[`/`]` on the button likewise move the remembered card. `focusedId` is always non-null by the time the button is reachable (Tab passes through a card, whose `onFocus` sets it), so this is the deterministic keyboard behavior, not an edge case.
**Fix:** Two structural changes so the mistake can't recur: (a) render `{footer}` after the `role="listbox"` div (still inside the `<section>`), restoring valid ARIA; (b) guard the key handler by event target, not remembered state — at the top of `onBoardKeyDown`, return unless `e.target` is a board card (`closest('[data-task-id]')`) or the group container itself. Keys then act on the thing that actually has focus. Consider also moving focus to the first newly revealed card after expansion, since the button unmounts (`hiddenDone` → 0) and would otherwise drop focus to body.

### 2. Board keyboard nav is dead on arrival — no initial focus, unlike every list view
**File:** `components/tasks/task-board.tsx` (no mount-focus effect); compare `components/tasks/task-list.tsx` L33-L37
**What's wrong:** `TaskList` focuses its listbox container on first render (`didInitialFocus`) so j/k/Enter work the moment a list page opens. The board's key handler is a React `onKeyDown` on a non-focusable group div, and nothing inside the board is focused on entry — so after `v` (or clicking "Board view"), j/k/arrows/`[`/`]`/Enter all do nothing until the user Tabs through the top bar or clicks a card. The board's own e2e test works around this with an explicit `await card.focus()`. For a keyboard-forward app whose sibling views hand focus over automatically, this breaks the `v → j → ] → Enter` flow the feature is designed for.
**Fix:** Mirror the list convention: give the group container `tabIndex={-1}` and focus it once on mount when the board has cards (a `didInitialFocus` ref, `preventScroll: true`). The existing `!pos → focusTask(firstTask())` fallbacks in `vertical`/`horizontal` already make the first keypress land on the first card, and the container's `focus:outline-none` keeps it visually silent — exactly the `TaskList` behavior. (Compose with finding 1's target guard by allowing `e.target === e.currentTarget`.)

### 3. Completing a pointer drag strands DOM focus on `<body>`, breaking the bracket-key contract the card itself documents
**File:** `components/tasks/task-board.tsx` L200-L210 (`onDragEnd` → `moveTask(..., { refocus: false })`); `components/tasks/board-card.tsx` L55-L61
**What's wrong:** `BoardCard.onMouseDown` deliberately takes focus "so … the [ ] keys keep working." But a successful drop remounts the card in its new column; the focused DOM node is removed and focus falls to `<body>`, so the very next `[`/`]` (or j/k) does nothing and Tab restarts from the top of the page. The one interaction the board is built around ends in the state the mousedown handler was written to prevent. Keyboard moves already solve this via `pendingFocusId`; pointer drops opt out.
**Fix:** Pass `{ refocus: true }` from `onDragEnd` too. The `pendingFocusId` effect uses `preventScroll` and `scrollIntoView({ block: "nearest" })`, and pointer-origin programmatic focus doesn't trigger `:focus-visible`, so there's no visual noise — the card just remains the active element, matching Linear.

### 4. Done-column cards shout "overdue" in rose — on completed work
**File:** `components/tasks/board-card.tsx` L90-L95, L120-L124
**What's wrong:** `dueTone` is computed from `isOverdue`/`isToday` regardless of `isDone`, and the board's Done column is the first surface in the app that persistently renders done tasks (list selectors all filter them out; a row completed in a list disappears immediately). Any completed task whose due date has passed — the common case for finished work — shows a rose "5 days ago" badge, and one due today shows ember. Thirty of these in the Done preview reads as a column of alarms on tasks that need nothing, contradicting both the semantics (nothing is overdue once done) and the calm-UI bar. The card already special-cases done for title strike-through and hides `nextAction`.
**Fix:** In `BoardCardContent`, force `dueTone` to `"neutral"` when `isDone` (or drop the due badge on done cards entirely, matching the `nextAction` treatment). The overlay preview shares the component, so one change covers both.

### 5. Pointer drops are announced twice to screen readers
**File:** `components/tasks/task-board.tsx` L170-L181 (`moveTask` announcement), L217-L241 (dnd-kit `announcements.onDragEnd`)
**What's wrong:** A pointer drop that changes columns speaks twice back-to-back: dnd-kit's live region says "'X' dropped into Active." and the custom region immediately says "Moved 'X' to Active." — same information, doubled chatter on the board's primary action. (Bracket moves announce once, correctly, since dnd-kit isn't involved.)
**Fix:** Announce in `moveTask` only for keyboard moves — make the option explicit (`{ source: "keyboard" | "pointer" }` or an `announce` flag alongside `refocus`) and skip `setAnnouncement` for pointer drops, letting dnd-kit's announcement be the single voice for drags. (Keeps working if finding 3 flips `refocus` to true for drops.)

### 6. Bracket moves are unreachable on keyboard layouts where `[` requires AltGr/Option
**File:** `components/tasks/task-board.tsx` L245 (`if (e.metaKey || e.ctrlKey || e.altKey) return`)
**What's wrong:** On German, French, Spanish, and most non-US layouts, typing `[` produces `e.key === "["` with `altKey` set (macOS Option) or `ctrlKey`+`altKey` set (Windows AltGr). The blanket modifier early-return eats those events, so the advertised "press [ ]" gesture — printed in the board's own page description — is a silent no-op for those users, with no pointer-free way to move a card.
**Fix:** Handle the `"["`/`"]"` cases before the modifier guard, rejecting only `e.metaKey` (protects Safari's Cmd+[ history navigation; there is no native ctrl/alt+bracket browser action to steal). Keep the broad guard for letters and arrows, where Alt+Arrow is a real browser shortcut.

### 7. Command palette advertises `V` on a command whose shortcut is a no-op where the palette works
**File:** `components/app-shell/command-palette.tsx` L98-L105; `components/app-shell/view-switch.tsx` L45-L48
**What's wrong:** "Go to Board" runs `setView("board")` from any route (works on /memory, /settings). Its `hint: "V"` follows the palette convention that hints are global shortcuts (like `C` for capture) — but `toggleView` no-ops when `current` is null, so pressing `v` on /memory or /settings does nothing. The palette teaches a shortcut that fails exactly where the user just used the palette entry.
**Fix:** Either drop the hint (v is a layout *toggle*, not a global go-to-board key), or make the gesture match the promise: in `toggleView`, fall back to `setView("board")` when `current` is null so `v` means "to the board" from anywhere and "back to your list" from the board. The second reads better for a keyboard-forward app; pick one and make hint and behavior agree.

Found 7 issues.
