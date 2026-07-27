import type { Task } from "@/lib/domain/types";

export function boardTask(patch: Partial<Task> = {}): Task {
  const now = "2026-07-27T05:00:00.000Z";
  return {
    id: "board-task",
    sourceText: "Board task",
    sourceContext: null,
    title: "Board task",
    description: null,
    nextAction: "Take the next step",
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

export function installBoardBrowserMocks() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
}
