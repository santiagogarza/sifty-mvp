import { dayKeyDelta, dayKeyInTimeZone, toDateOnly } from "@/lib/utils/dates";
import { isSnoozed } from "./snooze";
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
 * Pure and zone-free. Snooze is not part of this day rule: `isTodayTaskAt`
 * applies the 8:00 wake on top, and that is what the client and the daily
 * plan both call so a snoozed task is out of Today on either side.
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

/**
 * Today membership at a moment. Hidden until 8:00 local on `snoozeUntil`
 * (`timeZone` on the server, the browser zone when omitted), then the
 * day rule in `isTodayTaskOnDay`.
 */
export function isTodayTaskAt(
  t: Pick<Task, "lifecycle" | "due" | "priorityBucket" | "snoozeUntil">,
  now: Date,
  timeZone?: string,
): boolean {
  if (isSnoozed(t, now, timeZone)) return false;
  const dayKey = timeZone ? dayKeyInTimeZone(now, timeZone) : toDateOnly(now);
  return isTodayTaskOnDay(t, dayKey);
}
