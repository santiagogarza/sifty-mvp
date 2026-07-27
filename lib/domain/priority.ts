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
    const due = new Date(args.due).getTime();
    const days = (due - now.getTime()) / (24 * 60 * 60 * 1000);
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
