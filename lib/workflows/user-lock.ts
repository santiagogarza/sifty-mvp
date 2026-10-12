import { createHook } from "workflow";

/**
 * Per-user concurrency for workflow runs.
 *
 * Vercel Workflow has no built-in concurrency key, but hook tokens are
 * globally unique while a run holds them, so a token doubles as a lock. A
 * run claims one of `slots` tokens for `${scope}:${userId}`; by default the
 * hook is never disposed, so the token is released when the run ends
 * (completed, failed, or cancelled). When every slot is taken the run
 * suspends on the owners' `returnValue` (no compute while waiting) and
 * tries again.
 *
 * The returned slot can be released early with `release()`: a run that is
 * about to suspend on a human (a clarifying question) must not keep a
 * slot for days, or two unanswered questions would block every new sift
 * for that user. Re-acquire before doing more work.
 *
 * Call this from a `"use workflow"` function before its first step: a step
 * started in the same tick as the hook registration can run before the
 * conflict is known.
 */
export interface UserSlot {
  release(): void;
}

export async function acquireUserSlot(
  scope: string,
  userId: string,
  slots: number,
): Promise<UserSlot> {
  for (let round = 0; ; round += 1) {
    const owners: Array<Promise<unknown>> = [];
    for (let slot = 0; slot < slots; slot += 1) {
      const hook = createHook<never>({ token: `${scope}:${userId}:${slot}` });
      const conflict = await hook.getConflict();
      if (!conflict) {
        console.log(`[workflow] ${scope}: slot ${slot} acquired for ${userId} (round ${round})`);
        return { release: () => hook.dispose() };
      }
      // A failed owner still releases the token; the error itself is theirs.
      owners.push(conflict.returnValue.catch(() => undefined));
    }
    console.log(`[workflow] ${scope}: all ${slots} slots busy for ${userId}, waiting`);
    await Promise.race(owners);
  }
}
