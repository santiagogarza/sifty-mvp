import type { Repos } from "@/lib/db/repos";
import { mergeTriageIntoTask } from "@/lib/domain/triage-merge";
import type { Label, LabelTone, Subtask, Task } from "@/lib/domain/types";
import { id as makeId } from "@/lib/utils/ids";
import type { TriageOutput } from "./triage-schema";

/**
 * Durable, server-side application of a triage result.
 *
 * The triage route calls this after the model responds so the result
 * survives even if the client disconnects mid-run. Labels suggested by the
 * model are ensured server-side (idempotent by name) and the merge honors
 * the task's stored `editedFields` via the shared merge helper.
 *
 * Returns null when the task isn't on the server (e.g. its create push
 * hasn't landed) — the client falls back to a local apply and the sync
 * layer reconciles later.
 */

/** Same rotation the client uses so tones stay consistent across origins. */
const LABEL_TONE_PALETTE: LabelTone[] = ["neutral", "mist", "sand", "sage", "ember"];

export interface AppliedTriage {
  task: Task;
  labels: Label[];
}

export async function applyTriageToTask(
  repos: Repos,
  userId: string,
  taskId: string,
  output: TriageOutput,
): Promise<AppliedTriage | null> {
  const task = await repos.tasks.get(userId, taskId);
  if (!task) return null;

  const existingLabels = await repos.labels.list(userId);
  const ensured: Label[] = [];
  let labelCount = existingLabels.length;
  for (const name of output.suggestedLabels) {
    const match = existingLabels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (match) {
      ensured.push(match);
      continue;
    }
    const label = await repos.labels.ensure(userId, {
      id: makeId("label"),
      name,
      tone: LABEL_TONE_PALETTE[labelCount % LABEL_TONE_PALETTE.length]!,
    });
    labelCount += 1;
    ensured.push(label);
  }

  const subtasks: Subtask[] = output.subtasks.map((title, order) => ({
    id: makeId("st"),
    title,
    done: false,
    order,
  }));

  const merged = mergeTriageIntoTask(task, {
    title: output.title,
    description: output.description,
    nextAction: output.nextAction,
    urgency: output.urgency,
    importance: output.importance,
    effort: output.effort,
    due: output.dueHint,
    delegationCandidate: output.delegationCandidate,
    labelIds: ensured.map((l) => l.id),
    subtasks,
    rationale: output.rationale,
    confidence: output.confidence,
    clarifyingQuestion: output.clarifyingQuestion,
  });

  const updated = await repos.tasks.update(userId, taskId, {
    title: merged.title,
    description: merged.description,
    nextAction: merged.nextAction,
    urgency: merged.urgency,
    importance: merged.importance,
    priorityBucket: merged.priorityBucket,
    effort: merged.effort,
    due: merged.due,
    delegationCandidate: merged.delegationCandidate,
    labelIds: merged.labelIds,
    subtasks: merged.subtasks,
    rationale: merged.rationale,
    confidence: merged.confidence,
    clarifyingQuestion: merged.clarifyingQuestion,
    aiStatus: "ready",
    aiError: null,
    aiAttempts: merged.aiAttempts,
  });
  if (!updated) return null;

  return { task: updated, labels: ensured };
}
