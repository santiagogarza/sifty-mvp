import type { Repos } from "@/lib/db/repos";
import type { DailyPlanRecord, DailyPlanTrigger, EntitlementSnapshot } from "@/lib/db/repos/types";
import type { Task, UserProfile } from "@/lib/domain/types";
import { type AiAdmission, canRunAi, deriveEntitlement } from "@/lib/entitlements/entitlements";
import { reportError } from "@/lib/observability/report-error";
import { addDaysToKey, dayKeyInTimeZone, hourInTimeZone } from "@/lib/utils/dates";
import { dailyPlan } from "@/lib/workflows/daily-plan";
import { startWorkflow } from "@/lib/workflows/dispatch";
import type { DailyPlanInput } from "./execute";
import { DAILY_PLAN_PROMPT_VERSION, DAILY_PLAN_STAGE } from "./stage";
import { resolveUserTimeZone } from "./timezone";

/**
 * Admission and hand-off for `dailyPlan` runs — the nightly cron walk and
 * the manual "Re-plan today" share one gate:
 *
 *   caps.dailyPlan → siftsPerDay (one plan = one sift) → reserve the
 *   `prioritize` billing row → claim the `daily_plans` row (atomic per
 *   user: one running plan, one cron plan per local day) → `start()`.
 *
 * The claim is what makes a cron rerun idempotent and what the Today page
 * polls; a run that cannot be started flips its rows to `failed` so
 * nothing hangs in `running` and nothing is billed.
 */

export type EnqueuePlanResult =
  | { ok: true; plan: DailyPlanRecord; runId: string }
  | { ok: false; reason: "not_entitled" }
  | { ok: false; reason: "cap"; admission: Extract<AiAdmission, { ok: false }> }
  | { ok: false; reason: "already_running"; plan: DailyPlanRecord }
  /** Cron only: this local day already has a plan. */
  | { ok: false; reason: "already_planned" }
  | { ok: false; reason: "not_started"; plan: DailyPlanRecord };

export const PLAN_NOT_STARTED_MESSAGE = "Planning could not start — try again.";

/** After this local hour the nightly run plans tomorrow, not the day that is ending. */
export const NIGHTLY_CUTOVER_HOUR = 18;

/** Which local day a plan is for. */
export function planDateFor(now: Date, timeZone: string, trigger: DailyPlanTrigger): string {
  const today = dayKeyInTimeZone(now, timeZone);
  if (trigger === "manual") return today;
  return hourInTimeZone(now, timeZone) >= NIGHTLY_CUTOVER_HOUR ? addDaysToKey(today, 1) : today;
}

export async function enqueueDailyPlan(args: {
  repos: Repos;
  user: UserProfile;
  snapshot: EntitlementSnapshot | null;
  trigger: DailyPlanTrigger;
  /** IANA zone; resolved from preferences when omitted. */
  timeZone?: string;
  modelPreference: string | null;
  offline: boolean;
  now?: Date;
}): Promise<EnqueuePlanResult> {
  const { repos, user } = args;
  const now = args.now ?? new Date();

  const siftsToday = await repos.aiRuns.countSucceededToday(user.id, now);
  const entitlement = deriveEntitlement({
    profile: user,
    snapshot: args.snapshot,
    siftsToday,
    now,
  });
  if (!entitlement.caps.dailyPlan) return { ok: false, reason: "not_entitled" };
  const admission = canRunAi(entitlement);
  if (!admission.ok) return { ok: false, reason: "cap", admission };

  // The billing row is reserved before anything else is visible, so the
  // next request's cap count already includes this plan. The decide step
  // completes the same row with the model's usage; it is flipped to
  // `failed` (not counted) if the claim loses or the run cannot start.
  const reserved = await repos.aiRuns.insert({
    userId: user.id,
    taskId: null,
    promptVersion: DAILY_PLAN_PROMPT_VERSION,
    stage: DAILY_PLAN_STAGE,
    model: RESERVED_MODEL,
    transport: "workflow",
    status: "succeeded",
    durationMs: 0,
    inputTokens: null,
    outputTokens: null,
    costCents: 0,
    offline: args.offline,
    error: null,
  });
  const release = (message: string) =>
    repos.aiRuns.setStatus(user.id, reserved.id, "failed", message);

  const timeZone = args.timeZone ?? (await resolveUserTimeZone(repos, user.id));
  const planDate = planDateFor(now, timeZone, args.trigger);
  let claim: Awaited<ReturnType<typeof repos.dailyPlans.claim>>;
  try {
    claim = await repos.dailyPlans.claim(
      {
        userId: user.id,
        planDate,
        timezone: timeZone,
        trigger: args.trigger,
        aiRunId: reserved.id,
      },
      now,
    );
  } catch (err) {
    // A claim that throws (connection, lock) must not leave the user charged.
    await release("claim failed").catch(() => undefined);
    throw err;
  }
  if (!claim.ok) {
    await release(claim.reason === "running" ? "superseded by a running plan" : "already planned");
    return claim.reason === "running"
      ? { ok: false, reason: "already_running", plan: claim.plan }
      : { ok: false, reason: "already_planned" };
  }
  const plan = claim.plan;

  const input: DailyPlanInput = {
    userId: user.id,
    planId: plan.id,
    aiRunId: reserved.id,
    planDate,
    timeZone,
    trigger: args.trigger,
    modelPreference: args.modelPreference,
    offline: args.offline,
  };
  try {
    const { runId } = await startWorkflow(dailyPlan, [input]);
    const started =
      (await repos.dailyPlans.update(user.id, plan.id, { workflowRunId: runId })) ?? plan;
    return { ok: true, plan: started, runId };
  } catch (err) {
    reportError(err, { area: "plan.enqueue", userId: user.id, tags: { planId: plan.id } });
    await release(PLAN_NOT_STARTED_MESSAGE);
    const failed =
      (await repos.dailyPlans.update(user.id, plan.id, {
        status: "failed",
        error: PLAN_NOT_STARTED_MESSAGE,
        finishedAt: now.toISOString(),
      })) ?? plan;
    return { ok: false, reason: "not_started", plan: failed };
  }
}

