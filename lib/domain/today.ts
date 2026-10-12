import { dayKeyDelta } from "@/lib/utils/dates";
import type { Task } from "./types";

/**
 * Today membership, on a given calendar day (`YYYY-MM-DD`):
 *  - Inbox/Focus tasks that are overdue, due that day, or read as urgent +
 *    important (`do_now`) — your ball, today.
 *  - Waiting-on tasks only when a deadline forces them (overdue/due today):
 *    the ball is elsewhere, but the date arrives regardless — chase it.
 *  - Someday never resurfaces (an explicit "not now"), and done/dropped
 *    are out of play.
 *
 * Pure and zone-free so the client (`lib/store/selectors.ts`, with the
 * browser's local day) and the daily plan (with the user's local day,
 * resolved server-side) agree on exactly the same set.
 */
export function isTodayTaskOnDay(
  t: Pick<Task, "lifecycle" | "due" | "priorityBucket">,
  dayKey: string,
): boolean {
  const dueForces = t.due !== null && dayKeyDelta(t.due, dayKey) <= 0;
  if (t.lifecycle === "inbox" || t.lifecycle === "active") {
    return dueForces || t.priorityBucket === "do_now";
  }
  if (t.lifecycle === "waiting") return dueForces;
  return false;
}
