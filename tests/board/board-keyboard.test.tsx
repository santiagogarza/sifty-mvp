// @vitest-environment jsdom

import { BoardView } from "@/components/tasks/board/board-view";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

function seedBoard() {
  useStore.setState({
    hydrated: true,
    labels: [],
    tasks: [
      // Inbox sorts newest-first by createdAt — give one a later stamp so
      // "Inbox one" is reliably first in the column.
      makeTask({
        id: "t_inbox_1",
        title: "Inbox one",
        lifecycle: "inbox",
        createdAt: "2026-07-22T13:00:00.000Z",
      }),
      makeTask({
        id: "t_inbox_2",
        title: "Inbox two",
        lifecycle: "inbox",
        createdAt: "2026-07-22T12:00:00.000Z",
      }),
      makeTask({ id: "t_focus_1", title: "Focus one", lifecycle: "active" }),
    ],
  });
}

beforeEach(() => {
  seedBoard();
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
  useStore.setState({ tasks: [], labels: [], hydrated: false });
});

describe("BoardView keyboard", () => {
  it("⇧→ files the selected card and focus follows into the new column", async () => {
    const user = userEvent.setup();
    render(<BoardView onOpen={vi.fn()} />);

    // Select the first inbox card.
    const inboxOne = screen.getByRole("option", { name: /Inbox one/i });
    inboxOne.focus();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");

    await waitFor(() => {
      const task = useStore.getState().tasks.find((t) => t.id === "t_inbox_1");
      expect(task?.lifecycle).toBe("active");
    });

    const moved = screen.getByRole("option", { name: /Inbox one/i });
    expect(moved).toHaveAttribute("aria-selected", "true");
    // Card now lives under the Focus listbox.
    expect(moved.closest('[aria-label="Focus"]')).toBeTruthy();
  });

  it("j/k keep roving focus inside a column", async () => {
    const user = userEvent.setup();
    render(<BoardView onOpen={vi.fn()} />);

    const one = screen.getByRole("option", { name: /Inbox one/i });
    one.focus();
    await user.keyboard("j");

    await waitFor(() => {
      const two = screen.getByRole("option", { name: /Inbox two/i });
      expect(two).toHaveAttribute("aria-selected", "true");
    });

    await user.keyboard("k");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Inbox one/i })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    // Still in Inbox — did not cross columns.
    expect(
      screen.getByRole("option", { name: /Inbox one/i }).closest('[aria-label="Inbox"]'),
    ).toBeTruthy();
  });

  it("announces moves through an aria-live region", async () => {
    const user = userEvent.setup();
    render(<BoardView onOpen={vi.fn()} />);

    screen.getByRole("option", { name: /Inbox one/i }).focus();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");

    await waitFor(() => {
      const live = document.querySelector("[aria-live='polite']");
      expect(live?.textContent).toMatch(/Moved to Focus/i);
    });
  });
});
