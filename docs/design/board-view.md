# Board view — design spec

Design for the board (kanban-style) layout described in the PRD, drawn against
the Sifty design system.

- Figma page: [Feature / Board View](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=7-22)
- Spec frame in Figma: [`_Doc · Board View`](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=69-5391)

The board is a second layout for tasks that already exist: same Zustand store,
same `Lifecycle` values, no migration. Columns are `STATUS_META` in `order`, so
the board, the sidebar, and the status picker in the detail sheet cannot drift
apart.

## Decisions

**1. Columns are the five statuses that have a view** — Inbox, Focus, Waiting
on, Someday, Done — read from `STATUS_VIEWS`. `dropped` has `href: null` and
therefore no column, exactly as it has no sidebar entry. No status is invented
for the board (PRD requirement).

**2. Board mode groups by status, so it releases the view's status filter.**
The columns now express that filter; search and label filters
(`ViewArgs` in `lib/store/selectors.ts`) still apply. The page header renames
itself to "Everything, by status" so the wider scope is stated rather than
applied silently, and toggling back to List restores the view untouched.

This is the one decision that needs a product call. Sifty's sidebar views are
statuses, so a board scoped to a single view would be one full column and four
empty ones — useless. The alternative considered and rejected was a scope chip
(`Today` / `All tasks`) next to the toggle: it made the scope adjustable but
put a control in the header that contradicted the view's own title.

**3. The column is the drop target, not a gap between cards.** Per-column
sorting rules are an explicit non-goal, so there is no manual card order; an
insertion line would promise ordering the release does not support. The whole
destination column tints and both column counts preview the post-drop numbers.

**4. The whole card is the drag handle.** Hover raises the card
(`Elevation/Raised`) and the cursor becomes `grab` (`grabbing` while dragging).
There is no grip glyph — dropping it buys 16px of title width, which is the
scarcest resource in a 194px column.

**5. Complete still works from a card.** The complete circle shares one fixed
16px slot with the priority glyph: glyph at rest, circle on hover. Sharing a
slot means revealing it never reflows the card. Drag-to-Done remains the
primary completion gesture on the board.

**6. Every drop is reversible.** A pill — the same shape and type as the
existing offline notice in `components/app-shell/app-frame.tsx` — names the
destination status and offers Undo for 6s (`⌘Z`), then retires itself.
Reversibility is what lets dragging feel physical instead of consequential.

**7. Empty is silence.** No illustration, no "nothing here yet". Columns keep a
card-sized empty area so they still read as somewhere to drop, and the keyboard
hint row is hidden when there is nothing to move.

## The card

Shows exactly: title (wraps to two lines), the AI next action (one line,
truncated), the priority glyph, a due badge, and one more badge — the assignee
when `delegationCandidate === "person"`, otherwise the first label. The AI
status chip appears while triage is `pending`/`running`/`failed`. Nothing else.

Done cards get the filled circle, a struck title at `fg/subtle`, and no next
action, mirroring `TaskRow`.

## Interaction

**Drag** — lift → the source column leaves a ghost in the card's place → the
destination column tints and previews its count → drop → the card settles with
the existing `sifty-fill-in` + `sifty-ai-wash` animation, the counts run
`animate-count-pulse`, and the pill offers Undo.

**Keyboard**

| Key | Action |
| --- | --- |
| `←` `→` | Move the selection to the adjacent column |
| `↑` `↓` (`j` `k`) | Move the selection within a column |
| `⇧←` `⇧→` | File the selected card one column left/right |
| `↵` | Open the selected card |
| `⌘Z` | Undo the last move |
| `Esc` | Clear the selection |

Plain arrows navigate because navigating is the more frequent action; `Shift`
carries the card with the selection. The hint row under the board documents it,
mirroring the list's `J K to move · ↵ to open`.

**Mobile** — long-press lifts a card, the column row auto-scrolls at the edges,
columns are 288px with the next one peeking so the horizontal scroll needs no
hint. The undo pill sits above the bottom nav (`bottom-[92px]`, as the offline
notice already does).

**Sync** — the move is `updateTask(id, { lifecycle })`: optimistic in the
store, pushed in the background, replayed from the dirty ledger if the push
never lands. Nothing board-specific is needed.

