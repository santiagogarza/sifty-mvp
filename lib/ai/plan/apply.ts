import type { Repos } from "@/lib/db/repos";
import type { DailyPlanMove, DailyPlanMoveKind } from "@/lib/db/repos/types";
import { bucketFromScalars } from "@/lib/domain/priority";
import { isTodayTaskOnDay } from "@/lib/domain/today";
import type { Task } from "@/lib/domain/types";
import { toCandidate } from "./context";
import { describeMove } from "./public";
import { type DailyPlanOutput, MAX_TODAY_PROMOTIONS } from "./stage";

/**
 * Write a plan's decisions to the tasks, with the guards the model cannot
 * be trusted to keep:
 *
 *  - an alias resolves only to the task id it named in the prompt
 *    (`aliases`, carried from the decide step), never to a re-ranked list;
 *  - every guarded task is re-read by id right before the write:
 *    `editedFields` protection per field, snoozes (a task due more than a
 *    day out is never pulled into Today), tasks that vanished, started a
 *    sift, or left the open list (done, dropped, someday) since the model
 *    saw them;
 *  - at most `MAX_TODAY_PROMOTIONS` score-driven promotions per run,
 *    counted only when the write landed.
 *
 * Every applied change gets an explainable `task_events` row under a
 * deterministic id, and the task's `rationale` becomes the plan's reason.
 * A retried step finds its own event on a task it already moved and
 * reports the same move again instead of an empty list.
 */

export interface ApplyPlanTarget {
  planDate: string;
  /** Alias → task id from the prompt. */
  aliases: Record<string, string>;
}

export interface ApplyPlanResult {
  moves: DailyPlanMove[];
  /** Decisions that were dropped and why, for the run log. */
  skipped: Array<{ alias: string; why: string }>;
}

const EPSILON = 0.005;
const OPEN_LIFECYCLES: readonly Task["lifecycle"][] = ["inbox", "active", "waiting"];

export async function applyDailyPlan(
  repos: Repos,
  userId: string,
  target: ApplyPlanTarget,
  output: DailyPlanOutput,
  run: { planId: string },
): Promise<ApplyPlanResult> {
  const moves: DailyPlanMove[] = [];
  const skipped: ApplyPlanResult["skipped"] = [];
  const seen = new Set<string>();
  let promotions = 0;

  for (const decision of output.decisions) {
    const taskId = Object.hasOwn(target.aliases, decision.alias)
      ? target.aliases[decision.alias]
      : undefined;
    if (!taskId) {
      skipped.push({ alias: decision.alias, why: "unknown alias" });
      continue;
    }
    if (seen.has(taskId)) {
      skipped.push({ alias: decision.alias, why: "duplicate decision" });
      continue;
    }
    seen.add(taskId);

    const fresh = await repos.tasks.get(userId, taskId);
    if (!fresh) {
      skipped.push({ alias: decision.alias, why: "task gone" });
      continue;
    }
    if (fresh.aiStatus === "pending" || fresh.aiStatus === "running") {
      skipped.push({ alias: decision.alias, why: "sift in progress" });
      continue;
    }
    if (!OPEN_LIFECYCLES.includes(fresh.lifecycle)) {
      // Completed, dropped, or parked in Someday since the model saw it.
      skipped.push({ alias: decision.alias, why: `now ${fresh.lifecycle}` });
      continue;
    }
    const candidate = toCandidate(fresh, decision.alias, target.planDate);
    const eventId = `evt_${run.planId}_${taskId}`;

    const patch: Partial<Task> = {};
    const protect = (field: "urgency" | "importance" | "priorityBucket") =>
      candidate.protectedFields.includes(field);
    if (!protect("urgency") && Math.abs(decision.urgency - fresh.urgency) > EPSILON) {
      patch.urgency = decision.urgency;
    }
    if (!protect("importance") && Math.abs(decision.importance - fresh.importance) > EPSILON) {
      patch.importance = decision.importance;
    }
    if (patch.urgency === undefined && patch.importance === undefined) {
      // Already at these scores: either the model asked for no change, or
      // an earlier attempt of this step applied it. Report the latter.
      const earlier = await findOwnEvent(repos, userId, taskId, eventId);
      if (earlier) moves.push(earlier);
      else skipped.push({ alias: decision.alias, why: "no change (or user-set)" });
      continue;
    }

    const afterBucket = protect("priorityBucket")
      ? fresh.priorityBucket
      : bucketFromScalars(patch.urgency ?? fresh.urgency, patch.importance ?? fresh.importance);
    const wouldBeToday = isTodayTaskOnDay(
      { ...fresh, priorityBucket: afterBucket },
      target.planDate,
    );
    const entering = wouldBeToday && !candidate.inToday;
    if (entering && candidate.daysUntilDue !== null && candidate.daysUntilDue > 1) {
      skipped.push({ alias: decision.alias, why: `snoozed until ${fresh.due}` });
      continue;
    }
    if (entering && promotions >= MAX_TODAY_PROMOTIONS) {
      skipped.push({ alias: decision.alias, why: "Today promotion cap reached" });
      continue;
    }

    const kind: DailyPlanMoveKind = entering
      ? "moved_in"
      : !wouldBeToday && candidate.inToday
        ? "moved_out"
        : "rescored";
    const reason = decision.reason.trim();
    const message = describeMove(kind, reason);

    const updated = await repos.tasks.update(userId, taskId, { ...patch, rationale: message });
    if (!updated) {
      skipped.push({ alias: decision.alias, why: "task gone" });
      continue;
    }
    if (entering) promotions += 1;

    await repos.taskEvents.append(userId, {
      id: eventId,
      taskId,
      kind: `plan.${kind}`,
      payload: {
        planId: run.planId,
        planDate: target.planDate,
        message,
        reason,
        title: updated.title,
        before: {
          urgency: fresh.urgency,
          importance: fresh.importance,
          priorityBucket: fresh.priorityBucket,
        },
        after: {
          urgency: updated.urgency,
          importance: updated.importance,
          priorityBucket: updated.priorityBucket,
        },
      },
    });
    moves.push({ taskId, title: updated.title, kind, reason });
  }

  return { moves, skipped };
}

/** The move an earlier attempt of this plan recorded on the task, if any. */
async function findOwnEvent(
  repos: Repos,
  userId: string,
  taskId: string,
  eventId: string,
): Promise<DailyPlanMove | null> {
  const events = await repos.taskEvents.listForTask(userId, taskId, 10);
  const own = events.find((e) => e.id === eventId);
  if (!own) return null;
  const kind = own.kind.replace(/^plan\./, "") as DailyPlanMoveKind;
  return {
    taskId,
    title: String(own.payload.title ?? ""),
    kind,
    reason: String(own.payload.reason ?? ""),
  };
}
