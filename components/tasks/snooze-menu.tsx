"use client";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  SNOOZE_PRESETS,
  formatSnoozeDate,
  isSnoozed,
  isValidSnoozeDate,
  snoozeDateFor,
} from "@/lib/domain/snooze";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { useToday } from "@/lib/store/use-today";
import { cn } from "@/lib/utils/cn";
import { AlarmClockOff, CalendarDays, ChevronLeft } from "lucide-react";
import * as React from "react";

export type SnoozeMenuMode = "menu" | "date";

const itemClass = cn(
  "flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] px-2.5 py-1.5",
  "text-left text-[13px] text-[var(--fg)] hover:bg-[var(--surface-hover)]",
  "focus-visible:outline-none focus-visible:bg-[var(--surface-hover)]",
);

/**
 * Popover body shared by the row and the detail sheet: three presets with
 * their resolved day, a custom date, and Unsnooze when already snoozed.
 * `onDone` fires after any change so the host can close its popover.
 */
export function SnoozeMenu({
  task,
  initialMode = "menu",
  onDone,
}: {
  task: Task;
  initialMode?: SnoozeMenuMode;
  onDone?: (until: string | null) => void;
}) {
  const snoozeTask = useStore((s) => s.snoozeTask);
  const now = useToday();
  const [mode, setMode] = React.useState<SnoozeMenuMode>(initialMode);
  const snoozed = isSnoozed(task, now);

  const apply = (until: string | null) => {
    snoozeTask(task.id, until);
    onDone?.(until);
  };

  if (mode === "date") {
    return (
      <SnoozeDatePicker
        initial={snoozed ? task.snoozedUntil : null}
        now={now}
        onBack={initialMode === "menu" ? () => setMode("menu") : undefined}
        onPick={apply}
      />
    );
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const preset = SNOOZE_PRESETS.find((p) => p.key.toLowerCase() === key);
    if (preset) {
      e.preventDefault();
      apply(snoozeDateFor(preset.id, now));
    } else if (key === "d") {
      e.preventDefault();
      setMode("date");
    }
  };

  return (
    <div className="flex min-w-[240px] flex-col" onKeyDown={onKeyDown}>
      <div className="text-eyebrow px-2.5 pt-1 pb-1.5">Snooze until</div>
      {SNOOZE_PRESETS.map((preset) => {
        const until = snoozeDateFor(preset.id, now);
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => apply(until)}
            className={cn(itemClass, task.snoozedUntil === until && "bg-[var(--surface-hover)]")}
          >
            <span>{preset.label}</span>
            <span className="flex items-center gap-2 text-[11.5px] text-[var(--fg-subtle)]">
              {formatSnoozeDate(until)}
              <Kbd className="!h-4 !min-w-4 text-[10px]">{preset.key}</Kbd>
            </span>
          </button>
        );
      })}
      <button type="button" onClick={() => setMode("date")} className={itemClass}>
        <span className="flex items-center gap-1.5">
          <CalendarDays size={12} className="text-[var(--fg-muted)]" />
          Pick a date…
        </span>
        <Kbd className="!h-4 !min-w-4 text-[10px]">D</Kbd>
      </button>
      {snoozed ? (
        <>
          <div className="my-1 h-px bg-[var(--border)]" />
          <button
            type="button"
            onClick={() => apply(null)}
            className={cn(itemClass, "text-[var(--fg-muted)]")}
          >
            <span className="flex items-center gap-1.5">
              <AlarmClockOff size={12} />
              Unsnooze
            </span>
          </button>
        </>
      ) : null}
    </div>
  );
}

function SnoozeDatePicker({
  initial,
  now,
  onBack,
  onPick,
}: {
  initial: string | null;
  now: Date;
  onBack?: () => void;
  onPick: (until: string) => void;
}) {
  const min = snoozeDateFor("tomorrow", now);
  const [draft, setDraft] = React.useState(initial ?? min);
  const valid = isValidSnoozeDate(draft, now);

  const commit = () => {
    if (valid) onPick(draft);
  };

  return (
    <div className="flex min-w-[240px] flex-col gap-2 p-1">
      <div className="flex items-center gap-1">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to snooze presets"
            className="rounded-[var(--radius-sm)] p-0.5 text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
          >
            <ChevronLeft size={14} />
          </button>
        ) : null}
        <span className="text-eyebrow">Snooze until</span>
      </div>
      <input
        // biome-ignore lint/a11y/noAutofocus: the picker opens on demand, so the date field is the only sensible focus target.
        autoFocus
        type="date"
        min={min}
        value={draft}
        aria-label="Wake day"
        aria-invalid={!valid}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        className={cn(
          "rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2.5 py-1.5 text-[13px] text-[var(--fg)]",
          valid ? "border-[var(--border-strong)]" : "border-[var(--warn)]",
        )}
      />
      {!valid ? <p className="text-[11.5px] text-[var(--warn)]">Pick a day after today.</p> : null}
      <Button size="sm" variant="primary" onClick={commit} disabled={!valid}>
        Snooze until {valid ? formatSnoozeDate(draft) : "…"}
      </Button>
    </div>
  );
}
