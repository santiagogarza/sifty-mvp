"use client";

import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { showToast } from "@/components/ui/toast";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  SNOOZE_PRESETS,
  type SnoozePreset,
  formatSnoozeTime,
  isSnoozed,
  resolveSnooze,
  snoozeFromDateInput,
  snoozePresetLabel,
} from "@/lib/utils/snooze";
import * as React from "react";

const PRESET_KEYS: Record<SnoozePreset, string> = { tomorrow: "t", next_week: "w" };

/** Snooze a task until `until` (null clears it), confirming with an Undo toast. */
export function setTaskSnooze(taskId: string, until: Date | null): void {
  const { tasks, updateTask } = useStore.getState();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const previous = task.snoozedUntil;
  updateTask(taskId, { snoozedUntil: until?.toISOString() ?? null });
  showToast({
    message: until ? `Snoozed until ${formatSnoozeTime(until)}` : "Snooze cleared",
    onUndo: () => useStore.getState().updateTask(taskId, { snoozedUntil: previous }),
  });
}

export function snoozeTask(taskId: string, preset: SnoozePreset): void {
  setTaskSnooze(taskId, resolveSnooze(preset, new Date(), useStore.getState().snoozeMorningHour));
}

export function SnoozePicker({ task, children }: { task: Task; children: React.ReactNode }) {
  const morningHour = useStore((s) => s.snoozeMorningHour);
  const [open, setOpen] = React.useState(false);
  // Resolved on open so labels never go stale while the sheet sits idle.
  const now = React.useMemo(() => (open ? new Date() : new Date(0)), [open]);
  const snoozed = isSnoozed(task);

  const apply = (until: Date | null) => {
    setTaskSnooze(task.id, until);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const preset = SNOOZE_PRESETS.find((p) => PRESET_KEYS[p] === e.key);
    if (!preset) return;
    e.preventDefault();
    apply(resolveSnooze(preset, new Date(), morningHour));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" onKeyDown={onKeyDown} aria-label="Snooze">
        <div className="flex flex-col gap-1 min-w-[240px]">
          {SNOOZE_PRESETS.map((preset) => {
            const resolved = formatSnoozeTime(resolveSnooze(preset, now, morningHour));
            const label = snoozePresetLabel(preset);
            return (
              <button
                key={preset}
                type="button"
                aria-label={`${label} - ${resolved}`}
                onClick={() => apply(resolveSnooze(preset, new Date(), morningHour))}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left",
                  "hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:bg-[var(--surface-hover)]",
                )}
              >
                <span className="flex flex-col">
                  <span className="text-[13px] text-[var(--fg)]">{label}</span>
                  <span className="text-[11.5px] text-[var(--fg-subtle)]">{resolved}</span>
                </span>
                <Kbd aria-hidden>{PRESET_KEYS[preset]}</Kbd>
              </button>
            );
          })}
          <div className="my-1 h-px bg-[var(--border)]" />
          <Input
            type="date"
            aria-label="Snooze until date"
            onChange={(e) => {
              const until = snoozeFromDateInput(e.target.value, morningHour);
              // Typing a year digit by digit emits valid-but-past dates first.
              if (until && until.getTime() > Date.now()) apply(until);
            }}
            className="h-8 rounded-[var(--radius-sm)] px-2.5 text-[13px]"
          />
          {snoozed ? (
            <button
              type="button"
              onClick={() => apply(null)}
              className="rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[12.5px] text-[var(--fg-muted)] hover:bg-[var(--surface-hover)]"
            >
              Unsnooze
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
