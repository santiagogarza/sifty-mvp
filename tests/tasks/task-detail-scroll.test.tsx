// @vitest-environment jsdom

import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * Regression: on mobile the detail sheet is a bottom sheet capped at
 * `max-h-[88dvh]` (an indefinite, content-driven height). Its body is a flex
 * column whose middle region is `flex-1 overflow-y-auto`. A flex item's
 * default `min-height` is `auto`, so without `min-h-0` the scroll region
 * refuses to shrink below its content, the `overflow-y-auto` never engages,
 * and the bottom of the sheet (the Updated/Delete footer) overflows past the
 * viewport with no way to scroll to it.
 *
 * These assertions lock in the shrink-enabling classes on the scroll chain.
 */

// Radix Dialog touches a few DOM APIs jsdom doesn't implement.
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
  it("gives the scroll region a shrinkable flex chain so overflow-y-auto can engage", () => {
    const task = makeTask();
    useStore.setState({ tasks: [task] });

    render(<TaskDetailSheet taskId={task.id} onClose={() => {}} />);

    // The primary scroll region: the flex-1 body between the sticky header
    // and the footer. (The Agent-brief <pre> is also overflow-y-auto but is
    // `max-h-64`, not `flex-1`, so this selector is unambiguous.)
    const scrollRegion = document.querySelector<HTMLElement>(".flex-1.overflow-y-auto");
    expect(scrollRegion, "scroll region should be rendered").not.toBeNull();

    // A flex item won't shrink below its content unless min-height:0 is set.
    // Without this the sheet body overflows and cannot scroll on mobile.
    expect(scrollRegion?.className).toContain("min-h-0");

    // The body's flex-column root must also permit shrinking so the sheet's
    // max-height actually bounds it (otherwise it grows past the viewport).
    const body = scrollRegion?.parentElement;
    expect(body?.className, "detail body root should exist").toBeTruthy();
    expect(body?.className).toContain("min-h-0");
  });
});
