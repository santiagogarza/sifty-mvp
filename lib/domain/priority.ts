import { dayDelta, parseDay } from "@/lib/utils/dates";
import type { PriorityBucket } from "./types";

/**
 * Map (urgency, importance) scalars in [0,1] to a bucket.
 *
 * The thresholds are intentionally asymmetric: importance has a slightly
 * lower bar than urgency, which encourages the app to surface meaningful
 * work over reactive work. Tweakable later.
 */
export function bucketFromScalars(urgency: number, importance: number): PriorityBucket {
  const u = clamp01(urgency);
  const i = clamp01(importance);
  const isUrgent = u >= 0.6;
  const isImportant = i >= 0.55;
  if (isUrgent && isImportant) return "do_now";
  if (!isUrgent && isImportant) return "schedule";
  if (isUrgent && !isImportant) return "delegate";
  return "drop";
}

export function bucketLabel(bucket: PriorityBucket): string {
  switch (bucket) {
    case "do_now":
      return "Do now";
    case "schedule":
      return "Schedule";
    case "delegate":
      return "Delegate";
    case "drop":
      // Deliberately not "Drop or someday": that phrasing collides with the
      // Dropped/Someday statuses and reads like an action.
      return "Low priority";
    case "unset":
      return "Unset";
  }
}

/**
 * What the priority pill says. Two axes, named plainly (SIF-14, D11): the
 * Eisenhower verbs ("Do now", "Delegate") read as actions and collided with
 * the statuses, and a bare "Both"/"Neither" needs the matrix to decode.
 */
export function priorityPillLabel(bucket: PriorityBucket): string {
  switch (bucket) {
    case "do_now":
      return "Urgent + important";
    case "schedule":
      return "Important";
    case "delegate":
      return "Urgent";
    case "drop":
      return "Low priority";
    case "unset":
      return "Not ranked";
  }
}

/** One line for the pill's tooltip: what the two axes say about this task. */
export function priorityPillHint(bucket: PriorityBucket): string {
  switch (bucket) {
    case "do_now":
      return "Urgent and important — your ball, today.";
    case "schedule":
      return "Important but not urgent — worth scheduling before it becomes urgent.";
    case "delegate":
      return "Urgent but not important — do quickly, hand off, or question it.";
    case "drop":
      return "Neither urgent nor important right now.";
    case "unset":
      return "Sifty has not ranked this yet.";
  }
}

export function bucketTone(bucket: PriorityBucket): "ember" | "mist" | "sage" | "neutral" {
  switch (bucket) {
    case "do_now":
      return "ember";
    case "schedule":
      return "mist";
    case "delegate":
      return "sage";
    default:
      return "neutral";
  }
}

/**
 * Sort key for "what should I look at first."
 *
 * Lower number = sort earlier. Combines bucket order, due-date proximity,
 * and importance so list ordering feels intuitive without a literal
 * 4-quadrant matrix on the page.
 */
export function focusScore(args: {
  bucket: PriorityBucket;
  importance: number;
  urgency: number;
  due: string | null;
  now?: Date;
}): number {
  const now = args.now ?? new Date();
  const bucketWeight: Record<PriorityBucket, number> = {
    do_now: 0,
    schedule: 1,
    delegate: 2,
    drop: 3,
    unset: 2.5,
  };
  let score = bucketWeight[args.bucket] * 1000;
  if (args.due) {
    // Whole calendar days, so a task due today is "today" all day long and
    // only yesterday and earlier count as overdue — the same rule the
    // Overdue/Today badges use.
    const days = dayDelta(parseDay(args.due), now);
    if (days < 0)
      score -= 500; // overdue rises
    else score += days;
  } else {
    score += 50;
  }
  score -= args.importance * 30;
  score -= args.urgency * 10;
  return score;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
