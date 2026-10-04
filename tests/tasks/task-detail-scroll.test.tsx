// @vitest-environment jsdom

import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * On mobile the sheet is `max-h-[88dvh]` and the page scroll is locked.
 * The body is a flex column; its middle region is `flex-1 overflow-y-auto`.
 * A flex item's default min-height is `auto`, so without `min-h-0` that
 * region will not shrink, overflow never engages, and the footer (Updated /
 * Delete) plus the lower sections sit past the viewport with no scroll.
 */

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  for (const method of [
    "hasPointerCapture",
    "setPointerCapture",
    "releasePointerCapture",
  ] as const) {
    if (!(method in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[method] = () => {};
    }
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  useStore.setState({ tasks: [], labels: [], memories: [] });
});

function makeTask(): Task {
  const now = new Date().toISOString();
  return {
    id: "task_scroll_fixture",
    sourceText: "Long task with lots of detail",
    sourceContext: null,
    title: "Draft launch announcement",
    description: null,
    nextAction: "Write the first paragraph",
    lifecycle: "active",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.6,
    importance: 0.7,
    priorityBucket: "schedule",
    effort: "medium",
    due: "2026-08-20",
    delegationCandidate: "self",
    assigneeName: null,
    confidence: 0.8,
    clarifyingQuestion: null,
    rationale: "Because it matters.",
    agentBrief: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

describe("task detail sheet mobile scroll", () => {
  it("lets the sheet body shrink so the overflow region can scroll", () => {
    useStore.setState({ tasks: [makeTask()] });
    render(<TaskDetailSheet taskId="task_scroll_fixture" onClose={() => {}} />);

    const scrollRegion = document.querySelector<HTMLElement>(".flex-1.overflow-y-auto");
    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion?.className).toContain("min-h-0");

    const body = scrollRegion?.parentElement;
    expect(body?.className).toContain("min-h-0");
    expect(body?.className).toContain("flex-col");
  });
});
