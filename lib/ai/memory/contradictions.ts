import type { Task, TaskEditableField } from "@/lib/domain/types";
import type { SiftContradiction } from "./extract";

/**
 * Which fields of a PATCH reverse what the sift wrote.
 *
 * A contradiction is a user edit, on a task the pipeline has finished
 * (`ready`, with a sift), to an AI-owned field the user had not edited
 * before — the first time they override Sifty's call on that field. Later
 * edits to the same field are the user's own business and never trigger
 * extraction again (the field is in `editedFields` by then).
 */

/** Fields whose reversal says something about the user, not the task's text. */
const SIGNAL_FIELDS: readonly TaskEditableField[] = [
  "urgency",
  "importance",
  "effort",
  "due",
  "delegationCandidate",
  "labelIds",
];

export function detectContradictions(
  before: Task,
  patch: Partial<Task>,
  editedFields: readonly TaskEditableField[] | undefined,
): SiftContradiction[] {
  if (before.aiStatus !== "ready" || !before.siftId || !editedFields?.length) return [];
  const out: SiftContradiction[] = [];
  for (const field of editedFields) {
    if (!SIGNAL_FIELDS.includes(field)) continue;
    if (before.editedFields.includes(field)) continue;
    if (!(field in patch)) continue;
    const aiValue = before[field];
    const userValue = patch[field];
    if (same(aiValue, userValue)) continue;
    out.push({ field, aiValue, userValue });
  }
  return out;
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.005;
  return a === b;
}
