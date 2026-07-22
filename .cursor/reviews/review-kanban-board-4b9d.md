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

## Run 2 — 2026-07-22 04:40 UTC

Follow-up on commit 1b0ea56 (all 7 Run 1 findings addressed). Verification: full re-read of `task-board.tsx`, `board-card.tsx`, `view-switch.tsx` plus load-bearing context (`task-list.tsx`, `keyboard.tsx`, `command-palette.tsx`, `app-frame.tsx`, `capture-dialog.tsx`, `view-toggle.ts`, `board.spec.ts`, `globals.css`), plus live Playwright probes against the running dev server.

**All 7 fixes verified correct:**

1. Footer renders after the `role="listbox"` div (valid ARIA); the target guard blocks remembered-state key handling on the button, and Enter activates it natively (probe: 37 done cards render after Enter).
2. Initial focus live-confirmed: container focused after `v`, ArrowDown enters the first card. The no-dep-array effect is a cheap two-ref-check no-op after first success; capture closes on submit and the detail sheet renders after `{children}` in `AppFrame`, so neither is focus-stolen; matches the `TaskList` convention.
3. Pointer drops refocus via `pendingFocusId`; dnd-kit's `useRestoreFocus` early-returns for non-keyboard activator events (confirmed in `@dnd-kit/core` 6.3.1 source, `core.cjs.development.js` L2704), so nothing fights the refocus.
4. `dueTone` forced neutral when done; shared `BoardCardContent` covers the drag overlay too.
5. Keyboard moves speak through the custom region only; pointer drops through dnd-kit only. No path double-announces (no KeyboardSensor, so dnd-kit never sees keyboard moves).
6. Brackets handled before the modifier guard, rejecting only `metaKey`: AltGr (ctrl+alt) and Option layouts work; Cmd+[ history nav preserved; no native ctrl/alt bracket shortcut exists to steal.
7. `toggleView` falls back to `setView("board")` when `current` is null; the palette's `V` hint is now honest on /memory and /settings.

### Clicking column whitespace focuses the listbox and kills every board key
**File:** `components/tasks/task-board.tsx` L257-L262 (target guard), L524-L530 (listbox `tabIndex={-1}`)
**What's wrong:** The column listbox div carries `tabIndex={-1}`, which makes it click-focusable. Clicking a column's empty area (below the cards, between-card gaps, an empty column's body) focuses the listbox, and the new target guard then rejects every key — live-probed: after clicking the Someday column's whitespace, `document.activeElement` is the listbox and ArrowDown, `j`, and `]` all do nothing until the user clicks a card or Tabs away. Before the guard existed, keys from this state still worked (bubbled to the container and acted on `focusedId`), so this is a regression introduced by the fix. Nothing in the codebase focuses the listbox programmatically, and a div without tabindex is not in the Tab order anyway, so the attribute's stated rationale ("only programmatically focusable so it never adds a Tab stop") buys nothing — it only creates this dead state.
**Fix:** Delete `tabIndex={-1}` (and its comment) from the listbox div. Clicks on non-card board chrome then fall through to the nearest focusable ancestor — the board container, which the guard already allows — live-probed via a header click: focus lands on the container and ArrowDown immediately enters the first card. With no focusable intermediate between cards and container, the dead state becomes unrepresentable rather than guarded against.

### "Show all N" strands keyboard focus on `<body>` after expanding Done
**File:** `components/tasks/task-board.tsx` L394-L405 (footer onClick)
**What's wrong:** Activating "Show all N" sets `showAllDone`, which drops `hiddenDone` to 0 and unmounts the button the user is focused on. Live-probed: after Enter on the button, `document.activeElement` is `<body>` and `j` does nothing — the keyboard flow the board is built around ends dead, and Tab restarts from the top of the page. Run 1's finding 1 called this out ("Consider also moving focus to the first newly revealed card"); the fix took the guard and footer placement but dropped this part.
**Fix:** In the button's onClick, queue focus onto the first newly revealed card through the machinery that already exists for moves: `const next = columns.done[DONE_PREVIEW_COUNT]; if (next) { setFocusedId(next.id); pendingFocusId.current = next.id; } setShowAllDone(true);`. The `pendingFocusId` effect focuses it after the re-render and scrolls it into view; pointer activations get the same continuation without a focus ring (`:focus-visible` heuristics).

### Initial-focus contract has no regression coverage — the e2e test bypasses the entry flow
**File:** `tests/e2e/board.spec.ts` L96-L114
**What's wrong:** The bracket test still enters the board with an explicit `await card.focus()`, so the exact bug fixed by Run 1 finding 2 (board opens, every key dead until Tab/click) would pass CI if it regressed — and it did ship once, in the original feature commit. The fix is an every-render effect that a well-meaning cleanup (adding a dep array, reordering the early returns) can silently break while the UI looks identical.
**Fix:** One assertion in the existing test, right after `page.keyboard.press("v")` resolves to /board: `await expect(page.locator('[aria-label="Board columns"]')).toBeFocused()`. Keep the explicit `card.focus()` for the bracket portion — parallel workers seed tasks concurrently, so "first card = marker" is not deterministic. No new test file.

Found 3 issues.

## Run 3 — 2026-07-22 04:55 UTC

Follow-up on commit cabe91c (all 3 Run 2 findings addressed). Verification: re-read of `task-board.tsx`, `board-card.tsx`, `board.spec.ts`; delta since Run 2 confirmed limited to those files plus this log; `pnpm biome check` (136 files) and `pnpm tsc --noEmit` re-run clean here; live Playwright probes against the running dev server (Chromium 149).

**All 3 fixes verified correct:**

1. Whitespace clicks probed on all five columns, including overflowing ones (inbox/active/done had scrollHeight > clientHeight): every click lands focus on the board container and `j` immediately enters a card. Chromium does not click-focus scrollers, so the fall-through holds even where columns scroll.
2. Show-all probed with 72 done tasks: Enter on the button focuses the card at index `DONE_PREVIEW_COUNT` (the first newly revealed one) and `j` continues to index 31. Index math is right — `columns.done` is the full list, the preview shows 0..29, and the button only renders when index 30 exists. `setFocusedId` + `setShowAllDone` batch into one render, ref callbacks register the new cards before the `pendingFocusId` effect runs, so the focus handoff has no interim gap.
3. The toggle e2e asserts `[aria-label="Board columns"]` is focused after `v`; the selector is unique, `toBeFocused` auto-retries, and the entry probe here confirms the behavior it locks down.

### Removing the listbox tabindex opted overflowing columns into Chromium's focusable-scroller heuristic — Tab now lands on dead listboxes
**File:** `components/tasks/task-board.tsx` L534-L539 (listbox), L257-L262 (target guard)
**What's wrong:** Chromium (127+, shipped form ~130; probed here on 149) makes a scroll container keyboard-focusable when it has no keyboard-focusable descendants. Every card except the single roving-tabindex one is `tabIndex={-1}`, so any overflowing column that doesn't hold the current roving card qualifies. Probed tab walk: card → Active listbox → Done listbox → Show-all button. On a tab-focused listbox the target guard rejects everything: `j`, `Enter`, and `]` are dead (probe: no focus change, no scroll), while ArrowDown natively scrolls the column without ever entering a card — the same stranded-keys state Run 2's finding eliminated for clicks, now reachable through the default Tab path. The old explicit `tabIndex={-1}` suppressed the heuristic (probe: re-adding it restores the clean walk card → button); removing the attribute un-suppressed it. Also an ARIA wart: a focused `role="listbox"` whose arrows never reach an option.
**Fix:** Restore `tabIndex={-1}` on the listbox (delete the biome-ignore — the attribute satisfies `useFocusableInteractive`, as pre-cabe91c) and neutralize the click-focus it re-enables with a focus redirect on the board container, which already owns the keyboard contract: in the container's `onFocus` (focusin bubbles in React), when `e.target` has `role="listbox"`, call `boardRef.current?.focus({ preventScroll: true })`. Clicks on whitespace then land on the container in every browser (the exact UX Run 2 probed), Tab never stops on a column body, and card/button focus events pass through untouched. Do not put the redirect on an attribute-less listbox instead: without `tabIndex={-1}` the heuristic keeps the listbox in the Tab order and the redirect would bounce Tab back to the container, trapping keyboard users inside the board.

Found 1 issue.

## Run 4 — 2026-07-22 05:01 UTC

Follow-up on commit 9fcd145 (Run 3 finding addressed). Delta since Run 3 confirmed limited to `task-board.tsx` + this log. Verification: full re-read of `task-board.tsx` and `board-card.tsx`; static trace of the redirect against every focus producer in the file; `pnpm biome check` (136 files) and `pnpm tsc --noEmit` re-run clean here; live Playwright probes against the running dev server (Chromium 149).

**Run 3 fix verified correct, including the redirect handler:**

- Whitespace clicks on all five columns (inbox/active/done overflowing) land focus on the board container with no scroll jump (`preventScroll` covers both the listbox `scrollTop` and the container `scrollLeft`); `j` immediately enters a card.
- No focus loop: the redirect's re-entrant focusin carries `target` = container (`role="group"`), which fails the `role === "listbox"` guard — recursion terminates at depth 2. Ten rapid whitespace clicks produced zero page errors.
- Card focus events pass through: cards are `role="option"`, so the card's own `onFocus` → `setFocusedId` runs and the redirect stays inert. Probed end-to-end: `j` → whitespace click (selection kept, `aria-selected` intact) → `]` moves the exact remembered card into Active with DOM focus following it — the `pendingFocusId` machinery is untouched (its target is an option, never a listbox). Sheet close (Enter → Escape) returns focus to the same card through the rAF refocus; Radix's interim restore lands on `<body>`, which never enters the board's focusin path.
- Tab walk probed both directions with 72 done tasks: roving card → "Show all 72" → out (forward), and Capture ← roving card ← button (reverse). No listbox stops; `tabIndex={-1}` suppresses the scroller heuristic in both navigation directions.
- The stranded-keys state is unrepresentable in time as well as space: the redirect completes synchronously inside the mousedown's focusin dispatch, so no keydown can ever fire while a listbox holds focus — the keydown guard's listbox-rejection branch is dead code by construction.
- Show-all button focus (`getAttribute("role")` = null), initial mount focus (`role="group"`), and the DragOverlay (sibling of the container, focus never bubbles through it) all bypass the redirect correctly. The biome-ignore removal is right — `tabIndex={-1}` satisfies `useFocusableInteractive`.

### The whitespace-click contract has no regression coverage — run 2's shipped bug would return silently
**File:** `tests/e2e/board.spec.ts` L42-L48
**What's wrong:** The two-part invariant (listbox `tabIndex={-1}` in `BoardColumn` + focus redirect in `TaskBoard`) is split across components and joined only by comments, and this exact interaction regressed twice in three commits — 1b0ea56 shipped the whitespace-click dead state, cabe91c's cure shipped the Tab-order dead state. If a future cleanup deletes the redirect (it reads as redundant next to the keydown guard to anyone without this history), clicking any column's whitespace focuses the listbox, the guard rejects every key, and the board looks identical while the keyboard is dead — the run 2 failure mode exactly. No e2e touches any click-on-board-chrome path (the three tests use `card.focus()`, drag, and `v`-entry), so it would pass CI. Unlike the Tab-order half (Chromium-version-dependent heuristic, needs overflowing columns — not deterministically assertable in CI), the click half is deterministic: `tabIndex={-1}` makes the listbox click-focusable regardless of content, so the redirect executes on every run.
**Fix:** Two lines in the existing toggle test, right after the entry-focus assertion: `await page.locator('[data-column="someday"] [role="listbox"]').click({ position: { x: 4, y: 10 } });` then re-assert `await expect(page.locator('[aria-label="Board columns"]')).toBeFocused();` (x=4 sits in the listbox's 6px `px-1.5` padding strip, left of any card at any y). This asserts the user-visible contract — clicking column whitespace never strands the keyboard — not the implementation, so it also passes under any correct redesign (e.g. attribute-less listboxes with click fall-through). No new test file.

Found 1 issue.

## Run 5 — 2026-07-22 05:15 UTC

Follow-up on commit 17cd57a (Run 4 finding addressed). Delta since Run 4 confirmed limited to `board.spec.ts`, `README.md` (its only change on the branch), and this log. Verification: full re-read of `board.spec.ts` and `task-board.tsx`; README claims traced against `keyboard.tsx`, `view-toggle.ts`, and the board key handler; `pnpm biome check` (136 files) and `pnpm tsc --noEmit` re-run clean here; board spec re-run 3/3 against the running dev server.

**Run 4 fix verified correct, including a mutation probe:**

- The added lines match the prescription: click `[data-column="someday"] [role="listbox"]` at (4, 10), re-assert `[aria-label="Board columns"]` focused. Both selectors are unique (one section per lifecycle, one listbox each; one board container).
- Geometry holds in every state: x=4 sits inside the `px-1.5` (6px) padding strip left of any card, so parallel-worker tasks landing in Someday can't intercept; the listbox is `flex-1` in a full-height column, so y=10 is inside it even when the column is empty; the `overflow-y-auto` scrollbar is on the right edge. At the default 1280px viewport all five ≥220px columns fit, so the click needs no horizontal scroll (and Playwright auto-scrolls regardless).
- No interaction side effects: MouseSensor listeners live on cards, so the padding click starts no drag; `openCard` only fires from cards, so no sheet opens; the trailing `v` press falls through the board's `onKeyDown` switch without `preventDefault` and reaches the global handler — the final `/waiting` assertion confirms.
- Coverage is real, not vacuous — mutation-probed: with the container's focus redirect deleted (the exact cleanup Run 4 predicted), the test fails at the post-click assertion (`board.spec.ts:52`); restored, it passes. It also stays green under the attribute-less redesign (click falls through to the container), so it locks the contract, not the implementation. The Tab-order half stays out of scope as Run 4 accepted (Chromium-version-dependent heuristic).
- README rows verified against the code: `v` is handled globally with editable/dialog exclusions and `toggleView` falls back to the board from non-list routes (Run 2), so "toggle list ⇄ board layout" is honest; `←/→`/`h`/`l` map to `horizontal(±1)` and exist only on the board; `[`/`]` map to `shiftColumn(-1/+1)`, agreeing with the row's "left / right" ordering.

### The keyboard table's new list/board split misattributes vertical navigation to the list only
**File:** `README.md` L273-L274
**What's wrong:** The board handles `ArrowDown`/`j` and `ArrowUp`/`k` as in-column navigation (`task-board.tsx` `vertical(±1)`; its header comment names "arrows / j k h l" as the board model). Before this commit the `↑/↓` (`j`/`k`) row's "Navigate task list" was merely generic; now it sits directly above the new "Navigate board columns" row, and the parallel structure reads as an exclusive split — a user learning the board from this table (the README's only board documentation) is told horizontal navigation exists but vertical does not. The commit's purpose was to document the board's keyboard model; it covered three of the four navigation gestures and turned the fourth's description misleading.
**Fix:** Reword the existing row to cover both surfaces, e.g. `| \`↑/↓\` (\`j\`/\`k\`) | Navigate task list / cards in a board column |`. One row; keeps the table's terse parallel style.

Found 1 issue.

## Run 6 — 2026-07-22 05:13 UTC

Closing check on commit 219f194 (claimed fix for the Run 5 finding). Delta since Run 5's verified commit (17cd57a) confirmed via `git diff --stat 17cd57a..HEAD`: the only committed change is this review log (+19 lines, the Run 5 section). No executable code changed since Run 5's clean biome/tsc/e2e state, so checks were not re-run.

**Fix content verified, commit contents not:**

- The working-tree README row matches the Run 5 prescription exactly (`| \`↑/↓\` (\`j\`/\`k\`) | Navigate task list / cards in a board column |`) and remains accurate against the code (`task-board.tsx` `vertical(±1)` handles `ArrowUp/Down` and `j`/`k` in-column; unchanged since Run 5's trace).
- `git diff README.md` confirms the row edit is the sole working-tree change — no other hunks.

### The Run 5 fix was never committed — commit 219f194 ships the review log, not the README change
**File:** `README.md` L273 (committed state at HEAD = 219f194)
**What's wrong:** Commit 219f194's message ("docs: vertical navigation covers both list and board cards") describes the README fix, but its content is only `.cursor/reviews/review-kanban-board-4b9d.md`. The corrected row exists solely as an uncommitted working-tree modification (`git status`: ` M README.md`); `git show HEAD:README.md` still reads `| \`↑/↓\` (\`j\`/\`k\`) | Navigate task list |`. Pushing the branch now ships the misleading row Run 5 flagged, with a commit message that falsely claims it was fixed.
**Fix:** Stage and commit the pending `README.md` change (e.g. amend-free follow-up commit; the working-tree content is already exactly right — no edit needed). Before declaring any review finding fixed, verify the fix landed with `git show <commit> --stat` rather than trusting the commit message.

Found 1 issue.
