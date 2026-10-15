// @vitest-environment jsdom
import { TaskBoard } from "@/components/tasks/task-board";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeTask(id: string, lifecycle: Lifecycle): Task {
  return {
    id,
    sourceText: id,
    sourceContext: null,
    title: id,
    description: null,
    nextAction: null,
    lifecycle,
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.4,
    importance: 0.4,
    priorityBucket: "unset",
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
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    completedAt: null,
  };
}

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    bottom: y + height,
    right: x + width,
    toJSON() {
      return {};
    },
  } as DOMRect;
}

const COLUMN_RECTS: Record<string, DOMRect> = {
  "Inbox column": rect(0, 0, 248, 500),
  "Focus column": rect(260, 0, 248, 500),
  "Waiting on column": rect(520, 0, 248, 500),
  "Someday column": rect(780, 0, 248, 500),
  "Done column": rect(1040, 0, 248, 500),
};

describe("TaskBoard drop", () => {
  const originalRect = Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    useStore.setState({
      tasks: [makeTask("Move me", "inbox")],
      labels: [],
      hydrated: true,
    });
    Element.prototype.getBoundingClientRect = function () {
      const label = this.getAttribute?.("aria-label");
      if (label && COLUMN_RECTS[label]) return COLUMN_RECTS[label];
      return rect(0, 0, 0, 0);
    };
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalRect;
    cleanup();
  });

  it("moves a card into the column it is dropped on", () => {
    render(<TaskBoard onOpen={vi.fn()} />);
    const card = screen.getByText("Move me");

    fireEvent.mouseDown(card, { clientX: 40, clientY: 40, button: 0 });
    fireEvent.mouseMove(document, { clientX: 60, clientY: 40, button: 0 });
    fireEvent.mouseMove(document, { clientX: 380, clientY: 80, button: 0 });
    fireEvent.mouseUp(document, { clientX: 380, clientY: 80, button: 0 });

    expect(useStore.getState().tasks.find((t) => t.id === "Move me")?.lifecycle).toBe("active");
    expect(screen.getByRole("region", { name: "Focus column" })).toHaveTextContent("Move me");
    expect(screen.getByRole("region", { name: "Inbox column" })).not.toHaveTextContent("Move me");
  });
});
