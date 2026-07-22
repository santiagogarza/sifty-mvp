# Review: review-kanban-board-3e7a

Scope: full branch diff `master...HEAD` on `cursor/kanban-board-view-c924` — Kanban board view (`/board` route, `TaskBoard`/`BoardColumn`/`BoardCard`, `ViewToggle`, `PageShell` `wide` prop, sidebar/palette entries, lift keyframes, `@dnd-kit/core` dependency).

Checks at review time: `pnpm biome check` clean, `pnpm tsc --noEmit` clean, `pnpm test` 71/71 pass.

Runtime verification performed with puppeteer against a seeded dev server (localStorage store seed, no auth): layout metrics at 1440×900 and 390×844, keyboard drag flows (Space/arrows/Enter/Esc), focus restoration, global-shortcut interplay mid-drag.

Verified non-issues (investigated, no action):

- **Space drop path is clean**: dnd-kit's activation guard (`activeRef.current !== null` in `bindActivatorToSensorInstantiator`) short-circuits re-activation mid-drag, and the document-level sensor listener handles the end key; the card's Enter branch never sees Space. Verified at runtime: Space→ArrowRight→Space moves the card, opens nothing.
- **Focus follows the card across columns after a keyboard drop**: dnd-kit's `RestoreFocus` looks the draggable up by id in the registry after re-render, so the remounted card in the new column receives DOM focus (verified: `document.activeElement` is the moved card in the Focus column). The keyboard-forward "selection has semantic backing" bar is met for the drag itself.
- **Residual click suppression works for pointer drags**: cross-column drops produce no card click at all (click fires on the common ancestor of mousedown/mouseup targets), and same-card micro-drag clicks land within the 250 ms window.
- **Drop animation side effects compose correctly**: script-generated WAAPI animations sort after CSS animations, so `card.animate` overrides the held `.board-card-lifted` state; the overlay unmounts after 220 ms so `fill: "forwards"` cannot leak; `defaultDropAnimationSideEffects` hides the remounted card while the overlay translates into its slot.
- **Reduced motion is covered at all three layers**: `dropAnimation={null}` skips the WAAPI side effects entirely, the global `prefers-reduced-motion` rule clamps the CSS lift, and the hook has no hydration mismatch (initial `false`, set in effect).
- **`updateTask(id, { lifecycle })` is the same mutation path as the Status picker**: `completedAt` is set on entry to done and cleared on exit; sync hooks fire; a drop on the source column or missing task id is a no-op.
- **Mobile layout math holds**: at 390×844 the document does not scroll, the card well ends 30 px above the bottom nav, and the 5 columns scroll horizontally. At 1440×900 there is no vertical document scroll.
- **`dropped` entry in `COLUMN_SELECTORS`** is unreachable today but is deliberate type-level exhaustiveness (a new `Lifecycle` member fails to compile without declaring a sort); documented in place.
- **`"use client"` on `app/(app)/board/page.tsx`** matches every existing page in the group; local `TooltipProvider` in `ViewToggle` matches the sidebar's existing pattern; the double h1 (TopBar + PageHeader) is the pre-existing pattern on every page.
- **Empty columns render an open well with no placeholder copy** and the count hides at zero — "empty states are silence" respected.

## Run 1 — 2026-07-22T09:30Z

Findings are ordered by importance (per review contract, no severity labels — each finding should be fixed or explicitly declined with reasoning).

### 1. Dropping a card with Enter also opens its detail sheet
**File:** `components/tasks/board-card.tsx` L49-L57; `components/tasks/task-board.tsx` L238-L242
**What's wrong:** `keyboardCodes.end` includes `Enter`, but the card's composed `onKeyDown` doesn't know a drag is active. React handlers attach at the root container while the KeyboardSensor's mid-drag listener attaches at `document`, so on Enter the card's handler runs first: the activator ignores Enter (not a start code, dnd-kit's activation guard returns before `preventDefault`), `e.defaultPrevented` is false, and `onOpen(task.id)` fires — then the document-level listener drops the card. Verified at runtime: Space→ArrowRight→Enter moves the card to Focus **and** opens the sheet (`?task=task_seed_1`). The comment "Enter stays free to open the task" is only true when idle. The same hole exists mid-mouse-drag (mousedown focuses the card, so Enter would open the sheet while dragging).
**Fix:** Centralize the "never open during a drag" invariant in `TaskBoard.openTask` rather than per-card: keep a `draggingRef` set in `onDragStart` and cleared in `onDragEnd`/`onDragCancel`, and early-return from `openTask` while it is true (alongside the existing 250 ms residual-click window). That makes the suppression correct by construction for every card and every input modality, instead of relying on each card handler to re-derive drag state.

