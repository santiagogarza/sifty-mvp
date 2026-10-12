"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  RECURRENCE_FREQ_LABELS,
  defaultRecurrence,
  describeRecurrence,
  hasInstanceEdits,
} from "@/lib/domain/recurrence";
import { toLocalIsoDate } from "@/lib/domain/snooze";
import {
  RECURRENCE_FREQ,
  type Recurrence,
  type RecurrenceFreq,
  type Task,
} from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { Check, Repeat } from "lucide-react";
import * as React from "react";

/**
 * Repeat rule for the detail sheet: a one-line summary that opens the
 * editor. Frequency first (the decision people make), then only the
 * controls that frequency needs (progressive disclosure), then the
 * schedule mode. "Edits apply to" appears once the task repeats.
 */
export function RecurrenceRow({ task }: { task: Task }) {
  const setRecurrence = useStore((s) => s.setRecurrence);
  const instanceScope = useStore((s) => !!s.instanceScope[task.id]);
  const setEditScope = useStore((s) => s.setEditScope);
  const rule = task.recurrence;

  const anchor = task.due ?? toLocalIsoDate(new Date());

  const pickFreq = (freq: RecurrenceFreq | null) => {
    if (!freq) {
      setRecurrence(task.id, null);
      return;
    }
    const next = defaultRecurrence(freq, anchor);
    // Keep the mode and any parked instance edits across a frequency change.
    setRecurrence(task.id, {
      ...next,
      mode: rule?.mode ?? next.mode,
      ...(rule?.seriesValues ? { seriesValues: rule.seriesValues } : {}),
    });
  };

  const update = (patch: Partial<Recurrence>) => {
    if (rule) setRecurrence(task.id, { ...rule, ...patch });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="recurrence-row"
          className={cn(
            "flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]",
            "px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--surface-hover)]",
          )}
        >
          <Repeat
            size={13}
            className={cn(rule ? "text-[var(--fg-muted)]" : "text-[var(--fg-subtle)]")}
          />
          <span
            className={cn("flex-1 truncate", rule ? "text-[var(--fg)]" : "text-[var(--fg-subtle)]")}
          >
            {rule ? describeRecurrence(rule) : "Doesn't repeat"}
          </span>
          {rule && (instanceScope || hasInstanceEdits(rule)) ? (
            <span className="text-[11px] text-[var(--accent)]">
              {instanceScope ? "Editing this instance" : "Has instance edits"}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px]">
        <div className="flex flex-col gap-0.5">
          <OptionButton selected={!rule} onClick={() => pickFreq(null)}>
            Doesn't repeat
          </OptionButton>
          {RECURRENCE_FREQ.map((freq) => (
            <OptionButton key={freq} selected={rule?.freq === freq} onClick={() => pickFreq(freq)}>
              {RECURRENCE_FREQ_LABELS[freq]}
            </OptionButton>
          ))}
        </div>

        {rule?.freq === "weekly" && rule.mode === "fixed" ? (
          <>
            <Divider />
            <div className="text-eyebrow mb-1.5">On</div>
            <WeekdayToggles
              value={rule.weekdays ?? []}
              onChange={(weekdays) => update({ weekdays })}
            />
          </>
        ) : null}

        {rule?.freq === "monthly" && rule.mode === "fixed" ? (
          <>
            <Divider />
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span>On day</span>
              <DayOfMonthInput
                value={rule.dayOfMonth ?? 1}
                onChange={(dayOfMonth) => update({ dayOfMonth })}
              />
            </div>
            <p className="mt-1 text-[11.5px] leading-[1.45] text-[var(--fg-subtle)]">
              Shorter months use their last day.
            </p>
          </>
        ) : null}

        {rule ? (
          <>
            <Divider />
            <div className="text-eyebrow mb-1.5">Schedule</div>
            <ModeOption
              selected={rule.mode === "fixed"}
              onClick={() => update({ mode: "fixed" })}
              label="Fixed schedule"
              hint="The next one keeps the calendar, however early or late this one is done."
            />
            <ModeOption
              selected={rule.mode === "after_completion"}
              onClick={() => update({ mode: "after_completion" })}
              label="After completion"
              hint="The next one is due one period after the day you finish this one."
            />
            <Divider />
            <div className="text-eyebrow mb-1.5">Edits apply to</div>
            <div
              role="radiogroup"
              aria-label="Edits apply to"
              className="grid grid-cols-2 gap-1 rounded-[var(--radius-md)] bg-[var(--surface-muted)] p-1"
            >
              <ScopeOption
                selected={!instanceScope}
                onClick={() => setEditScope(task.id, "series")}
              >
                All future
              </ScopeOption>
              <ScopeOption
                selected={instanceScope}
                onClick={() => setEditScope(task.id, "instance")}
              >
                This instance
              </ScopeOption>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-[1.45] text-[var(--fg-subtle)]">
              {instanceScope
                ? "Changes to the title, next action, priority, labels, and subtasks stay on this one; the next instance keeps the series' values."
                : "Changes to this task carry over to every future instance."}
            </p>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const WEEKDAY_LETTER: Record<number, string> = {
  0: "S",
  1: "M",
  2: "T",
  3: "W",
  4: "T",
  5: "F",
  6: "S",
};
const WEEKDAY_NAME: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

function WeekdayToggles({
  value,
  onChange,
}: {
  value: number[];
  onChange: (days: number[]) => void;
}) {
  const toggle = (day: number) => {
    const has = value.includes(day);
    // Never leave a weekly rule with no day: the last one stays on.
    if (has && value.length === 1) return;
    onChange(has ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b));
  };
  return (
    <div className="flex gap-1" role="group" aria-label="Days of the week">
      {WEEKDAY_ORDER.map((day) => {
        const on = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            aria-label={WEEKDAY_NAME[day]}
            onClick={() => toggle(day)}
            className={cn(
              "size-8 rounded-full text-[12px] font-medium transition-colors",
              on
                ? "bg-[var(--fg)] text-[var(--bg)]"
                : "bg-[var(--surface-muted)] text-[var(--fg-muted)] hover:bg-[var(--surface-hover)]",
            )}
          >
            {WEEKDAY_LETTER[day]}
          </button>
        );
      })}
    </div>
  );
}

/** Drafts locally so clearing the field to retype does not snap back to the stored day. */
function DayOfMonthInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => {
    setDraft(String(value));
  }, [value]);
  return (
    <input
      type="number"
      min={1}
      max={31}
      inputMode="numeric"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (Number.isInteger(n) && n >= 1 && n <= 31) onChange(n);
      }}
      onBlur={() => setDraft(String(value))}
      aria-label="Day of month"
      className="w-16 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-[13px] text-num text-[var(--fg)]"
    />
  );
}

function OptionButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex items-center justify-between rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--surface-hover)]",
        selected && "bg-[var(--surface-hover)]",
      )}
    >
      <span>{children}</span>
      {selected ? <Check size={13} className="text-[var(--fg-muted)]" /> : null}
    </button>
  );
}

function ModeOption({
  selected,
  onClick,
  label,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left hover:bg-[var(--surface-hover)]",
        selected && "bg-[var(--surface-hover)]",
      )}
    >
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] text-[var(--fg)]">{label}</span>
        <span className="block text-[11.5px] leading-[1.4] text-[var(--fg-subtle)]">{hint}</span>
      </span>
      {selected ? <Check size={13} className="mt-[3px] text-[var(--fg-muted)]" /> : null}
    </button>
  );
}

function ScopeOption({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "rounded-[var(--radius-sm)] px-2 py-1 text-[12.5px] transition-colors",
        selected
          ? "bg-[var(--bg-elevated)] text-[var(--fg)] shadow-sm"
          : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="my-2 h-px bg-[var(--border)]" />;
}
