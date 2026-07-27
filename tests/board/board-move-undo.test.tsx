// @vitest-environment jsdom

import { BoardView } from "@/components/tasks/board/board-view";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = "2026-07-22T12:00:00.000Z";

function makeTask(
  patch: Partial<Task> & { id: string; title: string; lifecycle: Task["lifecycle"] },
): Task {
  return {
    sourceText: patch.title,
    sourceContext: null,
    description: null,
    nextAction: null,
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.5,
    importance: 0.5,
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
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...patch,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  useStore.setState({
    hydrated: true,
    labels: [],
    tasks: [makeTask({ id: "t_someday", title: "Shelf item", lifecycle: "someday" })],
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useStore.setState({ tasks: [], labels: [], hydrated: false });
});

async function fileToDone(user: ReturnType<typeof userEvent.setup>) {
  const card = screen.getByRole("option", { name: /Shelf item/i });
  card.focus();
  // someday (3) → done (4): one shift-right
  await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
  await waitFor(() => {
    expect(useStore.getState().tasks.find((t) => t.id === "t_someday")?.lifecycle).toBe("done");
  });
}

describe("BoardView move + undo", () => {
  it("moving to Done sets completedAt", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<BoardView onOpen={vi.fn()} />);
    await fileToDone(user);

    const task = useStore.getState().tasks.find((t) => t.id === "t_someday");
    expect(task?.lifecycle).toBe("done");
    expect(task?.completedAt).toBeTruthy();
  });

  it("Undo within the window restores lifecycle and null completedAt", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<BoardView onOpen={vi.fn()} />);
    await fileToDone(user);

    const undo = screen.getByRole("button", { name: "Undo" });
    await user.click(undo);

    await waitFor(() => {
      const task = useStore.getState().tasks.find((t) => t.id === "t_someday");
      expect(task?.lifecycle).toBe("someday");
      expect(task?.completedAt).toBeNull();
    });
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("the pill expires after 6s and stops offering undo", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<BoardView onOpen={vi.fn()} />);
    await fileToDone(user);

    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    });

    // Task stays in Done — expiry only retires the affordance.
    expect(useStore.getState().tasks.find((t) => t.id === "t_someday")?.lifecycle).toBe("done");
  });
});
