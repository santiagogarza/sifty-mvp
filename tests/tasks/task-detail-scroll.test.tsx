// @vitest-environment jsdom

import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * Regression: on mobile the detail sheet is a bottom sheet capped at
 * max-h-[88dvh] with overflow visible. Its body is a column flex item
 * whose middle region is flex-1 overflow-y-auto. A flex item's default
 * min-height is auto, so without min-h-0 the scroll region refuses to
 * shrink below its content. overflow-y-auto never engages, the body
 * paints past the viewport, and the Updated/Delete footer is unreachable
 * because the dialog also locks document scroll.
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

describe("task detail sheet — mobile scrollability", () => {
  it("lets the sheet body shrink so the overflow region can scroll", () => {
    const task = makeTask();
    useStore.setState({ tasks: [task] });

    render(<TaskDetailSheet taskId={task.id} onClose={() => {}} />);

    const scrollRegion = document.querySelector<HTMLElement>(".flex-1.overflow-y-auto");
    expect(scrollRegion, "scroll region should be rendered").not.toBeNull();
    expect(scrollRegion?.className).toContain("min-h-0");

    const body = scrollRegion?.parentElement;
    expect(body?.className).toContain("min-h-0");
    expect(body?.className).toContain("flex-col");
  });
});
