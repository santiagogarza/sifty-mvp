"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { defaultRecurrence, hasInstanceEdits } from "@/lib/domain/recurrence";
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
import { useTranslations } from "next-intl";
import * as React from "react";
import { useRecurrenceCopy, useWeekdayName } from "./task-copy";

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
  const t = useTranslations("taskDetail.recurrence");
  const { describe } = useRecurrenceCopy();
  const rule = task.recurrence;

  const anchor = task.due ?? toLocalIsoDate(new Date());

  const pickFreq = (freq: RecurrenceFreq | null) => {
    if (!freq) {
      setRecurrence(task.id, null);
      return;
    }
    // Clicking the frequency already in force keeps its chosen days / day.
    if (rule?.freq === freq) return;
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
            {rule ? describe(rule) : t("none")}
          </span>
          {rule && (instanceScope || hasInstanceEdits(rule)) ? (
            <span className="text-[11px] text-[var(--accent)]">
              {instanceScope ? t("editingInstance") : t("hasInstanceEdits")}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      {/* The weekly editor is tall; on a short window it scrolls inside the
          space Radix leaves it instead of running off the bottom. */}
      <PopoverContent
        align="start"
        collisionPadding={8}
        className="w-[300px] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto"
      >
        <div className="flex flex-col gap-0.5">
          <OptionButton selected={!rule} onClick={() => pickFreq(null)}>
            {t("none")}
          </OptionButton>
          {RECURRENCE_FREQ.map((freq) => (
            <OptionButton key={freq} selected={rule?.freq === freq} onClick={() => pickFreq(freq)}>
              {t(`freq.${freq}`)}
            </OptionButton>
          ))}
        </div>

        {rule?.freq === "weekly" && rule.mode === "fixed" ? (
          <>
            <Divider />
            <div className="text-eyebrow mb-1.5">{t("on")}</div>
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
              <span>{t("onDay")}</span>
              <DayOfMonthInput
                value={rule.dayOfMonth ?? 1}
                onChange={(dayOfMonth) => update({ dayOfMonth })}
              />
            </div>
            <p className="mt-1 text-[11.5px] leading-[1.45] text-[var(--fg-subtle)]">
              {t("shorterMonths")}
            </p>
          </>
        ) : null}

        {rule ? (
          <>
            <Divider />
            <div className="text-eyebrow mb-1.5">{t("schedule")}</div>
            <ModeOption
              selected={rule.mode === "fixed"}
              onClick={() => update({ mode: "fixed" })}
              label={t("fixed")}
              hint={t("fixedHint")}
            />
            <ModeOption
              selected={rule.mode === "after_completion"}
              onClick={() => update({ mode: "after_completion" })}
              label={t("afterCompletion")}
              hint={t("afterCompletionHint")}
            />
            <Divider />
            <div className="text-eyebrow mb-1.5">{t("editsApplyTo")}</div>
            <div
              role="radiogroup"
              aria-label={t("editsApplyTo")}
              className="grid grid-cols-2 gap-1 rounded-[var(--radius-md)] bg-[var(--surface-muted)] p-1"
            >
              <ScopeOption
                selected={!instanceScope}
                onClick={() => setEditScope(task.id, "series")}
              >
                {t("allFuture")}
              </ScopeOption>
              <ScopeOption
                selected={instanceScope}
                onClick={() => setEditScope(task.id, "instance")}
              >
                {t("thisInstance")}
              </ScopeOption>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-[1.45] text-[var(--fg-subtle)]">
              {instanceScope ? t("instanceScopeHint") : t("seriesScopeHint")}
            </p>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

function WeekdayToggles({
  value,
  onChange,
}: {
  value: number[];
  onChange: (days: number[]) => void;
}) {
  const t = useTranslations("taskDetail.recurrence");
  const weekday = useWeekdayName();
  const toggle = (day: number) => {
    const has = value.includes(day);
    // Never leave a weekly rule with no day: the last one stays on.
    if (has && value.length === 1) return;
    onChange(has ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b));
  };
  return (
    <div className="flex gap-1" role="group" aria-label={t("daysOfWeek")}>
      {WEEKDAY_ORDER.map((day) => {
        const on = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            aria-label={weekday(day, "long")}
            onClick={() => toggle(day)}
            className={cn(
              "size-8 rounded-full text-[12px] font-medium transition-colors",
              on
                ? "bg-[var(--fg)] text-[var(--bg)]"
                : "bg-[var(--surface-muted)] text-[var(--fg-muted)] hover:bg-[var(--surface-hover)]",
            )}
          >
            {weekday(day, "narrow")}
          </button>
        );
      })}
    </div>
  );
}

/** Drafts locally so clearing the field to retype does not snap back to the stored day. */
function DayOfMonthInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const t = useTranslations("taskDetail.recurrence");
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
      aria-label={t("dayOfMonth")}
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
