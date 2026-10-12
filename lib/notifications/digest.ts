import type { Effort, Lifecycle, PriorityBucket, Task } from "@/lib/domain/types";
import { addDays, localTime } from "./schedule";

/**
 * Digest composition.
 *
 * Pure functions from a user's tasks plus a moment and a zone to a digest
 * object; the email templates and push payloads render those objects.
 * Nothing here touches the database or a provider, so the cron route
 * today — and a Workflow step later — can call them unchanged.
 *
 * Dates: `Task.due` is a day-precision `YYYY-MM-DD` string meaning "that
 * calendar day for the user", so "overdue" and "due today" are plain
 * string comparisons against the user's local date key. No `Date` parsing,
 * so the server's zone never leaks in.
 */

export type DueState = "overdue" | "today" | "upcoming" | null;

export interface DigestTask {
  id: string;
  title: string;
  nextAction: string | null;
  lifecycle: Lifecycle;
  effort: Effort;
  priorityBucket: PriorityBucket;
  due: string | null;
  dueState: DueState;
  /** Deep link into the app. */
  url: string;
}

/**
 * "While you were away": what autonomous execution finished, drafted, or
 * parked on a decision since the last digest. Phase 3 fills this from the
 * `executions` table; until then `composeAwaySection` returns null and the
 * templates render nothing for it.
 */
export interface AwaySection {
  done: DigestTask[];
  drafted: DigestTask[];
  waiting: DigestTask[];
}

export interface DigestInput {
  tasks: Task[];
  now: Date;
  timeZone: string;
  name: string;
  appUrl: string;
}

export interface MorningPlan {
  kind: "morning_plan";
  name: string;
  /** Local date key the plan is for. */
  dateKey: string;
  /** "Monday, October 12" in the user's zone. */
  dateLabel: string;
  overdue: DigestTask[];
  dueToday: DigestTask[];
  /** Today-view members that are not already listed under due/overdue. */
  today: DigestTask[];
  /** Focus (active) tasks not already shown above. */
  focus: DigestTask[];
  inboxCount: number;
  away: AwaySection | null;
  appUrl: string;
}

export interface DueReminder {
  kind: "due_reminder";
  name: string;
  dateKey: string;
  overdue: DigestTask[];
  dueToday: DigestTask[];
  appUrl: string;
}

export interface WeeklyReview {
  kind: "weekly_review";
  name: string;
  weekKey: string;
  /** Local date range label, e.g. "Oct 5 – Oct 11". */
  rangeLabel: string;
  completed: DigestTask[];
  completedCount: number;
  overdue: DigestTask[];
  /** Open tasks due in the next 7 local days, soonest first. */
  upcoming: DigestTask[];
  inboxCount: number;
  focusCount: number;
  waitingCount: number;
  appUrl: string;
}

export type Digest = MorningPlan | DueReminder | WeeklyReview;

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag: string;
}

const OPEN: ReadonlySet<Lifecycle> = new Set(["inbox", "active", "waiting"]);

export function dueState(due: string | null, dateKey: string): DueState {
  if (!due) return null;
  if (due < dateKey) return "overdue";
  if (due === dateKey) return "today";
  return "upcoming";
}

/** Same membership rule as the Today view (`lib/store/selectors.ts`), zone-aware. */
export function isTodayTask(t: Task, dateKey: string): boolean {
  const state = dueState(t.due, dateKey);
  const dueForces = state === "overdue" || state === "today";
  if (t.lifecycle === "inbox" || t.lifecycle === "active") {
    return dueForces || t.priorityBucket === "do_now";
  }
  if (t.lifecycle === "waiting") return dueForces;
  return false;
}

const DUE_RANK: Record<Exclude<DueState, null>, number> = { overdue: 0, today: 1, upcoming: 2 };

