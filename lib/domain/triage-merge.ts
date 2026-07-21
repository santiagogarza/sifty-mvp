import { bucketFromScalars } from "./priority";
import type { Subtask, Task, TaskEditableField } from "./types";

/**
 * Merge a triage result into a task, respecting user edits.
 *
 * This is the single source of truth for the "AI never overwrites a
 * user-edited field" invariant. Both the client store (optimistic apply)
 * and the triage API route (durable server-side apply) call this, so the
 * two can never drift.
 */

export interface TriageApplyInput {
  title: string;
  description: string | null;
  nextAction: string | null;
  urgency: number;
  importance: number;
  effort: Task["effort"];
  due: string | null;
  delegationCandidate: Task["delegationCandidate"];
  labelIds: string[];
  subtasks: Subtask[];
  rationale: string | null;
  confidence: number;
  clarifyingQuestion: string | null;
}

export function mergeTriageIntoTask(task: Task, triage: TriageApplyInput): Task {
  const protect = (field: TaskEditableField) => task.editedFields.includes(field);
  const next: Task = { ...task };

  if (!protect("title")) next.title = triage.title;
  if (!protect("description")) next.description = triage.description ?? task.description;
  if (!protect("nextAction")) next.nextAction = triage.nextAction;
  if (!protect("urgency")) next.urgency = triage.urgency;
  if (!protect("importance")) next.importance = triage.importance;
  if (!protect("effort")) next.effort = triage.effort;
  if (!protect("due")) next.due = triage.due;
  if (!protect("delegationCandidate")) next.delegationCandidate = triage.delegationCandidate;
  if (!protect("labelIds") && triage.labelIds.length) next.labelIds = triage.labelIds;
  if (!protect("subtasks") && triage.subtasks.length) next.subtasks = triage.subtasks;
  if (!protect("priorityBucket")) {
    next.priorityBucket = bucketFromScalars(next.urgency, next.importance);
  }

  next.rationale = triage.rationale;
  next.confidence = triage.confidence;
  next.clarifyingQuestion = triage.clarifyingQuestion;
  next.aiStatus = "ready";
  next.aiError = null;
  next.aiAttempts = task.aiAttempts + 1;
  next.updatedAt = new Date().toISOString();
  return next;
}
