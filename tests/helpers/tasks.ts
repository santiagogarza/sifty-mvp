import type { Task } from "@/lib/domain/types";

let seq = 0;

/** A fully-triaged task fixture; override whatever the test cares about. */
export function makeTask(patch: Partial<Task> = {}): Task {
  seq += 1;
  const now = new Date().toISOString();
  return {
    id: `task_fixture_${seq}`,
    sourceText: "fixture",
    sourceContext: null,
    title: `Task ${seq}`,
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
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...patch,
  };
}
