import type { SiftContext } from "@/lib/ai/sift/stages";
import type { Task } from "@/lib/domain/types";
import type { GoldenCapture } from "../golden/schema";

/**
 * A freshly captured task, exactly as `createTask` in the store builds it
 * before the pipeline touches it: provisional title from the text, context
 * doubling as the description, neutral priority.
 */
export function taskFromCapture(capture: GoldenCapture, todayIso: string): Task {
  const text = capture.sourceText.trim();
  const createdAt = `${todayIso}T09:00:00.000Z`;
  return {
    id: `task_${capture.id}`,
    sourceText: text,
    sourceContext: capture.sourceContext?.trim() || null,
    title: text.length > 80 ? `${text.slice(0, 78)}…` : text || "Untitled task",
    description: capture.sourceContext?.trim() || null,
    nextAction: null,
    lifecycle: "inbox",
    aiStatus: "running",
    aiError: null,
    aiAttempts: 0,
    urgency: 0.4,
    importance: 0.4,
    priorityBucket: "unset",
    effort: "small",
    due: null,
    delegationCandidate: "unsure",
    assigneeName: null,
    confidence: 0,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    siftId: `sift_${capture.id}`,
    siftStage: "enrich",
    plan: null,
    recurrence: null,
    seriesId: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
  };
}

export function contextFor(capture: GoldenCapture, task: Task, todayIso: string): SiftContext {
  return {
    task,
    todayIso,
    recentLabels: capture.recentLabels,
    preferences: capture.preferences,
    openTasks: capture.openTasks,
  };
}
