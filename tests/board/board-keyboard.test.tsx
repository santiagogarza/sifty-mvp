// @vitest-environment jsdom

import { BoardView } from "@/components/tasks/board/board-view";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({ openDetail: vi.fn(), openCapture: vi.fn(), openCommand: vi.fn() }),
}));

vi.mock("@/lib/store/sync", () => ({
  useServerSync: () => ({ hydrated: true, error: null }),
}));

const NOW = new Date("2026-07-22T12:00:00Z");

function makeTask(patch: Partial<Task>): Task {
  return {
    id: patch.id ?? "task_kb_1",
    sourceText: "test",
    sourceContext: null,
    title: patch.title ?? "Keyboard task",
    description: null,
    nextAction: null,
    lifecycle: patch.lifecycle ?? "inbox",
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

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  useStore.setState({
    hydrated: true,
    tasks: [
      makeTask({
        id: "t1",
        lifecycle: "inbox",
        title: "First inbox",
        createdAt: "2026-07-22T14:00:00Z",
      }),
      makeTask({
        id: "t2",
        lifecycle: "inbox",
        title: "Second inbox",
        createdAt: "2026-07-22T12:00:00Z",
      }),
      makeTask({ id: "t3", lifecycle: "active", title: "Focus item" }),
    ],
    labels: [],
  });
});

afterEach(() => {
  useStore.setState({ tasks: [], labels: [], hydrated: false });
});

describe("BoardView keyboard", () => {
  it("shift+right on a selected card changes lifecycle and announces the move", async () => {
    render(<BoardView />);

    const firstCard = await screen.findByRole("option", { name: /first inbox/i });
    firstCard.focus();
    fireEvent.keyDown(firstCard, { key: "ArrowRight", shiftKey: true });

    await waitFor(() => {
      expect(useStore.getState().tasks.find((t) => t.id === "t1")?.lifecycle).toBe("active");
    });

    await waitFor(() => {
      expect(screen.getByText(/moved to focus/i)).toBeInTheDocument();
    });
  });

  it("j/k roving focus stays inside a column", async () => {
    render(<BoardView />);

    await screen.findByRole("option", { name: /first inbox/i });

    const firstCard = screen.getByRole("option", { name: /first inbox/i });
    firstCard.focus();
    fireEvent.keyDown(firstCard, { key: "j" });

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /second inbox/i })).toHaveFocus();
    });
  });
});
