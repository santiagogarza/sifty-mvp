"use client";

import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import { formatSnoozeDate, formatSnoozeShort, isSnoozed } from "@/lib/domain/snooze";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { AlarmClock, Check } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";
import { SnoozeMenu, type SnoozeMenuMode } from "./snooze-menu";

/**
 * Single task row.
 *
 * Hierarchy choices:
 *  - The title is the loudest element. Everything else is meta.
 *  - Priority and due date sit on the left as a "spine" so scanning a list
 *    feels like reading column-aligned text.
 *  - Labels collapse to a single line and truncate gracefully.
 *  - The complete-button is a real <button> with a 32px hit target.
 */
export const TaskRow = React.forwardRef<
  HTMLDivElement,
  {
    task: Task;
    onOpen: (id: string) => void;
    active?: boolean;
    labels: Label[];
    tabIndex?: number;
    /**
     * Status to restore when un-completing. Completion ghosts pass the
     * status the task had before it was checked off, so a quick uncheck
     * puts it back exactly where it was.
     */
    uncompleteTo?: Lifecycle;
    /** Set when the row is a lingering ghost of a task that just left the list. */
    ghost?: "done" | "snoozed";
    /**
     * Controlled snooze popover (the list opens it from the s-chord).
     * Uncontrolled when omitted.
     */
    snoozeMenu?: SnoozeMenuMode | null;
    onSnoozeMenuChange?: (mode: SnoozeMenuMode | null) => void;
    onSnoozed?: (until: string | null) => void;
  }
>(function TaskRow(
  {
    task,
    onOpen,
    active,
    labels,
    tabIndex = -1,
    uncompleteTo = "active",
    ghost,
    snoozeMenu,
    onSnoozeMenuChange,
    onSnoozed,
  },
  ref,
) {
  const [localSnoozeMenu, setLocalSnoozeMenu] = React.useState<SnoozeMenuMode | null>(null);
  const menuMode = snoozeMenu !== undefined ? snoozeMenu : localSnoozeMenu;
  const setMenuMode = onSnoozeMenuChange ?? setLocalSnoozeMenu;
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const setRowRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      rowRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const taskLabels = task.labelIds.map((id) => labelMap.get(id)).filter(Boolean) as Label[];

  const due = task.due;
  const overdue = isOverdue(due);
  const dueLabel = formatRelativeDay(due);
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(due)
      ? "ember"
      : "neutral";

  const onComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const isDone = task.lifecycle === "done";
  const canSnooze = !isDone && task.lifecycle !== "dropped";
  const snoozed = isSnoozed(task);
  const snoozedGhost = ghost === "snoozed" && !!task.snoozedUntil;

  return (
    <div
      ref={setRowRef}
      role="option"
      aria-selected={active}
      tabIndex={tabIndex}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      className={cn(
        "group relative grid w-full items-center gap-3 cursor-default",
        "grid-cols-[24px_14px_1fr_auto] sm:grid-cols-[24px_14px_1fr_auto_auto]",
        "rounded-[var(--radius-md)] px-2.5 py-2.5",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        "hover:bg-[var(--surface-muted)]",
        active && "bg-[var(--surface-muted)]",
      )}
    >
      <button
        type="button"
        onClick={onComplete}
        aria-label={isDone ? "Mark as not done" : "Mark as done"}
        className={cn(
          // The visible circle is 20px; the ::after pseudo pads the hit
          // target to ~32px (Fitts) without changing the layout.
          "relative size-5 rounded-full border flex items-center justify-center",
          "after:absolute after:-inset-1.5 after:content-['']",
          "transition-all duration-150 ease-[var(--ease-product)]",
          !isDone &&
            "bg-[var(--surface-muted)] border-[var(--fg-muted)]/40 hover:bg-[var(--surface-hover)] hover:border-[var(--accent)]",
          isDone && "bg-[var(--done)] border-[var(--done)]",
        )}
      >
        {isDone ? <Check size={12} className="text-white" strokeWidth={3} /> : null}
      </button>

      <PriorityGlyph bucket={task.priorityBucket} />

      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              "truncate text-[14px] leading-[1.35] tracking-[-0.005em]",
              isDone
                ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]"
                : snoozedGhost
                  ? "text-[var(--fg-subtle)]"
                  : "text-[var(--fg)]",
            )}
          >
            {task.title}
          </span>
          <AiStatusInline status={task.aiStatus} />
        </div>
        {snoozedGhost ? (
          <div className="flex items-center gap-1 truncate text-[12px] text-[var(--fg-muted)] mt-0.5 animate-fade-in">
            <AlarmClock size={11} className="shrink-0" />
            Snoozed until {formatSnoozeDate(task.snoozedUntil!)}
          </div>
        ) : task.nextAction && !isDone ? (
          <div className="truncate text-[12px] text-[var(--fg-muted)] mt-0.5">
            {task.nextAction}
          </div>
        ) : null}
      </div>

      <div className="hidden sm:flex items-center gap-1.5 max-w-[220px] overflow-hidden">
        {taskLabels.slice(0, 2).map((label) => (
          <Badge key={label.id} tone={label.tone}>
            {label.name}
          </Badge>
        ))}
        {taskLabels.length > 2 ? (
          <span className="text-[11px] text-[var(--fg-subtle)]">+{taskLabels.length - 2}</span>
        ) : null}
      </div>

      <div className="flex items-center gap-2 justify-end">
        {assignee ? (
          <Badge tone="neutral" variant="outline" className="hidden sm:inline-flex max-w-[120px]">
            <span className="truncate">{assignee}</span>
          </Badge>
        ) : null}
        {snoozed && !snoozedGhost ? (
          <Badge tone="mist" variant="soft" className="gap-1">
            <AlarmClock size={10} />
            Snoozed · {formatSnoozeShort(task.snoozedUntil!)}
          </Badge>
        ) : null}
        {dueLabel ? (
          <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
            {dueLabel}
          </Badge>
        ) : null}
        {canSnooze ? (
          // The popover portals out of the DOM but still bubbles through
          // React: without this, its clicks and keys would open the row.
          <span
            className="contents"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Popover
              open={menuMode !== null}
              onOpenChange={(open) => setMenuMode(open ? "menu" : null)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={snoozed ? "Change snooze" : "Snooze"}
                  title="Snooze (S)"
                  className={cn(
                    "relative -my-1 flex size-7 items-center justify-center rounded-[var(--radius-sm)]",
                    "text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
                    "transition-opacity duration-150 ease-[var(--ease-product)]",
                    "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                    "data-[state=open]:opacity-100 data-[state=open]:bg-[var(--surface-hover)]",
                    "[@media(hover:none)]:opacity-100",
                    active && "opacity-100",
                  )}
                >
                  <AlarmClock size={13} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                onCloseAutoFocus={(e) => {
                  // Back to the row, not the trigger, so list keys keep working.
                  if (active && rowRef.current?.isConnected) {
                    e.preventDefault();
                    rowRef.current.focus({ preventScroll: true });
                  }
                }}
              >
                <SnoozeMenu
                  key={menuMode ?? "closed"}
                  task={task}
                  initialMode={menuMode ?? "menu"}
                  onDone={(until) => {
                    setMenuMode(null);
                    onSnoozed?.(until);
                  }}
                />
              </PopoverContent>
            </Popover>
          </span>
        ) : null}
      </div>
    </div>
  );
});
