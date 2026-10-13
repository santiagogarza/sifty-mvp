import type { Task } from "@/lib/domain/types";

/**
 * Task fixture factory for store/component tests. Every field is a sane
 * "ready" default; pass a patch for what the test actually cares about.
 */
let seq = 0;
export function makeTask(patch: Partial<Task> = {}): Task {
  seq += 1;
  const now = new Date("2026-07-22T12:00:00Z").toISOString();
  return {
    id: `task_test_${seq}`,
    sourceText: "test",
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
