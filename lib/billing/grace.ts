import type { Repos } from "@/lib/db/repos/types";
import { isGraceActive, withResolvedTier } from "@/lib/entitlements/entitlements";
import { reportError } from "@/lib/observability/report-error";

/**
 * Close dunning grace periods that have run out.
 *
 * Readers already resolve an expired grace to `free` on their own (grace is
 * time-based in `resolveTier`), so this job only persists that outcome:
 * it clears `graceEndsAt` and rewrites the cached `tier`. Safe to run from
 * a cron as often as you like, and safe to run twice: a cleared row is not
 * selected again, and the locked `update()` means a webhook landing in the
 * same instant (payment recovered) is not clobbered.
 */
export interface ExpireGraceResult {
  /** Users whose grace was closed; they are now `free` unless another fact applies. */
  expired: string[];
  /** Users re-checked but left alone (recovered, extended, or deleted in between). */
  skipped: string[];
  failed: string[];
}

export async function expireGracePeriods(
  repos: Repos,
  now: Date = new Date(),
  limit = 500,
): Promise<ExpireGraceResult> {
  const result: ExpireGraceResult = { expired: [], skipped: [], failed: [] };
  const userIds = await repos.entitlements.listExpiredGracePeriods(now, limit);
  for (const userId of userIds) {
    try {
      let outcome: "expired" | "skipped" = "skipped";
      await repos.entitlements.update(userId, (current) => {
        // The row vanished between the listing and the lock (account
        // deleted); writing anything back would resurrect it.
        if (!current) throw new RowGone();
        // A concurrent write already closed or extended the window.
        if (!current.graceEndsAt || isGraceActive(current.graceEndsAt, now)) return current;
        outcome = "expired";
        if (current.tier === "creator") return { ...current, graceEndsAt: null };
        return withResolvedTier({ ...current, graceEndsAt: null }, false, now);
      });
      result[outcome].push(userId);
    } catch (err) {
      if (err instanceof RowGone) {
        result.skipped.push(userId);
        continue;
      }
      result.failed.push(userId);
      reportError(err, { area: "billing.grace", tags: { userId } });
    }
  }
  return result;
}

class RowGone extends Error {}
