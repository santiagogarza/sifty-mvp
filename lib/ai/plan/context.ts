import type { Repos } from "@/lib/db/repos";
import { AI_CONTEXT_LIMITS } from "@/lib/domain/limits";
import { isTodayTaskOnDay } from "@/lib/domain/today";
import type { Task } from "@/lib/domain/types";
import { addDaysToKey, dayKeyDelta } from "@/lib/utils/dates";

/**
 * What the daily plan looks at, read within fixed bounds.
 *
 * A user with hundreds of open tasks must cost the same as one with ten:
 * two bounded queries (everything with a deadline inside the horizon,
 * soonest first; then the most recently touched open tasks) are merged,
 * ranked deterministically, and only the top `PLAN_CANDIDATES` go to the
 * model. Everything else is summarized as a count. Tasks mid-sift are left
 * out — their own `prioritize` stage is about to score them.
 */

export const PLAN_READ_LIMITS = {
  /** Open tasks due within the horizon, soonest first. */
  deadline: 100,
  /** Most recently updated open tasks. */
  recent: 150,
  /** Done tasks, newest first — the user's recent momentum. */
  completions: 15,
  preferences: AI_CONTEXT_LIMITS.maxPreferences,
} as const;

/** Days ahead a due date still counts as "deadline-driven" for the read. */
export const DEADLINE_HORIZON_DAYS = 7;

/** How many ranked tasks the model sees. */
export const PLAN_CANDIDATES = 60;

const OPEN_LIFECYCLES: readonly Task["lifecycle"][] = ["inbox", "active", "waiting"];

export type ProtectedPriorityField = "urgency" | "importance" | "priorityBucket";

export interface PlanCandidate {
  task: Task;
  /** Short handle the prompt uses instead of the id (`t1`, `t2`, …). */
  alias: string;
  /** In Today on `planDate`, before the plan runs. */
  inToday: boolean;
  /** Days from `planDate` to the due date; negative when overdue; null when undated. */
  daysUntilDue: number | null;
  /** Priority fields the user set by hand; the plan leaves them alone. */
  protectedFields: ProtectedPriorityField[];
}

export interface RecentCompletion {
  title: string;
  effort: Task["effort"];
  completedAt: string;
}

export interface PlanContext {
  planDate: string;
  timeZone: string;
  candidates: PlanCandidate[];
  /** Open tasks the bounded read returned (candidates + not shown). */
  considered: number;
  /** Open tasks read but not shown to the model. */
  notShown: number;
  recentCompletions: RecentCompletion[];
  preferences: string[];
}

export async function buildPlanContext(
  repos: Repos,
  userId: string,
  planDate: string,
  timeZone: string,
): Promise<PlanContext> {
  const horizon = addDaysToKey(planDate, DEADLINE_HORIZON_DAYS);
  const [deadline, recent, done, memories] = await Promise.all([
    repos.tasks.list(userId, {
      lifecycles: OPEN_LIFECYCLES,
      dueOnOrBefore: horizon,
      orderBy: "due",
      limit: PLAN_READ_LIMITS.deadline,
    }),
    repos.tasks.list(userId, { lifecycles: OPEN_LIFECYCLES, limit: PLAN_READ_LIMITS.recent }),
    repos.tasks.list(userId, { lifecycles: ["done"], limit: PLAN_READ_LIMITS.completions }),
    repos.memories.list(userId, { pinned: true, limit: PLAN_READ_LIMITS.preferences }),
  ]);

  const byId = new Map<string, Task>();
  for (const t of [...deadline, ...recent]) {
    if (t.aiStatus === "pending" || t.aiStatus === "running") continue;
    byId.set(t.id, t);
  }
  const open = Array.from(byId.values());
  const ranked = open
    .map((task) => ({ task, rank: candidateRank(task, planDate) }))
    .sort((a, b) => a.rank - b.rank || a.task.id.localeCompare(b.task.id))
    .slice(0, PLAN_CANDIDATES)
    .map(({ task }, i) => toCandidate(task, `t${i + 1}`, planDate));

  return {
    planDate,
    timeZone,
    candidates: ranked,
    considered: open.length,
    notShown: Math.max(0, open.length - ranked.length),
    recentCompletions: done
      .filter((t) => t.completedAt)
      .map((t) => ({ title: t.title, effort: t.effort, completedAt: t.completedAt as string })),
    preferences: memories.map((m) => m.text),
  };
}

export function toCandidate(task: Task, alias: string, planDate: string): PlanCandidate {
  return {
    task,
    alias,
    inToday: isTodayTaskOnDay(task, planDate),
    daysUntilDue: task.due ? dayKeyDelta(task.due, planDate) : null,
    protectedFields: (["urgency", "importance", "priorityBucket"] as const).filter((f) =>
      task.editedFields.includes(f),
    ),
  };
}

/**
 * Deterministic pre-ranking for the bounded prompt: lower sorts first.
 * Deadline pressure dominates, then the Eisenhower bucket, then what is
 * already in Focus — so the model always sees today's set and whatever
 * might join it, never a random slice of the backlog.
 */
export function candidateRank(task: Task, planDate: string): number {
  let rank = 0;
  if (task.due) {
    const days = dayKeyDelta(task.due, planDate);
    rank += days < 0 ? -500 + days : days * 10;
  } else {
    rank += 100;
  }
  if (task.priorityBucket === "do_now") rank -= 30;
  if (task.lifecycle === "active") rank -= 10;
  if (task.lifecycle === "waiting") rank += 30;
  rank -= task.importance * 30;
  rank -= task.urgency * 10;
  return rank;
}