/** Overdue first (oldest first), then due today, then by combined priority. */
export function compareForDigest(dateKey: string) {
  return (a: Task, b: Task): number => {
    const sa = dueState(a.due, dateKey);
    const sb = dueState(b.due, dateKey);
    const ra = sa ? DUE_RANK[sa] : 3;
    const rb = sb ? DUE_RANK[sb] : 3;
    if (ra !== rb) return ra - rb;
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    const pa = a.urgency + a.importance;
    const pb = b.urgency + b.importance;
    if (pa !== pb) return pb - pa;
    return a.title.localeCompare(b.title);
  };
}

export function toDigestTask(t: Task, dateKey: string, appUrl: string): DigestTask {
  return {
    id: t.id,
    title: t.title,
    nextAction: t.nextAction,
    lifecycle: t.lifecycle,
    effort: t.effort,
    priorityBucket: t.priorityBucket,
    due: t.due,
    dueState: dueState(t.due, dateKey),
    url: `${appUrl}/today?task=${encodeURIComponent(t.id)}`,
  };
}

export function composeAwaySection(_input: DigestInput): AwaySection | null {
  return null;
}

function openTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => OPEN.has(t.lifecycle));
}

/**
 * Morning plan. Null when there is nothing to say (no open task is due,
 * overdue, on Today, or in Focus) — a quiet morning gets no email.
 */
export function composeMorningPlan(input: DigestInput): MorningPlan | null {
  const { dateKey } = localTime(input.now, input.timeZone);
  const cmp = compareForDigest(dateKey);
  const open = openTasks(input.tasks).sort(cmp);
  const convert = (t: Task) => toDigestTask(t, dateKey, input.appUrl);

  const overdue = open.filter((t) => dueState(t.due, dateKey) === "overdue");
  const dueToday = open.filter((t) => dueState(t.due, dateKey) === "today");
  const shown = new Set([...overdue, ...dueToday].map((t) => t.id));
  const today = open.filter((t) => !shown.has(t.id) && isTodayTask(t, dateKey));
  for (const t of today) shown.add(t.id);
  const focus = open.filter((t) => !shown.has(t.id) && t.lifecycle === "active");
  const inboxCount = open.filter((t) => t.lifecycle === "inbox").length;
  const away = composeAwaySection(input);

  const empty =
    overdue.length + dueToday.length + today.length + focus.length === 0 && away === null;
  if (empty) return null;

  return {
    kind: "morning_plan",
    name: input.name,
    dateKey,
    dateLabel: formatDateKey(dateKey, { weekday: "long", month: "long", day: "numeric" }),
    overdue: overdue.map(convert),
    dueToday: dueToday.map(convert),
    today: today.map(convert),
    focus: focus.map(convert),
    inboxCount,
    away,
    appUrl: input.appUrl,
  };
}

/** Afternoon nudge: only what is still open and due today or overdue. */
export function composeDueReminder(input: DigestInput): DueReminder | null {
  const { dateKey } = localTime(input.now, input.timeZone);
  const open = openTasks(input.tasks).sort(compareForDigest(dateKey));
  const overdue = open.filter((t) => dueState(t.due, dateKey) === "overdue");
  const dueToday = open.filter((t) => dueState(t.due, dateKey) === "today");
  if (overdue.length + dueToday.length === 0) return null;
  const convert = (t: Task) => toDigestTask(t, dateKey, input.appUrl);
  return {
    kind: "due_reminder",
    name: input.name,
    dateKey,
    overdue: overdue.map(convert),
    dueToday: dueToday.map(convert),
    appUrl: input.appUrl,
  };
}

/**
 * Weekly review: the 7 local days ending yesterday for completions (the
 * range `rangeLabel` prints), what slipped, and the 7 days starting today
 * for what is coming. Null when the account is entirely idle.
 */
