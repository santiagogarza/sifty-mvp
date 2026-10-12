import { bucketFromScalars } from "@/lib/domain/priority";
import type { Task, TaskEditableField } from "@/lib/domain/types";
import type * as schema from "../schema";

type TaskColumns = Partial<typeof schema.tasks.$inferInsert>;

/**
 * Maps a domain patch onto the task row's columns, writing only what the
 * caller provided (plus the columns the server derives from it). A narrow
 * SET is what lets two devices — or a client edit and a server-side triage
 * result — touch different fields of the same row without one overwriting
 * the other with a stale snapshot.
 *
 * Derived columns:
 * - `editedFields` is the union of the stored set and `opts.editedFields`.
 * - `priorityBucket` is recomputed when urgency/importance move and the
 *   caller neither set the bucket nor protected it with a manual edit.
 * - `completedAt` follows `lifecycle` transitions into and out of `done`.
 */
export function taskPatchColumns(
  existing: Task,
  patch: Partial<Task>,
  opts: { editedFields?: TaskEditableField[]; now: Date },
): TaskColumns {
  const editedFields = opts.editedFields
    ? Array.from(new Set([...existing.editedFields, ...opts.editedFields]))
    : existing.editedFields;
  const columns: TaskColumns = { updatedAt: opts.now };
  if (opts.editedFields) columns.editedFields = editedFields;

  if ("title" in patch && patch.title !== undefined) columns.title = patch.title;
  if ("description" in patch) columns.description = patch.description ?? null;
  if ("sourceContext" in patch) columns.sourceContext = patch.sourceContext ?? null;
  if ("nextAction" in patch) columns.nextAction = patch.nextAction ?? null;
  if (patch.lifecycle !== undefined) columns.lifecycle = patch.lifecycle;
  if (patch.aiStatus !== undefined) columns.aiStatus = patch.aiStatus;
  if ("aiError" in patch) columns.aiError = patch.aiError ?? null;
  if (patch.aiAttempts !== undefined) columns.aiAttempts = patch.aiAttempts;
  if (patch.urgency !== undefined) columns.urgency = Math.round(patch.urgency * 100);
  if (patch.importance !== undefined) columns.importance = Math.round(patch.importance * 100);
  if (patch.priorityBucket !== undefined) columns.priorityBucket = patch.priorityBucket;
  if (patch.effort !== undefined) columns.effort = patch.effort;
  if ("due" in patch) columns.due = patch.due ?? null;
  if (patch.delegationCandidate !== undefined) {
    columns.delegationCandidate = patch.delegationCandidate;
  }
  if ("assigneeName" in patch) columns.assigneeName = patch.assigneeName ?? null;
  if (patch.confidence !== undefined) columns.confidence = Math.round(patch.confidence * 100);
  if ("clarifyingQuestion" in patch) columns.clarifyingQuestion = patch.clarifyingQuestion ?? null;
  if ("rationale" in patch) columns.rationale = patch.rationale ?? null;
  if ("agentBrief" in patch) columns.agentBrief = patch.agentBrief ?? null;
  if ("siftId" in patch) columns.siftId = patch.siftId ?? null;
  if ("siftStage" in patch) columns.siftStage = patch.siftStage ?? null;
  if ("plan" in patch) columns.plan = patch.plan ?? null;
  if (patch.subtasks !== undefined) columns.subtasks = patch.subtasks;

  if (
    ("urgency" in patch || "importance" in patch) &&
    !("priorityBucket" in patch) &&
    !editedFields.includes("priorityBucket")
  ) {
    columns.priorityBucket = bucketFromScalars(
      patch.urgency ?? existing.urgency,
      patch.importance ?? existing.importance,
    );
  }

  if (patch.lifecycle === "done" && !existing.completedAt) {
    columns.completedAt = opts.now;
  } else if (patch.lifecycle && patch.lifecycle !== "done") {
    columns.completedAt = null;
  }

  return columns;
}
