import { bucketFromScalars } from "@/lib/domain/priority";
import { isTodayTaskOnDay } from "@/lib/domain/today";
import { z } from "zod";
import type { PlanCandidate, PlanContext } from "./context";

/**
 * The daily plan's single model call: schema, prompt, prompt version, and
 * the deterministic offline variant. It runs as the `prioritize` stage
 * (same model route, same cost class) but across the list instead of one
 * task, so it carries its own prompt version.
 *
 * The model answers in aliases (`t1`, `t2`, …), never task ids: shorter
 * prompts, and a hallucinated handle maps to nothing instead of to a
 * random task.
 */

export const DAILY_PLAN_PROMPT_VERSION = "dailyplan.v1";
export const DAILY_PLAN_STAGE = "prioritize" as const;
export const DAILY_PLAN_TEMPERATURE = 0.2;

/** Most decisions one plan may carry; the apply step also caps promotions. */
export const MAX_PLAN_DECISIONS = 20;
/** Tasks the plan may pull into Today in one run (deadline-forced ones are free). */
export const MAX_TODAY_PROMOTIONS = 8;
/** Today should read as a day's work, not a backlog. */
export const TODAY_TARGET_SIZE = 7;

export const PlanDecision = z.object({
  alias: z.string().min(2).max(8),
  urgency: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  /** Short, concrete, names the signal: "due tomorrow, deep work". */
  reason: z.string().min(1).max(200),
});
export type PlanDecision = z.infer<typeof PlanDecision>;

export const DailyPlanOutput = z.object({
  /** One short paragraph the Today page shows: what the day is about. */
  summary: z.string().min(1).max(600),
  decisions: z.array(PlanDecision).max(MAX_PLAN_DECISIONS),
});
export type DailyPlanOutput = z.infer<typeof DailyPlanOutput>;

const STYLE = `Style:
- Be calm and concise. Verbs first. No emoji. No hype.
- Never invent dates, people, or context not present in the input.
- Output must conform to the supplied JSON schema exactly.`;

export function dailyPlanSystem(ctx: PlanContext): string {
  return `You plan one day for a user of Sifty, an AI productivity app.

${STYLE}

You see the user's open tasks ranked by deadline pressure, which ones are in
"Today" right now, what they finished recently, and their pinned preferences.
Today is a lens: a task is in it when it is overdue, due today, or scored
urgent AND important (urgency >= 0.60 and importance >= 0.55). Deadline-driven
tasks are in Today no matter what you do; you shape the rest through urgency
and importance scores in [0,1].

Decide, for the day ${ctx.planDate}:
- Pull in work that must start today to land on time (due tomorrow with medium
  or deep effort; important work with no deadline that keeps slipping) by
  raising urgency and importance above the thresholds.
- Push out tasks whose scores are inflated: nothing forces them today and
  several higher-stakes tasks come first. Lower urgency below 0.60.
- Keep Today at roughly ${TODAY_TARGET_SIZE} tasks or fewer. Leave everything else exactly as is —
  stability matters more than tidiness, so emit a decision only when it changes
  what the user will see.
- Never emit a decision for a task marked "user-set"; those scores are the
  user's and are protected anyway.
- Respect snoozes: a task due more than one day out was deliberately parked.
- Honour the user's preferences (for example, protect mornings for deep work
  by keeping Today's deep tasks few).

Each reason is at most twelve words, concrete, and names the signal:
"due tomorrow, deep work", "no deadline; 4 tasks due sooner",
"overdue 3 days, high importance". The summary is one or two sentences for
the morning: what to lead with and why.`;
}

