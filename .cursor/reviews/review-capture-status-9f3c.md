# Review: review-capture-status-9f3c

Scope: full branch diff `master...HEAD` on `cursor/capture-feedback-status-clarity-b763` — status vocabulary (`lib/domain/status.ts`), selector unification, capture-opens-sheet feedback, filing strip, completion ghosts, `/done` page, sidebar/palette rewiring, CSS keyframes.

Checks at review time: `pnpm biome check` clean, `pnpm tsc --noEmit` clean, `pnpm test` 71/71 pass.

Verified non-issues (investigated, no action): `completedAt` survives the sync round-trip (both `lib/db/repos/pg.ts` and `memory.ts` derive it from lifecycle transitions like the client store, so the `/done` sort is stable across pull); ghost layout-effect double-invoke is StrictMode-safe (`prev === tasks` early return); `queueMicrotask(runTriage)` runs before the `requestAnimationFrame(openDetail)`, so the sheet always opens with `aiStatus === "running"`; filing during in-flight triage is safe (dirty check routes to the local `mergeTriageIntoTask` path, which never touches `lifecycle`); the e2e smoke capture test is unaffected by the auto-opening sheet (API polling + fresh reload); new selector tests are timezone-robust (overdue and due-today both satisfy `dueForces`).

## Run 1 — 2026-07-22T03:20Z

Findings are ordered by importance (per review contract, no severity labels — each finding should be fixed or explicitly declined with reasoning).

### 1. Filing strip unmounts the button under the keyboard user's focus, and the confirmation is never announced
**File:** `components/tasks/task-detail-sheet.tsx` L422-L475
**What's wrong:** Clicking a "Move to …" button swaps the strip to the confirmation branch, unmounting the focused button. Radix FocusScope recovers by refocusing the sheet container, so the keyboard user's position is silently lost right after the primary filing action — in a keyboard-forward app this is the exact moment focus continuity matters. The "Moved to Focus" confirmation is also visual-only (no `role="status"`/`aria-live`), so screen-reader users get silence after activating the button.
**Fix:** Render the confirmation inside a `role="status"` element so the move is announced, and keep focus stable: either keep the strip's container focusable and move focus to it on file, or focus a durable element (e.g. the Status meta cell or close button) explicitly.

### 2. `/done` is unreachable on phones, and the mobile nav bypasses the new single source of truth
**File:** `components/app-shell/bottom-nav.tsx` L19-L25; `components/app-shell/top-bar.tsx` L49-L60
**What's wrong:** The sidebar is `hidden md:flex` and the command-palette trigger is `hidden sm:flex`, so below 640px there is no path to `/done` at all (no bottom-nav item, no palette, no keyboard). The plan's headline promise — "completion becomes recoverable and legible instead of a vanish" — does not exist on phones beyond the 880ms ghost window. Waiting/Someday share this pre-existing gap, but Done is new in this change and is the recovery surface. Relatedly, `bottom-nav.tsx` hardcodes "Focus"/"Inbox" labels and `Target`/`Inbox` icons instead of reading `STATUS_META`/`STATUS_ICONS`, contradicting the `lib/domain/status.ts` docstring claim that every user-facing surface reads from the map "so the vocabulary can never drift".
**Fix:** Decide the mobile IA for Done (bottom-nav item, a "More" slot, or a mobile palette trigger) as part of this feature, and source the bottom-nav labels/icons from `STATUS_META`/`STATUS_ICONS` so drift is structurally impossible.

### 3. `NavCount` pulse flag can get stuck `true`, silently swallowing the next pulse
**File:** `components/app-shell/sidebar.tsx` L133-L158
**What's wrong:** The effect only returns a cleanup (which clears the reset timer) on the increment branch. If the count decreases within the 700ms window — e.g. capture (+1 inbox, pulse starts) then quickly filing that task out of Inbox from the new strip, the exact flow this feature promotes — the decrement run clears the pending reset timer without scheduling a new one, so `pulse` stays `true` indefinitely. The class then never toggles off, and the next increment's `setPulse(true)` is a no-op, so its animation never restarts: the landing cue silently fails to play. (Also worth noting: the first server pull after sign-in on a fresh browser pulses every badge at once, since counts jump from 0.)
**Fix:** Make the non-increment path reset the flag (`setPulse(false)`) so the class always toggles off/on across pulses — or, more robustly, replace the boolean with a monotonic counter and re-key the span (`key={pulseSeq}`) so each increment restarts the animation by construction. Optionally gate pulsing on the initial sync having settled.

