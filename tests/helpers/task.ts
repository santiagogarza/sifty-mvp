import type { Task } from "@/lib/domain/types";

export function makeTask(patch: Partial<Task> = {}): Task {
  return {
    id: "task_test",
    sourceText: "test",
    sourceContext: null,
    title: "Test task",
    description: null,
    nextAction: null,
    lifecycle: "inbox",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.4,
    importance: 0.4,
    priorityBucket: "schedule",
    effort: "small",
    due: null,
    delegationCandidate: "self",
    assigneeName: null,
    confidence: 0.8,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: "2026-07-22T12:00:00.000Z",
    updatedAt: "2026-07-22T12:00:00.000Z",
    completedAt: null,
    ...patch,
  };
}
