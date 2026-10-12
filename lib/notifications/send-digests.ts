import type {
  DigestKind,
  NotificationChannel,
  NotificationPreferencesRecord,
  Repos,
} from "@/lib/db/repos/types";
import { appUrl as emailAppUrl, sendTemplate } from "@/lib/email/templates";
import { reportError } from "@/lib/observability/report-error";
import {
  type Digest,
  type DigestInput,
  composeDueReminder,
  composeMorningPlan,
  composeWeeklyReview,
  pushPayloadFor,
} from "./digest";
import { sendPushToUser } from "./push";
import { type DueDigest, dueDigests } from "./schedule";
import { unsubscribeUrl } from "./unsubscribe";

/**
 * One digest cycle: for every user with saved preferences, work out which
 * digests are due right now, claim each (user, kind, channel, period) in
 * the ledger, compose, and send. Pure composition lives in `digest.ts`;
 * this file is the orchestration a Workflow step will wrap later.
 *
 * Idempotency: `notificationSends.claim` is the only gate. A rerun in the
 * same hour, a second overlapping cron, or a crash after the send all
 * leave the ledger row in place, so nothing goes out twice; only a claim
 * left `pending` past its lease is taken over. A digest with nothing to
 * say is recorded as `skipped` for the period, which also stops every
 * later tick in the window from recomputing it.
 *
 * Time budget: the walk stops once `timeBudgetMs` is spent and reports
 * `truncated`. Users not reached are still inside their late window on
 * the next tick, so nothing is lost — it just arrives an hour later.
 */

export interface DigestRunResult {
  /** Preference rows examined. */
  users: number;
  sent: number;
  /** Nothing to say, channel unavailable, or already claimed by an earlier run. */
  skipped: number;
  failed: number;
  byKind: Record<DigestKind, { sent: number; skipped: number; failed: number }>;
  /** True when the run stopped on `timeBudgetMs` or `maxUsers` before the last user. */
  truncated: boolean;
}

export interface DigestRunOptions {
  now?: Date;
  /** Preference rows per page while walking users. */
  pageSize?: number;
  /** Hard cap on rows examined per run. */
  maxUsers?: number;
  /** Wall-clock budget; keep it under the route's `maxDuration`. */
  timeBudgetMs?: number;
  appUrl?: string;
}

const DEFAULT_TIME_BUDGET_MS = 45_000;

export async function sendDueDigests(
  repos: Repos,
  opts: DigestRunOptions = {},
): Promise<DigestRunResult> {
  const now = opts.now ?? new Date();
  const pageSize = opts.pageSize ?? 100;
  const maxUsers = opts.maxUsers ?? 5_000;
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const appUrl = opts.appUrl ?? emailAppUrl();
  const startedAt = Date.now();

  const result: DigestRunResult = {
    users: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    byKind: {
      morning_plan: { sent: 0, skipped: 0, failed: 0 },
      due_reminder: { sent: 0, skipped: 0, failed: 0 },
      weekly_review: { sent: 0, skipped: 0, failed: 0 },
    },
    truncated: false,
  };

  let cursor: string | undefined;
  walk: while (true) {
    const page = await repos.notificationPreferences.list(pageSize, cursor);
    if (page.length === 0) break;
    for (const prefs of page) {
      if (result.users >= maxUsers || Date.now() - startedAt > timeBudgetMs) {
        result.truncated = true;
        break walk;
      }
      result.users += 1;
      cursor = prefs.userId;
      const due = dueDigests(prefs, now);
      if (due.length === 0) continue;
      const channels = enabledChannels(prefs);
      if (channels.length === 0) continue;
      await deliverForUser(repos, prefs, due, channels, { now, appUrl }, result);
    }
    if (page.length < pageSize) break;
  }
  if (result.truncated) {
    reportError(new Error("digest run stopped before reaching every user"), {
      area: "notifications.digest",
      tags: { users: result.users, elapsedMs: Date.now() - startedAt },
    });
  }
  return result;
}

function enabledChannels(prefs: NotificationPreferencesRecord): NotificationChannel[] {
  const out: NotificationChannel[] = [];
  if (prefs.emailEnabled) out.push("email");
  if (prefs.pushEnabled) out.push("push");
  return out;
}