export function composeWeeklyReview(input: DigestInput): WeeklyReview | null {
  const local = localTime(input.now, input.timeZone);
  const { dateKey } = local;
  const weekAgoKey = addDays(dateKey, -7);
  const horizonKey = addDays(dateKey, 7);
  const convert = (t: Task) => toDigestTask(t, dateKey, input.appUrl);

  const completed = input.tasks
    .filter((t) => {
      if (t.lifecycle !== "done" || !t.completedAt) return false;
      const doneKey = localTime(new Date(t.completedAt), input.timeZone).dateKey;
      return doneKey >= weekAgoKey && doneKey < dateKey;
    })
    .sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1));

  const open = openTasks(input.tasks).sort(compareForDigest(dateKey));
  const overdue = open.filter((t) => dueState(t.due, dateKey) === "overdue");
  const upcoming = open.filter((t) => t.due !== null && t.due >= dateKey && t.due < horizonKey);
  const inboxCount = open.filter((t) => t.lifecycle === "inbox").length;
  const focusCount = open.filter((t) => t.lifecycle === "active").length;
  const waitingCount = open.filter((t) => t.lifecycle === "waiting").length;

  if (completed.length + open.length === 0) return null;

  return {
    kind: "weekly_review",
    name: input.name,
    weekKey: local.weekKey,
    rangeLabel: `${formatDateKey(weekAgoKey, { month: "short", day: "numeric" })} – ${formatDateKey(
      addDays(dateKey, -1),
      { month: "short", day: "numeric" },
    )}`,
    completed: completed.map(convert),
    completedCount: completed.length,
    overdue: overdue.map(convert),
    upcoming: upcoming.map(convert),
    inboxCount,
    focusCount,
    waitingCount,
    appUrl: input.appUrl,
  };
}

/** Short form for a notification banner; the email carries the detail. */
export function pushPayloadFor(digest: Digest): PushPayload {
  switch (digest.kind) {
    case "morning_plan": {
      const due = digest.overdue.length + digest.dueToday.length;
      const total = due + digest.today.length + digest.focus.length;
      const lead = digest.overdue[0] ?? digest.dueToday[0] ?? digest.today[0] ?? digest.focus[0];
      const parts: string[] = [];
      if (digest.overdue.length) parts.push(plural(digest.overdue.length, "overdue"));
      if (digest.dueToday.length) parts.push(`${digest.dueToday.length} due today`);
      const summary = parts.length ? parts.join(", ") : `${plural(total, "task")} on your plate`;
      return {
        title: "Your plan for today",
        body: lead ? `${summary}. First up: ${lead.title}` : summary,
        url: `${digest.appUrl}/today`,
        tag: `morning-plan-${digest.dateKey}`,
      };
    }
    case "due_reminder": {
      const parts: string[] = [];
      if (digest.overdue.length) parts.push(plural(digest.overdue.length, "overdue"));
      if (digest.dueToday.length) parts.push(`${digest.dueToday.length} still due today`);
      const lead = digest.dueToday[0] ?? digest.overdue[0];
      return {
        title: digest.dueToday.length ? "Still due today" : "Overdue",
        body: lead ? `${parts.join(", ")}. ${lead.title}` : parts.join(", "),
        url: `${digest.appUrl}/today`,
        tag: `due-reminder-${digest.dateKey}`,
      };
    }
    case "weekly_review": {
      const bits = [`${plural(digest.completedCount, "task")} done`];
      if (digest.overdue.length) bits.push(plural(digest.overdue.length, "overdue"));
      if (digest.upcoming.length) bits.push(`${digest.upcoming.length} due this week`);
      return {
        title: "Your week in review",
        body: bits.join(" · "),
        url: `${digest.appUrl}/today`,
        tag: `weekly-review-${digest.weekKey}`,
      };
    }
  }
}

function plural(n: number, noun: string): string {
  if (noun === "overdue") return `${n} overdue`;
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Render a `YYYY-MM-DD` key as a date label without any zone conversion. */
export function formatDateKey(dateKey: string, opts: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}
