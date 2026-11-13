"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SNOOZE_WAKE_HOUR, isSnoozed } from "@/lib/domain/snooze";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  formatRelativeDay,
  nextWeekSnoozeDate,
  parseDateOnly,
  tomorrowDate,
  weekendSnoozeDate,
} from "@/lib/utils/dates";
import { Moon } from "lucide-react";
import * as React from "react";

/**
 * One snooze menu for the row and the detail sheet.
 *
 * Tomorrow is the default: it is the first item, and the date field opens
 * on it, so the common case is a single click. This weekend and next week
 * cover the other usual horizons; any other day is optional. The date
 * cannot be today or earlier. Choosing writes `snoozeUntil` immediately.
 * Bring back clears it. Done and dropped tasks have nothing to wake into.
 */
export function SnoozeMenu({
  task,
  variant = "row",
}: {
  task: Task;
  variant?: "row" | "header";
}) {
  const updateTask = useStore((s) => s.updateTask);
  const [open, setOpen] = React.useState(false);

  if (task.lifecycle === "done" || task.lifecycle === "dropped") return null;

  const snoozed = isSnoozed(task);
  const wakeDay = snoozed ? formatRelativeDay(task.snoozeUntil) : null;
  const label = wakeDay ? `Snoozed until ${wakeDay}` : "Snooze";

  const now = new Date();
  const tomorrow = tomorrowDate(now);
  const weekend = weekendSnoozeDate(now);
  const nextWeek = nextWeekSnoozeDate(now);
  const fieldValue =
    task.snoozeUntil && parseDateOnly(task.snoozeUntil) && task.snoozeUntil >= tomorrow
      ? task.snoozeUntil
      : tomorrow;

  const shortcuts: Array<{ label: string; date: string; testId: string }> = [
    { label: "Tomorrow", date: tomorrow, testId: "snooze-tomorrow" },
    ...(weekend ? [{ label: "This weekend", date: weekend, testId: "snooze-weekend" }] : []),
    { label: "Next week", date: nextWeek, testId: "snooze-next-week" },
  ];

  const choose = (date: string) => {
    updateTask(task.id, { snoozeUntil: date });
    setOpen(false);
  };

  const bringBack = () => {
    updateTask(task.id, { snoozeUntil: null });
    setOpen(false);
  };

  const showDay = (iso: string) => {
    const date = parseDateOnly(iso);
    if (!date) return iso;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <span
      className="inline-flex"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {variant === "header" ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[12px] font-normal text-[var(--fg-muted)]"
              aria-label={label}
              title={label}
              data-testid="snooze-trigger"
            >
              <Moon size={13} />
              {wakeDay ?? "Snooze"}
            </Button>
          ) : (
            <button
              type="button"
              aria-label={label}
              title={label}
              data-testid="snooze-trigger"
              className={cn(
                "relative size-5 rounded-full flex items-center justify-center",
                "text-[var(--fg-subtle)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]",
                "after:absolute after:-inset-1.5 after:content-['']",
                "transition-colors duration-150 ease-[var(--ease-product)]",
              )}
            >
              <Moon size={13} />
            </button>
          )}
        </PopoverTrigger>
        <PopoverContent align="end">
          <div className="flex flex-col gap-1 min-w-[220px]">
            {snoozed && wakeDay ? (
              <>
                <div className="px-2.5 py-1.5 text-[13px] text-[var(--fg)]">
                  {wakeDay}
                  <span className="text-[var(--fg-subtle)]"> · {SNOOZE_WAKE_HOUR}:00</span>
                </div>
                <button
                  type="button"
                  onClick={bringBack}
                  data-testid="snooze-bring-back"
                  className="rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] text-[var(--fg)] hover:bg-[var(--surface-hover)]"
                >
                  Bring back
                </button>
                <div className="my-1 h-px bg-[var(--border)]" />
              </>
            ) : null}
            {shortcuts.map((shortcut) => (
              <button
                key={shortcut.label}
                type="button"
                data-testid={shortcut.testId}
                onClick={() => choose(shortcut.date)}
                className="flex items-center justify-between rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[13px] hover:bg-[var(--surface-hover)] text-left"
              >
                <span>{shortcut.label}</span>
                <span className="text-[11.5px] text-[var(--fg-subtle)]">
                  {showDay(shortcut.date)}
                </span>
              </button>
            ))}
            <div className="my-1 h-px bg-[var(--border)]" />
            <input
              type="date"
              min={tomorrow}
              value={fieldValue}
              aria-label="Snooze until"
              data-testid="snooze-date"
              onChange={(e) => {
                const next = e.target.value;
                if (!parseDateOnly(next) || next < tomorrowDate()) return;
                choose(next);
              }}
              className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] text-[var(--fg)]"
            />
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}