/** `ai_runs.model` of a reserved plan row until the model answers. */
export const RESERVED_MODEL = "sifty.workflow";

// ---------------------------------------------------------------------------
// Nightly walk
// ---------------------------------------------------------------------------

/** Accounts whose open tasks were last touched longer ago than this skip the night. */
export const IDLE_AFTER_DAYS = 30;

const OPEN_LIFECYCLES: readonly Task["lifecycle"][] = ["inbox", "active", "waiting"];

export interface NightlyPlanResult {
  /** Accounts examined. */
  users: number;
  enqueued: number;
  skipped: {
    notEntitled: number;
    cap: number;
    idle: number;
    alreadyPlanned: number;
    alreadyRunning: number;
  };
  failed: number;
  /** Stopped on `timeBudgetMs` or `maxUsers` before the last account. */
  truncated: boolean;
}

export interface NightlyPlanOptions {
  now?: Date;
  pageSize?: number;
  maxUsers?: number;
  /** Wall-clock budget; keep it under the route's `maxDuration`. */
  timeBudgetMs?: number;
  offline: boolean;
}

const DEFAULT_TIME_BUDGET_MS = 45_000;

export async function enqueueNightlyPlans(
  repos: Repos,
  opts: NightlyPlanOptions,
): Promise<NightlyPlanResult> {
  const now = opts.now ?? new Date();
  const pageSize = opts.pageSize ?? 100;
  const maxUsers = opts.maxUsers ?? 5_000;
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const startedAt = Date.now();
  const result: NightlyPlanResult = {
    users: 0,
    enqueued: 0,
    skipped: { notEntitled: 0, cap: 0, idle: 0, alreadyPlanned: 0, alreadyRunning: 0 },
    failed: 0,
    truncated: false,
  };

  let cursor: string | undefined;
  walk: while (true) {
    const page = await repos.users.list(pageSize, cursor);
    if (page.length === 0) break;
    for (const user of page) {
      if (result.users >= maxUsers || Date.now() - startedAt > timeBudgetMs) {
        result.truncated = true;
        break walk;
      }
      result.users += 1;
      cursor = user.id;

      // Cheapest checks first: the cap, then one bounded read for activity.
      const snapshot = await repos.entitlements.get(user.id);
      if (!deriveEntitlement({ profile: user, snapshot, now }).caps.dailyPlan) {
        result.skipped.notEntitled += 1;
        continue;
      }
      const [newest] = await repos.tasks.list(user.id, { lifecycles: OPEN_LIFECYCLES, limit: 1 });
      if (!newest || now.getTime() - Date.parse(newest.updatedAt) > IDLE_AFTER_DAYS * 86_400_000) {
        result.skipped.idle += 1;
        continue;
      }

      const outcome = await enqueueDailyPlan({
        repos,
        user,
        snapshot,
        trigger: "cron",
        modelPreference: null,
        offline: opts.offline,
        now,
      });
      if (outcome.ok) result.enqueued += 1;
      else if (outcome.reason === "cap") result.skipped.cap += 1;
      else if (outcome.reason === "already_planned") result.skipped.alreadyPlanned += 1;
      else if (outcome.reason === "already_running") result.skipped.alreadyRunning += 1;
      else if (outcome.reason === "not_entitled") result.skipped.notEntitled += 1;
      else result.failed += 1;
    }
    if (page.length < pageSize) break;
  }

  if (result.truncated) {
    reportError(new Error("nightly plan run stopped before reaching every user"), {
      area: "plan.nightly",
      tags: { users: result.users, elapsedMs: Date.now() - startedAt },
    });
  }
  return result;
}
