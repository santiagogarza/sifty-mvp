import type { Lifecycle, Task } from "@/lib/domain/types";

export function makeTask(partial: Partial<Task> & { id: string; lifecycle: Lifecycle }): Task {
  const title = partial.title ?? partial.id;
  return {
    sourceText: title,
    sourceContext: null,
    title,
    description: null,
    nextAction: null,
    aiStatus: "ready",
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
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    ...partial,
  };
}