### 2. Global `c` / `/` shortcuts fire while a card is held; arrows then drive the drag behind the modal
**File:** `components/app-shell/keyboard.tsx` L17-L43; `components/tasks/task-board.tsx` L103-L149
**What's wrong:** `GlobalKeyboard` only exempts editable targets. Mid-keyboard-drag, focus is on the held card (`role="button"`, not editable), so `c` opens the capture dialog on top of an active drag — verified at runtime. Worse, the drag stays live underneath: pressing ArrowRight while typing in the capture textarea both hops the held card to the next column (Focus column showed the `isOver` ring behind the dialog) and swallows the caret movement, because the coordinate getter `preventDefault`s all arrows at document level. Esc then races Radix's dismiss against the sensor's cancel. The user ends up editing a capture while an invisible drag consumes their arrow keys.
**Fix:** Teach `GlobalKeyboard`'s target guard to ignore keydowns originating from an element that is mid-drag: alongside `isEditableTarget`, bail when `target.closest('[aria-roledescription="draggable"][aria-pressed="true"]')` matches. dnd-kit sets `aria-pressed` on the active draggable, and keydowns route through the focused card for both keyboard drags and pointer drags (mousedown focuses the card), so the guard covers both modalities without the board and the global shortcuts having to know about each other.

### 3. Five columns do not actually fit at 1440px — 4px of horizontal overflow
**File:** `components/tasks/board-column.tsx` L36; `components/tasks/task-board.tsx` L281
**What's wrong:** The follow-up commit's stated purpose is "fit five columns at 1440px", but the budget doesn't close: sidebar 212+1, content `px-8` ×2, scroller `px-8` ×2, 5×224px columns + 4×12px gaps = 1232px of content in a 1228px scroller. Measured at 1440×900: `scrollWidth` 1232 vs `clientWidth` 1228, so the full pipeline still shows a horizontal scrollbar and a 4px pan at the exact target width (worse on Windows-style classic scrollbars).
**Fix:** Give the budget real slack instead of shaving to the pixel — e.g. `min-w-[220px]` (1212px total, 16px slack) on both the column and the skeleton, with a one-line comment stating the 1440 budget (sidebar 213 + page padding 64 + scroller padding 64) so the next retune keeps the invariant.

### 4. The board abandons the app's roving-focus keyboard model — every card is a raw Tab stop
**File:** `components/tasks/board-card.tsx` L44-L47; `components/tasks/task-board.tsx` (no list navigation)
**What's wrong:** Every list in the app is a listbox with j/k/arrow roving focus and one Tab stop; the board makes each card individually tabbable (dnd-kit's default `tabIndex: 0`) with no j/k or up/down movement between cards. With a realistic board (the Done column alone accumulates every completed task), reaching a mid-column card costs dozens of Tab presses, and tabbing past the board to anything after it costs one Tab per card. For a keyboard-forward, Linear-benchmarked app this is the board's primary interaction regressing below the app's own established bar, not a nice-to-have.
**Fix:** Apply the same roving-tabindex pattern `TaskList` already uses, adapted per column: one tabbable card per column (or per board), j/k/↑/↓ moves selection within a column and ←/→ across columns while idle, Space picks up, Enter opens. dnd-kit supports this shape (`attributes.tabIndex` is overridable via the `attributes` option), so the cards can stop being universal Tab stops without touching drag behavior.

