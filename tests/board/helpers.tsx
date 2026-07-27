import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";

/** Shared fixtures for the board component tests (jsdom). */

const NOW = new Date("2026-07-22T12:00:00Z");

let seq = 0;
export function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  return {
    id: `task_board_${seq}`,
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
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    completedAt: null,
    ...patch,
  };
}

export function seedStore(tasks: Task[]): void {
  useStore.setState({ tasks, labels: [], memories: [], hydrated: true });
}

export function taskInStore(id: string): Task | undefined {
  return useStore.getState().tasks.find((t) => t.id === id);
}

/** jsdom has no matchMedia; the board uses it for breakpoints and motion. */
export function stubMatchMedia(): void {
  if (typeof window.matchMedia === "function") return;
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
