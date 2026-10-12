import { id as makeId } from "@/lib/utils/ids";
import { bucketFromScalars } from "./priority";
import { toLocalIsoDate } from "./snooze";
import {
  type Lifecycle,
  type Recurrence,
  type RecurrenceFreq,
  SERIES_FIELDS,
  type SeriesField,
  type SeriesValues,
  type Subtask,
  type Task,
  type TaskEditableField,
} from "./types";

/**
 * Recurrence rules (decision D11, SIF-24): daily, weekdays, weekly on
 * chosen days, monthly on a day; each either on a fixed schedule or
 * repeating after completion. All date math is day-precision on
 * `YYYY-MM-DD` strings via local `Date` fields, so it gives the same answer
 * in the browser and on a UTC server, and DST never shifts a day.
 */

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const RECURRENCE_FREQ_LABELS: Record<RecurrenceFreq, string> = {
  daily: "Daily",
  weekdays: "Weekdays",
  weekly: "Weekly",
  monthly: "Monthly",
};

/** A sensible rule for `freq`, anchored on the task's due day (or today). */
export function defaultRecurrence(freq: RecurrenceFreq, anchorIso: string): Recurrence {
  const anchor = parseIsoDay(anchorIso);
  switch (freq) {
    case "weekly":
      return { freq, mode: "fixed", weekdays: [anchor.getDay()] };
    case "monthly":
      return { freq, mode: "fixed", dayOfMonth: anchor.getDate() };
    default:
      return { freq, mode: "fixed" };
  }
}

/** "Weekly on Mon, Thu", "Monthly on the 15th", "Daily · after completion". */
export function describeRecurrence(rule: Recurrence): string {
  let base: string = RECURRENCE_FREQ_LABELS[rule.freq];
  // Chosen days only steer a fixed schedule; after completion the period counts.
  if (rule.mode === "after_completion") return `${base} · after completion`;
  if (rule.freq === "weekly") {
    const days = sortedWeekdays(rule.weekdays);
    if (days.length > 0 && days.length < 7) {
      base = `Weekly on ${days.map((d) => WEEKDAY_SHORT[d]).join(", ")}`;
    }
  } else if (rule.freq === "monthly" && rule.dayOfMonth) {
    base = `Monthly on the ${ordinal(rule.dayOfMonth)}`;
  }
  return base;
}

/** Short form for list rows: "Repeats weekly on Mon, Thu". */
export function recurrenceTitle(rule: Recurrence): string {
  return `Repeats ${describeRecurrence(rule).replace(/^./, (c) => c.toLowerCase())}`;
}

/**
 * The due day of the next instance.
 *
 * - `after_completion`: one period after `completedOn`.
 * - `fixed`: the first scheduled day strictly after the later of the
 *   current due and `completedOn`. Anchoring on the due keeps an early
 *   completion from doubling up; taking the later day means a late
 *   completion never spawns an instance in the past (and skipping weeks
 *   never builds a backlog of missed copies).
 */
export function nextDueDate(
  rule: Recurrence,
  anchor: { due: string | null; completedOn: string },
): string {
  if (rule.mode === "after_completion") {
    const from = parseIsoDay(anchor.completedOn);
    switch (rule.freq) {
      case "daily":
        return toLocalIsoDate(addDays(from, 1));
      case "weekdays":
        return toLocalIsoDate(nextWeekdayAfter(from));
      case "weekly":
        return toLocalIsoDate(addDays(from, 7));
      case "monthly":
        return toLocalIsoDate(addMonthsClamped(from, 1, from.getDate()));
    }
  }
  const dueDay = anchor.due ? parseIsoDay(anchor.due) : null;
  const completed = parseIsoDay(anchor.completedOn);
  const from = dueDay && dueDay.getTime() > completed.getTime() ? dueDay : completed;
  switch (rule.freq) {
    case "daily":
      return toLocalIsoDate(addDays(from, 1));
    case "weekdays":
      return toLocalIsoDate(nextWeekdayAfter(from));
    case "weekly": {
      const days = sortedWeekdays(rule.weekdays);
      if (days.length === 0) return toLocalIsoDate(addDays(from, 7));
      for (let step = 1; step <= 7; step++) {
        const candidate = addDays(from, step);
        if (days.includes(candidate.getDay())) return toLocalIsoDate(candidate);
      }
      return toLocalIsoDate(addDays(from, 7));
    }
    case "monthly": {
      const day = rule.dayOfMonth ?? from.getDate();
      const thisMonth = clampedDay(from.getFullYear(), from.getMonth(), day);
      if (thisMonth.getTime() > from.getTime()) return toLocalIsoDate(thisMonth);
      return toLocalIsoDate(clampedDay(from.getFullYear(), from.getMonth() + 1, day));
    }
  }
}

/**
 * The next instance, as a create input plus the patch that fills it. A
 * copy of the parent with the series values restored over any
 * instance-only edits, subtasks unchecked with fresh ids, the schedule's
 * due (protected from re-sift), and the parent's sift output carried over
 * so no AI run is spent. Pure: the caller persists it.
 */