async function deliverForUser(
  repos: Repos,
  prefs: NotificationPreferencesRecord,
  due: DueDigest[],
  channels: NotificationChannel[],
  ctx: { now: Date; appUrl: string },
  result: DigestRunResult,
): Promise<void> {
  const userId = prefs.userId;
  // Tasks and the profile are loaded lazily and once per user: most users
  // on most ticks have nothing due, and a claimed-elsewhere period needs
  // neither.
  type Loaded = { input: DigestInput; email: string } | null;
  let loaded: Loaded | undefined;
  const load = async (): Promise<Loaded> => {
    if (loaded !== undefined) return loaded;
    const user = await repos.users.getById(userId);
    if (!user) {
      loaded = null;
      return null;
    }
    const tasks = await repos.tasks.list(userId);
    loaded = {
      email: user.email,
      input: {
        tasks,
        now: ctx.now,
        timeZone: prefs.timezone,
        name: user.displayName || user.email.split("@")[0] || "there",
        appUrl: ctx.appUrl,
      },
    };
    return loaded;
  };

  for (const { kind, periodKey } of due) {
    let digest: Digest | null | undefined;
    for (const channel of channels) {
      const claim = await repos.notificationSends.claim(
        { userId, kind, channel, periodKey },
        ctx.now,
      );
      if (!claim) {
        bump(result, kind, "skipped");
        continue;
      }
      try {
        const data = await load();
        if (digest === undefined) digest = data ? compose(kind, data.input) : null;
        if (!digest || !data) {
          await repos.notificationSends.finalize(claim.id, { status: "skipped" });
          bump(result, kind, "skipped");
          continue;
        }
        const outcome =
          channel === "email"
            ? await sendEmailDigest(digest, {
                to: data.email,
                userId,
                periodKey,
                appUrl: ctx.appUrl,
              })
            : await sendPushDigest(repos, digest, userId, ctx.now);
        await repos.notificationSends.finalize(claim.id, { status: outcome });
        bump(result, kind, outcome);
      } catch (err) {
        await repos.notificationSends
          .finalize(claim.id, { status: "failed", error: errorMessage(err) })
          .catch(() => undefined);
        bump(result, kind, "failed");
        reportError(err, {
          area: "notifications.digest",
          userId,
          tags: { kind, channel, periodKey },
        });
      }
    }
  }
}

function compose(kind: DigestKind, input: DigestInput): Digest | null {
  switch (kind) {
    case "morning_plan":
      return composeMorningPlan(input);
    case "due_reminder":
      return composeDueReminder(input);
    case "weekly_review":
      return composeWeeklyReview(input);
  }
}

async function sendEmailDigest(
  digest: Digest,
  args: { to: string; userId: string; periodKey: string; appUrl: string },
): Promise<"sent"> {
  const common = {
    unsubscribeUrl: unsubscribeUrl(args.appUrl, args.userId),
    settingsUrl: `${args.appUrl}/settings/notifications`,
  };
  const idempotencyKey = `digest:${digest.kind}:${args.userId}:${args.periodKey}`;
  switch (digest.kind) {
    case "morning_plan":
      await sendTemplate("digest-morning-plan", {
        to: args.to,
        props: { plan: digest, ...common },
        idempotencyKey,
      });
      break;
    case "due_reminder":
      await sendTemplate("digest-due-reminder", {
        to: args.to,
        props: { reminder: digest, ...common },
        idempotencyKey,
      });
      break;
    case "weekly_review":
      await sendTemplate("digest-weekly-review", {
        to: args.to,
        props: { review: digest, ...common },
        idempotencyKey,
      });
      break;
  }
  return "sent";
}

async function sendPushDigest(
  repos: Repos,
  digest: Digest,
  userId: string,
  now: Date,
): Promise<"sent" | "skipped" | "failed"> {
  const outcome = await sendPushToUser(repos, userId, pushPayloadFor(digest), now);
  if (outcome.status !== "sent") return "skipped";
  if (outcome.delivered > 0) return "sent";
  // Every endpoint was dead (removed) or errored (already reported).
  return outcome.failed > 0 ? "failed" : "skipped";
}

function bump(
  result: DigestRunResult,
  kind: DigestKind,
  outcome: "sent" | "skipped" | "failed",
): void {
  result[outcome] += 1;
  result.byKind[kind][outcome] += 1;
}

function errorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.slice(0, 500);
}
