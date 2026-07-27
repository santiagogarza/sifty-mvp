# Board view — design spec

Designs: **[Sifty — Board View (Kanban)](https://www.figma.com/design/qM0SfAkbZ5ZNOGXlczFk4m)**
Source PRD: *PRD: Sifty Board View (Kanban Style)* (Notion)
Library: **Sifty Design System v1.0** — every component, variable and text style below is published there.

The Figma file has five pages: `01 · Brief & Decisions`, `02 · Desktop` (16 states at 1280×832),
`03 · Responsive` (tablet 1024, phone 390), `04 · Anatomy & States`, `05 · Interaction & A11y`.
This document is the implementation contract; the Figma file is the visual source of truth.

---

## What the board is

A second rendering of a task view, laid out by status. It is a *view*, not a system: no new table,
no board entity, no column entity, no ordering field, and no new status values.

Columns are `STATUSES_IN_ORDER` from `lib/domain/status.ts` minus `dropped`, so the board reads
**Inbox → Focus → Waiting on → Someday → Done** with the same labels, icons and order as the
sidebar. Nothing in the board derives its vocabulary independently.

## Decisions worth knowing before you build

**One board, reachable from any list.** Board mode always lays out the full pipeline — a
single-status board is a worse list. The `List | Board` toggle sits in the page header of each task
view and the choice is remembered per view, so Today can be a board while Inbox stays a list. In
board mode the page title changes to "Everything, by status" so the widened scope is stated rather
than implied.

**The column is the drop target, not a slot.** The board has no manual card order, so an insert
line would promise precision that does not exist. Hovering tints the whole column and gives it a 1px
ember border. The `Board Drop Slot` component's `Target` variant exists for surfaces that *do* have
card order; the status board only uses `Ghost`.

**Columns are equal full height.** A hugging column makes Someday a small drop target and an empty
column almost no target at all. The `Board Column` component already reserves a 277px minimum card
area for this reason; board screens additionally stretch every column to fill the row.

**Empty means silence.** Zero tasks renders five empty columns and nothing else — no illustration,
no encouragement, and not even the "drag a card" page description, because there is nothing to drag.
Capture stays one keystroke away in the top bar.

**No celebration.** Dropping on Done gets a settle and a count, not confetti.

## Components

All published in the Sifty Design System; none of these need to be built from scratch.

| Component | Variants / props | Maps to |
| --- | --- | --- |
| `Board Card` | `State`: Default, Hover, Selected, Dragging, Done | one `Task` |
| `Board Column` | `State`: Default, Drop target; name, count, 4 card slots, ghost, overflow, add | one `Lifecycle` |
| `Board Drop Slot` | `Kind`: Ghost, Target | drag placeholder |
| `View Toggle` | `Selected`: List, Board | per-view preference |
| `Undo Toast` | `Message` | post-drop confirmation |
| `Board Keyboard Hint` | — | shortcut discoverability |
| `Board Card / Skeleton`, `Board Column / Skeleton` | — | local to the design file; loading state |

A card shows four things and at most one label chip: title, AI next action, priority glyph, due.
Anything else belongs in the detail sheet that already ships. Full redlines are on
`04 · Anatomy & States`.

## Behaviour contract

**A drop writes exactly one field: `lifecycle`.**

- `useStore.getState().setLifecycle(id, status)` writes optimistically, and the existing sync hook
  PATCHes `/api/tasks/[id]` in the background. Perceived latency is a local re-render.
- Dropping on Done sets `lifecycle: "done"` and stamps `completedAt` — byte-for-byte what the
  complete circle does.
- Undo re-applies the previous lifecycle through the same path. It is an ordinary move, not a
  rollback, so it syncs and survives refresh like any other edit.
- Offline behaves like the rest of Sifty: the move persists locally and the existing
  "Can't reach Sifty" pill appears. The board itself does not change.
- A drag is a user edit, so the target lifecycle joins `editedFields` and re-triage leaves it alone.

## Keyboard

Selection and filing are deliberately different keys so nobody files a card while browsing.

| Key | Action |
| --- | --- |
| `↑` `↓` / `j` `k` | Move selection within a column |
| `←` `→` | Move selection to the adjacent column (empty columns skipped) |
| `⇧←` `⇧→` | File the selected card one column over — same write, toast and Undo as a drag |
| `↵` | Open the selected card in the detail sheet |
| `Space` | Toggle complete |
| `⌘Z` | Undo the last move |
| `Esc` | Clear selection, or close the sheet |

`⇧←`/`⇧→` tint the destination column before the card lands, so the keyboard gets the same
feedforward the pointer gets.

## Motion

Only the two easings already in `app/globals.css`. Under `prefers-reduced-motion` every duration
collapses to `0.01ms`; the state change still happens.

| Moment | Duration | Easing |
| --- | --- | --- |
| Card lift (shadow, scale → 1.02) | 120ms | `--ease-product` |
| Column tint on enter/leave | 120ms | `--ease-soft` |
| Card settles after drop | 160ms | `--ease-product` |
| Count increments | 600ms | existing `.animate-count-pulse` |
| Undo toast appears | 320ms | existing `.animate-rise` |
| Undo toast retires | 240ms, after 6s | `--ease-product` |

## Accessibility

Nothing on the board is drag-only.

- Every move has a keyboard equivalent (`⇧←`/`⇧→`) and a pointer-light equivalent (the Status picker
  in the sheet). Satisfies WCAG 2.1 SC 2.5.7, Dragging Movements.
- Each column is a labelled list — `aria-label="Focus, 5 tasks"` — and each card is a list item
  wrapping one focusable control.
- A move writes to a polite live region: *"{Task title} moved to {Status}. Press Command Z to undo."*
- Focus follows the card into its new column, so filing several cards in a row does not send focus
  back to the top.
- Cards are at least 44px tall on touch; the complete circle keeps the ~32px hit target the list row
  already uses.
- Colour is never the only signal: a drop target is a tint *plus* a border; done is a strike-through
  *plus* a filled check.

## Responsive

The board never squeezes five columns into an unreadable width.

| Breakpoint | Behaviour |
| --- | --- |
| ≥ 1280 | Five columns fill the content width (194px each at 1280). |
| 768–1279 | Columns hold a 194px minimum and the row scrolls; the clipped column is the affordance. |
| < 768 | Sidebar is replaced by the bottom nav. Columns are 288px and snap-scroll horizontally; long-press lifts a card and the board auto-scrolls toward the pointer. The detail sheet becomes a bottom sheet. |

## Out of scope

Swimlanes, custom columns, per-column sorting, multi-select drag, WIP limits, board sharing,
avatars, confetti. The first four are PRD non-goals; the rest would each add a system where the PRD
asked for a view.