export function buildNextInstance(
  parent: Task,
  opts: {
    id: string;
    completedOn: string;
    lifecycle: Lifecycle;
    /**
     * The successor must be sifted afresh (the parent never finished its
     * own sift, or was still waiting on a question). It is created
     * `pending` so the completion path, or a retry of it, enqueues the run.
     */
    needsSift?: boolean;
  },
): {
  create: { id: string; sourceText: string; sourceContext: string | null };
  patch: Partial<Task>;
  editedFields: TaskEditableField[];
} {
  const rule = parent.recurrence;
  if (!rule) throw new Error("buildNextInstance: parent has no recurrence");
  const series = rule.seriesValues ?? {};
  const pick = <K extends SeriesField>(field: K): Task[K] =>
    (field in series ? series[field] : parent[field]) as Task[K];

  const urgency = pick("urgency");
  const importance = pick("importance");
  const priorityBucket =
    "priorityBucket" in series
      ? pick("priorityBucket")
      : "urgency" in series || "importance" in series
        ? bucketFromScalars(urgency, importance)
        : parent.priorityBucket;

  const { seriesValues: _dropped, ...cleanRule } = rule;
  const patch: Partial<Task> = {
    title: pick("title"),
    description: pick("description"),
    nextAction: pick("nextAction"),
    lifecycle: opts.lifecycle,
    // A sifted parent's copy is already organized. Anything else is owed a
    // sift and says so (`pending`), so a failed or crashed enqueue is
    // retried by the next completion attempt instead of leaving it idle.
    aiStatus: parent.aiStatus === "ready" && !opts.needsSift ? "ready" : "pending",
    aiError: null,
    urgency,
    importance,
    priorityBucket,
    effort: pick("effort"),
    due: nextDueDate(rule, { due: parent.due, completedOn: opts.completedOn }),
    delegationCandidate: pick("delegationCandidate"),
    assigneeName: pick("assigneeName"),
    confidence: parent.confidence,
    clarifyingQuestion: null,
    rationale: parent.rationale,
    labelIds: [...pick("labelIds")],
    subtasks: pick("subtasks").map(
      (st, order): Subtask => ({ id: makeId("st"), title: st.title, done: false, order }),
    ),
    plan: parent.plan,
    recurrence: cleanRule,
    seriesId: parent.seriesId ?? parent.id,
  };
  return {
    create: { id: opts.id, sourceText: parent.sourceText, sourceContext: parent.sourceContext },
    patch,
    editedFields: Array.from(new Set<TaskEditableField>([...parent.editedFields, "due"])),
  };
}

export type EditScope = "series" | "instance";

/**
 * Bookkeeping for "this instance only" edits. Returns the recurrence to
 * store after `keys` of the task change under `scope`, or undefined when
 * nothing about it changes.
 *
 * - `instance`: the first instance-only edit of a field parks the current
 *   (series) value in `seriesValues`; later edits leave it there.
 * - `series`: an edit to a field makes the new value the series value, so
 *   its parked entry is dropped.
 */
export function recurrenceAfterEdit(
  task: Pick<Task, "recurrence"> & SeriesValues,
  keys: readonly string[],
  scope: EditScope,
): Recurrence | undefined {
  const rule = task.recurrence;
  if (!rule) return undefined;
  const fields = keys.filter((k): k is SeriesField =>
    (SERIES_FIELDS as readonly string[]).includes(k),
  );
  if (fields.length === 0) return undefined;
  const parked: SeriesValues = { ...(rule.seriesValues ?? {}) };
  let changed = false;
  for (const field of fields) {
    if (scope === "instance") {
      if (!(field in parked)) {
        (parked as Record<string, unknown>)[field] = task[field];
        changed = true;
      }
    } else if (field in parked) {
      delete (parked as Record<string, unknown>)[field];
      changed = true;
    }
  }
  if (!changed) return undefined;
  const { seriesValues: _old, ...rest } = rule;
  return Object.keys(parked).length ? { ...rest, seriesValues: parked } : rest;
}

/** True when any instance-only edit is parked on the task. */
export function hasInstanceEdits(rule: Recurrence | null): boolean {
  return !!rule?.seriesValues && Object.keys(rule.seriesValues).length > 0;
}

// ---------------------------------------------------------------------------

export function parseIsoDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

function clampedDay(year: number, monthIndex: number, day: number): Date {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(day, lastDay));
}

function addMonthsClamped(d: Date, n: number, day: number): Date {
  return clampedDay(d.getFullYear(), d.getMonth() + n, day);
}

function nextWeekdayAfter(d: Date): Date {
  let next = addDays(d, 1);
  while (next.getDay() === 0 || next.getDay() === 6) next = addDays(next, 1);
  return next;
}

function sortedWeekdays(days: number[] | undefined): number[] {
  return Array.from(new Set(days ?? []))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b);
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