export function dailyPlanUser(ctx: PlanContext): string {
  const lines = ctx.candidates.map(describeCandidate);
  const inToday = ctx.candidates.filter((c) => c.inToday).length;
  return [
    `Plan date: ${ctx.planDate} (${ctx.timeZone}).`,
    ctx.preferences.length ? `User preferences:\n- ${ctx.preferences.join("\n- ")}` : null,
    "",
    `Open tasks (${ctx.candidates.length} shown of ${ctx.considered}; ${inToday} currently in Today):`,
    ...lines,
    ctx.notShown > 0
      ? `… and ${ctx.notShown} more open tasks without near deadlines, not shown.`
      : null,
    "",
    ctx.recentCompletions.length
      ? `Recently completed:\n${ctx.recentCompletions
          .map((c) => `- ${c.title} (${c.effort}, ${c.completedAt.slice(0, 10)})`)
          .join("\n")}`
      : "Nothing completed recently.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function describeCandidate(c: PlanCandidate): string {
  const t = c.task;
  const due =
    c.daysUntilDue === null
      ? "no due date"
      : c.daysUntilDue < 0
        ? `overdue ${-c.daysUntilDue}d`
        : c.daysUntilDue === 0
          ? "due today"
          : c.daysUntilDue === 1
            ? "due tomorrow"
            : `due in ${c.daysUntilDue}d`;
  const flags = [
    c.inToday ? "TODAY" : null,
    c.protectedFields.length ? `user-set: ${c.protectedFields.join(", ")}` : null,
  ].filter(Boolean);
  return `${c.alias} [${t.lifecycle}] ${t.title} — ${due}; u${t.urgency.toFixed(2)} i${t.importance.toFixed(2)} ${t.effort}${
    flags.length ? ` (${flags.join("; ")})` : ""
  }`;
}

/**
 * Deterministic plan for `SIFTY_AI_OFFLINE=1` and tests. The same rules the
 * prompt describes, applied mechanically:
 *  - overdue / due today but scored low → raise so Focus sorts it first;
 *  - due tomorrow with medium or deep effort → pull in;
 *  - in Today only by score, due more than three days out → push out;
 *  - more than `TODAY_TARGET_SIZE` in Today → push out the score-only ones
 *    with the lowest importance until the target is met.
 * Protected candidates are never touched.
 */
export function offlineDailyPlan(ctx: PlanContext): DailyPlanOutput {
  const decisions: PlanDecision[] = [];
  const decided = new Set<string>();
  const decide = (c: PlanCandidate, urgency: number, importance: number, reason: string) => {
    if (decided.has(c.alias) || c.protectedFields.length) return;
    decided.add(c.alias);
    decisions.push({ alias: c.alias, urgency, importance, reason });
  };
  const scoreOnly = (c: PlanCandidate) =>
    c.inToday && (c.daysUntilDue === null || c.daysUntilDue > 0);

  let todaySize = ctx.candidates.filter((c) => c.inToday).length;

  for (const c of ctx.candidates) {
    const t = c.task;
    if (c.daysUntilDue !== null && c.daysUntilDue <= 0 && t.priorityBucket !== "do_now") {
      // Forced in by the date already; raise the scores so Focus sorts it up.
      decide(
        c,
        Math.max(t.urgency, 0.75),
        Math.max(t.importance, 0.6),
        c.daysUntilDue < 0 ? `overdue ${-c.daysUntilDue}d` : "due today",
      );
    } else if (
      !c.inToday &&
      c.daysUntilDue === 1 &&
      (t.effort === "medium" || t.effort === "deep")
    ) {
      decide(
        c,
        Math.max(t.urgency, 0.7),
        Math.max(t.importance, 0.6),
        `due tomorrow, ${t.effort} work`,
      );
      todaySize += 1;
    } else if (scoreOnly(c) && c.daysUntilDue !== null && c.daysUntilDue > 3) {
      decide(
        c,
        Math.min(t.urgency, 0.45),
        t.importance,
        `due in ${c.daysUntilDue}d; nothing forces it today`,
      );
      todaySize -= 1;
    }
  }

  if (todaySize > TODAY_TARGET_SIZE) {
    const demotable = ctx.candidates
      .filter((c) => scoreOnly(c) && !decided.has(c.alias) && !c.protectedFields.length)
      .sort((a, b) => a.task.importance - b.task.importance || a.task.urgency - b.task.urgency);
    for (const c of demotable) {
      if (todaySize <= TODAY_TARGET_SIZE) break;
      decide(
        c,
        Math.min(c.task.urgency, 0.45),
        c.task.importance,
        `Today is full; ${TODAY_TARGET_SIZE} higher-stakes tasks come first`,
      );
      todaySize -= 1;
    }
  }

  const lead = ctx.candidates.find((c) => {
    const after = decisions.find((d) => d.alias === c.alias);
    const bucket = after
      ? bucketFromScalars(after.urgency, after.importance)
      : c.task.priorityBucket;
    return isTodayTaskOnDay({ ...c.task, priorityBucket: bucket }, ctx.planDate);
  });
  const summary = lead
    ? `${Math.max(todaySize, 1)} ${todaySize === 1 ? "task" : "tasks"} in Today. Lead with "${lead.task.title}".`
    : "Nothing is forcing today. Pick one meaningful task from Focus and start there.";

  return DailyPlanOutput.parse({ summary, decisions: decisions.slice(0, MAX_PLAN_DECISIONS) });
}