## Tokens

| Element | Tokens |
| --- | --- |
| Column tray | `surface/muted`, `border/default`, `radius/lg`, padding `spacing/sm` |
| Card | `surface/default`, `border/default`, `radius/md`, padding `spacing/md`, gap `spacing/sm` |
| Card hover | `border/strong` + `Elevation/Raised` |
| Card selected | `accent/default` border, no shadow |
| Card in flight | `accent/default` border + `Elevation/Float`, −2° tilt |
| Drop target | `accent/default` border, `accent/soft` at 35% |
| Settle wash | `ai/soft` |
| Type | `Body/Small` titles, `Meta/Caption` next action, `Body/Small Medium` column names |

## Components added to the design system

| Component | Purpose |
| --- | --- |
| [`Board Card`](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=49-904) | Task as a card. `State` = Default / Hover / Selected / Dragging / Done |
| [`Board Column`](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=52-999) | One status column. `State` = Default / Drop target |
| [`Board Drop Slot`](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=51-982) | Silent placeholder. `Kind` = Ghost / Target |
| [`View Toggle`](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=53-1054) | List \| Board segmented control |
| [`Undo Toast`](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=54-1049) | Post-drop confirmation with Undo |
| [`Board Keyboard Hint`](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=55-1070) | Shortcut row under the board |
| [`Icon / Columns`](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=46-6) | Board glyph for the toggle (lucide `columns-3`) |

## Screens

| # | Frame | What it shows |
| --- | --- | --- |
| 01 | [List → Board](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=66-4716) | The entry point: the toggle in the page header of a task view |
| 02 | [Board — Default](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=56-1050) | Five columns, counts and icons matching the sidebar |
| 03 | [Board — Dragging](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=60-1426) | Ghost, tinted destination, previewed counts, card in flight |
| 04 | [Board — Dropped + Undo](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=60-1442) | Settle wash, ticked counts, undo pill |
| 05 | [Board — Card detail](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=60-1458) | The shipped detail sheet over the board |
| 06 | [Board — Keyboard move](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=60-1474) | Selected card with the accent ring |
| 07 | [Board — Search](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=60-1490) | Active query, filtered counts, empty columns still droppable |
| 08 | [Board — Empty](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=60-1506) | Zero tasks |
| 09 | [Board — 200 tasks](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=60-1522) | Independent per-column scroll |
| 10 | [Board — Dark](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=60-1538) | The Color collection's Dark mode |
| 11 | [Board — Mobile](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=67-4898) | 390×844, horizontal column scroll |
| 12 | [Board — Mobile drag](https://www.figma.com/design/F6k8Uq5X8z1rd2QzKn6y5C/Sifty-Design-System?node-id=68-5155) | Long-press lift with auto-scroll |

## Acceptance criteria coverage

| PRD criterion | Where |
| --- | --- |
| Toggle preserves scroll position and selection | 01 → 02; selection is the same `activeIndex` concept as `TaskList` |
| Drag updates status in <200ms perceived and survives refresh | 03 → 04; optimistic `updateTask`, background push |
| Documented shortcut moves a card left/right | 06 + the hint row component |
| Renders with 0, 1 and 200 tasks | 08, 07 (single-card columns), 09 |
| Open detail, complete and snooze work from a card | 05 (sheet), decision 5 (complete); snooze stays in the sheet |
| Board respects current filters and search | 07 |

## Implementation seams

- `STATUS_META` / `STATUSES_IN_ORDER` / `STATUS_VIEWS` — column identity,
  label, description, icon and order.
- `STATUS_ICONS` in `components/tasks/status-icon.tsx` — column header icons.
- `lib/store/selectors.ts` — the task set per view and the shared filters.
- `useStore().updateTask(id, { lifecycle })` — the move; already debounced,
  ordered per entity, and replayed from the dirty ledger.
- The completion-ghost `restoreTo` pattern in `components/tasks/task-list.tsx`
  — the same shape the undo pill needs (remember the previous `lifecycle`,
  restore it on undo).
- `PriorityGlyph`, `Badge`, `AiStatusInline` — reused as-is on the card.
