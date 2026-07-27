// @vitest-environment jsdom

import { BoardView } from "@/components/tasks/board/board-view";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The board's accessibility contract, which a type checker cannot see:
 * every selection is real DOM focus, moving a card carries focus with it,
 * and a move is spoken as well as drawn.
 */

const openDetail = vi.fn();
vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({ openDetail, openCapture: vi.fn(), openCommand: vi.fn() }),
}));

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  const stamp = new Date(Date.now() + seq * 1000).toISOString();
  return {
    id: `task_kb_${seq}`,
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
    createdAt: stamp,
    updatedAt: stamp,
    completedAt: null,
    ...patch,
  };
}

function seed(tasks: Task[]) {
  useStore.setState({ tasks, labels: [], hydrated: true });
}

function lifecycleOf(id: string) {
  return useStore.getState().tasks.find((t) => t.id === id)?.lifecycle;
}

/** The column a card is rendered in, read off the DOM rather than the store. */
function columnOf(element: HTMLElement): string | null {
  return element.closest("[data-column]")?.getAttribute("data-column") ?? null;
}

beforeEach(() => {
  openDetail.mockClear();
  seed([]);
});

describe("board keyboard model", () => {
  it("moves the selection within a column with j/k and never leaves it", async () => {
    const user = userEvent.setup();
    // Inbox is newest-first, so the later createdAt renders on top.
    const top = makeTask({ title: "Top", createdAt: "2026-07-22T12:00:00.000Z" });
    const below = makeTask({ title: "Below", createdAt: "2026-07-21T12:00:00.000Z" });
    seed([below, top, makeTask({ title: "Elsewhere", lifecycle: "waiting" })]);
    render(<BoardView />);

    await user.keyboard("j");
    await waitFor(() => expect(screen.getByRole("option", { name: "Top" })).toHaveFocus());
    expect(columnOf(document.activeElement as HTMLElement)).toBe("inbox");

    await user.keyboard("j");
    await waitFor(() => expect(screen.getByRole("option", { name: "Below" })).toHaveFocus());
    expect(columnOf(document.activeElement as HTMLElement)).toBe("inbox");

    // The bottom of a column is the bottom: j does not wrap into the next one.
    await user.keyboard("j");
    expect(screen.getByRole("option", { name: "Below" })).toHaveFocus();

    await user.keyboard("k");
    await waitFor(() => expect(screen.getByRole("option", { name: "Top" })).toHaveFocus());
  });

  it("files the selected card with shift+arrow, and focus follows it across", async () => {
    const user = userEvent.setup();
    const task = makeTask({ title: "Renew passport" });
    seed([task]);
    render(<BoardView />);

    await user.keyboard("j");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Renew passport" })).toHaveFocus(),
    );
    expect(columnOf(document.activeElement as HTMLElement)).toBe("inbox");

    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");

    expect(lifecycleOf(task.id)).toBe("active");
    await waitFor(() => {
      const card = screen.getByRole("option", { name: "Renew passport" });
      expect(card).toHaveFocus();
      expect(columnOf(card)).toBe("active");
    });

    // Filing three in a row keeps working because focus never went home.
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(lifecycleOf(task.id)).toBe("waiting");
    await waitFor(() =>
      expect(columnOf(screen.getByRole("option", { name: "Renew passport" }))).toBe("waiting"),
    );

    // The pipeline has ends: shift+left off Inbox writes nothing.
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(lifecycleOf(task.id)).toBe("inbox");
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(lifecycleOf(task.id)).toBe("inbox");
  });

  it("announces the move, and names the shortcut that takes it back", async () => {
    const user = userEvent.setup();
    seed([makeTask({ title: "Renew passport" })]);
    const { container } = render(<BoardView />);

    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toBeTruthy();
    expect(live?.textContent).toBe("");

    await user.keyboard("j");
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");

    await waitFor(() =>
      expect(live?.textContent).toBe("Renew passport moved to Focus. Press Command Z to undo."),
    );
  });

  it("crosses columns with plain arrows without writing anything", async () => {
    const user = userEvent.setup();
    const inbox = makeTask({ title: "In the inbox" });
    const waiting = makeTask({ title: "Handed off", lifecycle: "waiting" });
    seed([inbox, waiting]);
    render(<BoardView />);

    await user.keyboard("j");
    // Focus is the only empty column between them, so it is skipped.
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.getByRole("option", { name: "Handed off" })).toHaveFocus());
    expect(lifecycleOf(inbox.id)).toBe("inbox");
    expect(lifecycleOf(waiting.id)).toBe("waiting");
  });

  it("opens the detail sheet on Enter and completes on Space", async () => {
    const user = userEvent.setup();
    const task = makeTask({ title: "Renew passport" });
    seed([task]);
    render(<BoardView />);

    await user.keyboard("j");
    await user.keyboard("{Enter}");
    expect(openDetail).toHaveBeenCalledWith(task.id);

    await user.keyboard(" ");
    expect(lifecycleOf(task.id)).toBe("done");
  });
});