### 5. `BoardCardContent` re-derives `TaskRow`'s meta logic — the due-tone ternary and badge cluster now live in two places
**File:** `components/tasks/board-card.tsx` L83-L92, L115-L135; `components/tasks/task-row.tsx` L43-L53, L127-L148
**What's wrong:** The branch copies `TaskRow`'s derivations verbatim: `dueTone` (`isOverdue → rose : isToday → ember : neutral`), the `variant={dueTone === "neutral" ? "outline" : "soft"}` badge, the assignee gate (`delegationCandidate === "person"`), the `labelIds.map(...).filter(Boolean) as Label[]` cast, and the `slice(0, 2)` + `+N` overflow. That is exactly the near-duplicate-that-drifts pattern; a future change to overdue semantics or the label cap will fix one surface and miss the other. Two concrete consumers exist now, which is the repo's own extraction threshold.
**Fix:** Extract the shared pieces once — a `dueToneFor(due)` helper (or a small `DueBadge`) plus a `TaskLabelBadges` fragment for the slice/overflow cluster — and consume them from both `TaskRow` and `BoardCardContent`. Layouts stay independent; only the semantics become single-source.

### 6. The board's height calc hardcodes two other files' layout constants
**File:** `components/tasks/task-board.tsx` L264; `components/app-shell/top-bar.tsx` L31 (`h-14`); `components/app-shell/app-frame.tsx` L74 (`pb-[80px]`)
**What's wrong:** `h-[calc(100dvh-3.5rem-80px)] md:h-[calc(100dvh-3.5rem)]` restates the top bar's `h-14` and the mobile main's `pb-[80px]` as literals, with nothing keeping them in sync. Retuning the top bar or the bottom-nav clearance silently leaves the board clipped or gapped — the same cross-file magic-number coupling this repo has flagged and fixed before (ghost timing, run 1 finding 6 of review-capture-status-9f3c).
**Fix:** Define the two values once as CSS custom properties in `globals.css` (e.g. `--topbar-h: 3.5rem; --bottomnav-clearance: 80px`), and consume them in all three places (`h-[var(--topbar-h)]`, `pb-[var(--bottomnav-clearance)]`, and the board calc). Drift then becomes structurally impossible.

### 7. The lift/settle shadow pair is triplicated across CSS keyframes, TS constants, and the card class
**File:** `components/tasks/task-board.tsx` L63-L68; `app/globals.css` L378-L390; `components/tasks/board-card.tsx` L97
**What's wrong:** `LIFTED_SHADOW`/`RESTING_SHADOW` must mirror the `.board-card-lifted` keyframe end state and the card's resting `shadow-[0_1px_2px_...]`, enforced only by "must mirror" comments. Retuning the lift in CSS makes the drop settle to a different shadow than the card rests at — a visual pop at the exact moment the animation is supposed to end calmly.
**Fix:** Declare the two shadows as CSS custom properties (e.g. `--board-card-shadow`, `--board-card-shadow-lifted`) and reference them from the keyframes, the card class (`shadow-[var(--board-card-shadow)]`), and the WAAPI keyframes (`boxShadow: "var(--board-card-shadow-lifted)"` — WAAPI resolves `var()` in property values; only easing strings can't, as the existing comment notes). One source, no mirror comments.

### 8. Dropping a card back on its own column announces "moved to X"
**File:** `components/tasks/task-board.tsx` L181-L185
**What's wrong:** `onDragEnd` announces `"${title} moved to ${statusLabel(over.id)}"` unconditionally, but when `over` is the source column nothing moves (`from === to` is a no-op). A screen-reader user who picks up a card, changes their mind, and drops it in place hears a false "moved to Inbox" — the announcement claims a state change that didn't happen.
**Fix:** In the announcement, compare `active.data.current?.status` to `over.id` (the drag data already carries the source status for exactly this kind of use) and announce a neutral "returned to X" / "dropped" when they match.

### 9. The List↔Board toggle equates two different data sets, so cards vanish when toggling
**File:** `components/tasks/view-toggle.tsx` L15-L38; `app/(app)/today/page.tsx` L45
**What's wrong:** A segmented List/Board control is the universal idiom for "same items, different presentation" (the docstring even calls them "alternate lenses over the same tasks"), but Today is a filtered subset while Board is the whole pipeline. The sharp direction: drag a card to Someday on the Board, click "List" — you land on Today, where that card (and most others) doesn't exist, with no explanation. Round-tripping the toggle silently changes the working set, which reads as data loss to a first-time user.
**Fix:** Make the scope change legible or make the sets match. Cheapest legible option: label the segments by what they are ("Today" / "Board") instead of by presentation ("List" / "Board"), so the toggle reads as navigation between two named surfaces rather than a re-render of the current one. Tooltips already exist on the segments to carry the distinction.

Found 9 issues.
