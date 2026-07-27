// @vitest-environment jsdom

import { BoardView } from "@/components/tasks/board/board-view";
import { UNDO_WINDOW_MS } from "@/components/tasks/board/use-board-move";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `completedAt` is the one field a move can silently corrupt: the store
 * stamps it on the way into done and clears it on the way out, so an undo
 * has to put back the timestamp as well as the status. Everything else
 * about a move is visible; this is not.
 */

vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({ openDetail: vi.fn(), openCapture: vi.fn(), openCommand: vi.fn() }),
}));

const COMPLETED_LONG_AGO = "2026-06-01T09:00:00.000Z";

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  return {
    id: `task_undo_${seq}`,
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
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:00.000Z",
    completedAt: null,
    ...patch,
  };
}

function taskById(id: string) {
  const task = useStore.getState().tasks.find((t) => t.id === id);
  if (!task) throw new Error(`task ${id} is gone`);
  return task;
}

/** Sends a key to whatever the board has focused. */
function press(init: KeyboardEventInit) {
  const target = document.activeElement ?? document.body;
  act(() => {
    fireEvent.keyDown(target, init);
  });
}

/** ⇧← / ⇧→ enough times to walk from one column to another. */
async function file(user: ReturnType<typeof userEvent.setup>, steps: number) {
  const arrow = steps > 0 ? "{ArrowRight}" : "{ArrowLeft}";
  for (let i = 0; i < Math.abs(steps); i += 1) {
    await user.keyboard(`{Shift>}${arrow}{/Shift}`);
  }
}

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [], hydrated: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("board move and undo", () => {
  it("stamps completedAt on the way into Done and clears it on undo", async () => {
    const user = userEvent.setup();
    const task = makeTask({ title: "Renew passport", lifecycle: "someday" });
    useStore.setState({ tasks: [task], labels: [], hydrated: true });
    render(<BoardView />);

    await user.keyboard("j");
    await file(user, 1);

    expect(taskById(task.id).lifecycle).toBe("done");
    expect(taskById(task.id).completedAt).toBeTruthy();

    await user.click(await screen.findByRole("button", { name: /undo/i }));

    expect(taskById(task.id).lifecycle).toBe("someday");
    expect(taskById(task.id).completedAt).toBeNull();
  });

  it("puts back the original completion time when the move started in Done", async () => {
    const user = userEvent.setup();
    const task = makeTask({
      title: "Ship onboarding fix",
      lifecycle: "done",
      completedAt: COMPLETED_LONG_AGO,
    });
    useStore.setState({ tasks: [task], labels: [], hydrated: true });
    render(<BoardView />);

    await user.keyboard("j");
    await file(user, -1);

    expect(taskById(task.id).lifecycle).toBe("someday");
    expect(taskById(task.id).completedAt).toBeNull();

    await user.click(await screen.findByRole("button", { name: /undo/i }));

    expect(taskById(task.id).lifecycle).toBe("done");
    // Not "now": undoing an un-filing must not re-date the completion.
    expect(taskById(task.id).completedAt).toBe(COMPLETED_LONG_AGO);
  });

  it("names the destination, then retires itself and stops offering undo", async () => {
    // Fake timers only, and fireEvent rather than userEvent: this test is
    // about a 6s clock, and userEvent's own scheduling fights a fake one.
    vi.useFakeTimers();
    const task = makeTask({ title: "Renew passport" });
    useStore.setState({ tasks: [task], labels: [], hydrated: true });
    render(<BoardView />);

    press({ key: "j" });
    press({ key: "ArrowRight", shiftKey: true });
    press({ key: "ArrowRight", shiftKey: true });

    expect(screen.getByText(/Moved to/)).toHaveTextContent("Moved to Waiting on");
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS + 50);
    });

    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
    // The window closed, not the move: the card stays where it was put.
    expect(taskById(task.id).lifecycle).toBe("waiting");
  });

  it("undoes the last move with ⌘Z, from anywhere on the page", async () => {
    const user = userEvent.setup();
    const task = makeTask({ title: "Renew passport" });
    useStore.setState({ tasks: [task], labels: [], hydrated: true });
    render(<BoardView />);

    await user.keyboard("j");
    await file(user, 1);
    expect(taskById(task.id).lifecycle).toBe("active");

    act(() => {
      document.body.focus();
    });
    await user.keyboard("{Meta>}z{/Meta}");

    expect(taskById(task.id).lifecycle).toBe("inbox");
    await waitFor(() => expect(screen.queryByRole("button", { name: /undo/i })).toBeNull());
  });
});
