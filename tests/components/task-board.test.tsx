// @vitest-environment jsdom
import { TaskBoard } from "@/components/tasks/task-board";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Board cards mirror the list: a low-confidence task is flagged even with no other meta. */

function makeTask(id: string, confidence: number): Task {
  return {
    id,
    sourceText: id,
    sourceContext: null,
    title: `Card ${id}`,
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
    confidence,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    siftId: null,
    siftStage: null,
    plan: null,
    recurrence: null,
    seriesId: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    completedAt: null,
  };
}

beforeEach(() => {
  useStore.setState({ tasks: [makeTask("low", 0.4), makeTask("high", 0.9)], labels: [] });
});

afterEach(() => {
  cleanup();
});

describe("TaskBoard confidence", () => {
  it("renders the compact pill on the low-confidence card only", () => {
    render(<TaskBoard onOpen={vi.fn()} />);
    expect(screen.getByText("Card low")).toBeInTheDocument();
    expect(screen.getByText("Card high")).toBeInTheDocument();
    const pills = screen.getAllByTestId("confidence-pill");
    expect(pills).toHaveLength(1);
    expect(pills[0]!.closest("[class*='surface-card']")).toHaveTextContent("Card low");
  });
});

describe("TaskBoard priority and repeat", () => {
  it("cards carry the labeled priority pill, and a repeat mark when the task repeats", () => {
    useStore.setState({
      tasks: [
        {
          ...makeTask("rep", 0.9),
          recurrence: { freq: "monthly", mode: "fixed", dayOfMonth: 1 },
          seriesId: "rep",
        },
        { ...makeTask("plain", 0.9), priorityBucket: "unset" },
      ],
    });
    render(<TaskBoard onOpen={vi.fn()} />);
    const repCard = screen.getByText("Card rep").closest("[class*='surface-card']")!;
    expect(repCard.querySelector("[data-testid='priority-pill']")).toHaveTextContent("Important");
    expect(repCard.querySelector("[data-testid='repeat-glyph']")).toHaveAttribute(
      "aria-label",
      "Repeats monthly on the 1st",
    );
    const plainCard = screen.getByText("Card plain").closest("[class*='surface-card']")!;
    expect(plainCard.querySelector("[data-testid='priority-pill']")).toBeNull();
    expect(plainCard.querySelector("[data-testid='repeat-glyph']")).toBeNull();
  });
});