### 4. `useJustFilled` has the same stuck-flag pattern; a quick re-triage swallows the fill-in animation
**File:** `components/tasks/task-detail-sheet.tsx` L378-L393
**What's wrong:** Same shape as finding 3: if `aiStatus` leaves `ready` within the 1400ms window (user clicks "Reorganize with Sifty" right after a fill lands), the cleanup clears the reset timer and `justFilled` sticks at `true`. On the next `running → ready` transition `setJustFilled(true)` is a no-op, the `animate-fill-in` class never re-applies, and the settle-in animation for that fill is skipped.
**Fix:** Reset in the non-transition path (`setJustFilled(false)` when the transition condition is not met) — this both unsticks the flag and guarantees the class toggles off during `running`, so re-adding it on `ready` reliably replays the animation. Consider extracting the shared "one-shot flag with timed reset" hook so this class of bug can't be reintroduced twice.

### 5. Completion-ghost invariant ("ghost ⇒ task is currently done") is not enforced, leaving a stale actionable snapshot
**File:** `components/tasks/task-list.tsx` L163-L172, L206-L211; `components/tasks/task-row.tsx` L53-L58
**What's wrong:** The ghost renders a snapshot captured at completion time, and the render filter only drops ghosts whose task re-entered *this* list. If the task is un-completed from another surface within the window — complete on the row, click the ghost row to open the sheet, uncheck there (goes to `active`, so it does not re-enter an Inbox/Today list) — the ghost keeps rendering a checked/struck row for a task that is no longer done. Worse, its checkbox is live and operates on the stale snapshot: `task.lifecycle === "done"` is true on the snapshot, so clicking it sets the now-active task's lifecycle back to `restoreTo` (e.g. `inbox`), silently demoting it.
**Fix:** Enforce the invariant where ghosts are produced/consumed: in the returned filter, also require the live store task to still be `done` (`useStore.getState()` lookup is consistent with the hook's existing usage, and the memo recomputes on every store-driven `tasks` change). That removes both the stale rendering and the stale action in one place.

### 6. Ghost lifetime is duplicated across TS and CSS with nothing keeping them in sync
**File:** `components/tasks/task-list.tsx` L147-L148; `app/globals.css` L367-L377
**What's wrong:** `GHOST_TOTAL_MS = 880` must stay ≥ the CSS `600ms delay + 240ms duration` of `.ghost-collapse`. The relationship lives only in comments; retuning either side silently desyncs them — too short and the row snaps out mid-collapse, too long and a collapsed zero-height row lingers in the DOM/a11y tree. This is exactly the cross-file magic-number coupling that drifts.
**Fix:** Remove the parallel timer as the primary mechanism: listen for `onAnimationEnd` on the ghost wrapper (filtering for `sifty-ghost-collapse`) to delete the ghost, keeping a generous timeout only as a safety net. Removal is then correct by construction regardless of CSS tuning (and still fires under `prefers-reduced-motion`, since the animation runs with near-zero duration).

### 7. Dropped disclosure has no `aria-expanded`, and expanding it steals focus into the list
**File:** `app/(app)/done/page.tsx` L45-L66; `components/tasks/task-list.tsx` L41-L45
**What's wrong:** The new disclosure button conveys state only via chevron rotation — no `aria-expanded` (or `aria-controls`), so AT users can't tell it toggled. And because `TaskList` self-focuses on first non-empty mount (behavior designed for page-level lists), expanding Dropped moves DOM focus off the button into the revealed listbox; collapsing then drops focus to `body`. That breaks the standard disclosure interaction for keyboard users.
**Fix:** Add `aria-expanded={expanded}` to the button, and make `TaskList`'s initial self-focus opt-in (e.g. an `autoFocus`/`initialFocus` prop defaulting to current behavior for page views, disabled for the embedded Dropped list) so composing the list inside disclosures can't hijack focus.

### 8. Filing-strip confirmation vanishes abruptly on a timer, with a layout jump — contradicting its own contract
**File:** `components/tasks/task-detail-sheet.tsx` L433-L441 (2400ms timer), L440-L441 (unmount condition)
**What's wrong:** The docstring says the confirmation "fades away on its own", but after 2400ms the strip unmounts with no exit transition, shifting the sheet's footer/content — an unprompted layout jump seconds after the interaction, in an app whose stated contract is calm motion.
**Fix:** Simplest durable option: drop the timer and keep the confirmation for the lifetime of this sheet instance (DetailBody is keyed per task, so it naturally resets) — the quietest outcome. If the timed dismissal is intentional, animate the strip out (height/opacity) instead of unmounting it cold.

### 9. Next-action placeholder condition diverges from the shimmer condition, leaving a fully blank field
**File:** `components/tasks/task-detail-sheet.tsx` L199-L202 vs L213
**What's wrong:** The placeholder is suppressed by `firstFill && !task.nextAction`, but the shimmer overlay additionally requires `!edited("nextAction")`. A user who types into next-action during the organizing window and deletes it (edited, empty) gets neither shimmer nor placeholder — a dead-blank input until triage settles. Two expressions of "this slot is pending" have already drifted within one section.
**Fix:** Compute one `nextActionPending` boolean (`firstFill && !task.nextAction && !edited("nextAction")`) and drive both the overlay and the placeholder suppression from it, so the two states cannot disagree.

### 10. The `href !== null` filter + `as string` cast is duplicated at every consumer of `STATUS_META`
**File:** `components/app-shell/sidebar.tsx` L37-L45; `components/app-shell/command-palette.tsx` L59-L69
**What's wrong:** Both the sidebar and the palette re-implement "statuses that have a view" with a filter followed by `STATUS_META[s].href as string`. The type doesn't encode the invariant, so every future consumer (Kanban board is explicitly planned) must repeat the filter and the cast — and a forgotten filter compiles fine and renders a broken `null` link.
**Fix:** Derive it once in `lib/domain/status.ts`: `export const STATUS_VIEWS: ReadonlyArray<{ status: Lifecycle; label: string; href: string; ... }>` built via `flatMap` over `STATUSES_IN_ORDER`, narrowing `href` to `string` at the single point of truth. Consumers map over `STATUS_VIEWS` with no casts possible.

### 11. Plan deviation: the fill-in moment has no `--ai-soft` wash
**File:** `app/globals.css` L315-L324; `components/tasks/task-detail-sheet.tsx` L113-L117
**What's wrong:** The plan specifies the fill-in as "rise + a brief `--ai-soft` wash that fades over ~1.2s". The implemented `sifty-fill-in` is opacity/translate only over 420ms; the 1400ms `justFilled` window exists but nothing uses the AI hue on landing, so the "Sifty just filled this" cue reads as a generic section fade rather than the promised AI wash.
**Fix:** Either add the background wash (e.g. a second keyframe animating `background-color` from `var(--ai-soft)` to transparent over ~1.2s on the filled sections) or, if the simpler settle was a deliberate calm-scope cut, note the deviation so the plan and implementation agree.

Found 11 issues.

## Run 2 — 2026-07-22T03:38Z

Re-review of fixes in `4892391` (review fixes) and `026683a` (checkbox hit target). Checks re-run: `pnpm biome check` clean, `pnpm tsc --noEmit` clean, `pnpm test` 71/71.

Fix verification (all 11 original findings):

- **1 (FilingStrip a11y/focus)** — fixed as claimed (`role="status"`, `tabIndex={-1}`, focus on appear, persists per sheet visit). One new focus edge introduced; see finding 1 below.
- **2 (mobile reachability + nav drift)** — bottom nav reads `STATUS_META`/`STATUS_ICONS`; palette trigger now visible on phones with `aria-label` (icon-only below `md`). Declined bottom-nav Done slot not re-raised per caller's reasoning; palette-as-route matches the pre-existing Waiting/Someday treatment.
- **3 (NavCount stuck pulse)** — fixed. Traced increment/decrement/zero-hide/remount paths: `pulseKey` remount restarts the animation by construction; `prevRef` starts `null` and records only while `live`, so the hydration 0→N jump can't pulse. Accepted residual (first server pull on a fresh profile) not re-raised.
- **4 (useJustFilled stuck flag)** — fixed. Non-transition path resets; ready→running removes the class in its own commit, so the next running→ready reliably replays. Wash timing fits: max stagger 180ms + 1200ms wash < 1400ms window.
- **5 (stale ghost snapshot)** — fixed at the consumption point: rendered ghosts are always the live store task and only while still `done`. Residual state-retention hole remains; see finding 2 below.
- **6 (ghost timing duplication)** — fixed. `animationend` filtered on `sifty-ghost-collapse` (bubbling descendant animations like `sifty-pulse-soft` are excluded by the name check); 4s timer is safety-net only. Under `prefers-reduced-motion` the global override clamps duration but not the 600ms delay, so `animationend` still fires (~600ms) and the safety net is not load-bearing there.
- **7 (disclosure a11y/focus steal)** — fixed. `aria-expanded`/`aria-controls` present (unmounted-when-collapsed target matches Radix convention); `autoFocus` defaults true so `TaskView` page lists keep self-focus, dropped list opts out.
- **8 (confirmation auto-dismiss)** — fixed; timer gone, persists for the keyed `DetailBody` instance.
- **9 (shimmer/placeholder drift)** — fixed; single `nextActionPending` drives both.
- **10 (href filter duplication)** — fixed; `STATUS_VIEWS` derived once, consumers map with no casts.
- **11 (missing AI wash)** — fixed; `sifty-ai-wash` runs alongside `sifty-fill-in`, one inline delay applies to both (CSS repeats the `animation-delay` list).
- **Checkbox hit target (`026683a`)** — `after:-inset-1.5` on a 20px circle gives ~32px; 6px extension sits inside the 12px column gap, no overlap with adjacent click targets.

### 1. FilingStrip confirmation steals focus from the Status picker after an inbox round-trip
**File:** `components/tasks/task-detail-sheet.tsx` L431-L438
**What's wrong:** `filed` persists for the sheet visit and the focus effect keys on the derived `showConfirmation` boolean, so any later inbox→non-inbox transition re-fires it — not just the strip's own buttons. Trace: file via the strip (confirmation focused, correct), then in the Status meta cell pick "Inbox" (strip reverts to buttons, `filed` still true), then pick any non-inbox status from the still-open picker: `showConfirmation` flips false→true and the effect focuses the confirmation, yanking focus out of the Radix popover — which, being non-modal, dismisses on focus-out. The picker normally stays open after a selection, so this both closes it unexpectedly and teleports keyboard focus to the bottom of the sheet mid-interaction.
**Fix:** Make focus follow only the strip's own action: set a ref flag in `file()` (`focusOnConfirm.current = true`) and consume it in the effect before focusing. Alternatively (more thorough), reset `filed` when `task.lifecycle` returns to `"inbox"` — that also keeps the confirmation attributed to a strip action rather than replaying for picker-driven moves.

### 2. Hidden ghost entries survive up to 4s and can resurrect with a stale `restoreTo`/`index`
**File:** `components/tasks/task-list.tsx` L241-L253
**What's wrong:** The consumption-point filter hides invalid ghosts but the comment says "removes"; the map entry is only deleted by `animationend` (never fires once the ghost is filtered out mid-collapse) or the 4s safety timer. If a ghost is hidden before the collapse finishes (~840ms) because the task was un-completed from the sheet (lifecycle→`active`, so it does not re-enter this list), and the task is then re-completed from the sheet within the 4s window, the stale entry resurrects: a row materializes in a list where none was visible, and its `restoreTo` is the original status (e.g. `inbox`) rather than the actual pre-completion status (`active`), so unchecking it demotes the task. The re-enter path is safe (the layout effect overwrites with a fresh ghost), but the not-done path retains stale state. Narrow (bounded by the safety timer and the sub-840ms hide) but the stated invariant is implemented as hide-not-remove.
**Fix:** Prune instead of filter: add an effect over `allTasks` that calls `dismissGhost(id)` for any ghost whose live task is missing or not `done`, keeping the memo filter as defense in depth. Entries then cannot outlive their validity, and the comment becomes structurally true.

Found 2 issues.

## Run 3 — 2026-07-22T03:52Z — No issues found.

Final confirmation pass on `896704f` (scope: the two Run-2 fixes plus anything new in that commit). Checks re-run independently: `pnpm biome check` clean, `pnpm tsc --noEmit` clean, `pnpm test` 71/71.

Fix verification:

- **Run-2 finding 1 (FilingStrip focus steal)** — fixed. Traced: `focusPending` is set only in `file()` and consumed exactly once when `showConfirmation` flips true, so picker-driven transitions can never trigger the focus effect; the reset effect (`lifecycle === "inbox"` → `setFiled(false)`) means an inbox round-trip re-arms the buttons instead of replaying the confirmation. The intermediate render (lifecycle back to inbox, `filed` not yet reset) is covered by the derived `showConfirmation` condition, and a dangling `focusPending` after a remote revert is harmless because `showConfirmation` can only become true again via `file()`, which sets the ref anyway. Runtime-verified against a pristine dev server: strip filing still focuses the `role="status"` confirmation (Run-1 contract); picker → Inbox keeps the popover open and reverts the strip to buttons; a subsequent non-inbox pick from the still-open picker leaves the popover open, steals no focus, and shows no strip confirmation.
- **Run-2 finding 2 (ghost resurrection with stale `restoreTo`)** — fixed. Traced: the pruning effect over `ghosts` + `allTasks` deletes (via `dismissGhost`, which also clears the safety timer) any entry whose task is missing or not `done`; it is idempotent, self-settling (re-run after deletion finds nothing to prune), StrictMode-safe, and cannot race the layout effect (a freshly added ghost is `done`, so never pruned in the same cycle). The memo filter remains same-render defense in depth, and the comment now matches behavior. Runtime-verified: complete-from-row → un-complete-from-sheet removes the ghost; re-completing within the old 4s window materializes nothing in the list; the task lands on `/done` exactly once with no demotion.

Nothing new introduced: the commit touches only the two components plus this log; full 13-check e2e flow suite re-run against a pristine server on a separate port, 13/13 pass, confirming no regression to capture, ghost lifecycle, restore, filing, view membership, or the Dropped disclosure.

Review closed.
