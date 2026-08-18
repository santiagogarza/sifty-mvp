// @vitest-environment jsdom
import { TaskBoard } from "@/components/tasks/task-board";
import type { Task } from "@/lib/domain/types";
import { BOARD_COLUMNS, selectBoardColumns } from "@/lib/store/board";
import { useStore } from "@/lib/store/store";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Board behaviour that the PRD calls out by name: the vocabulary comes from
 * STATUS_META, moving a card is the same edit the Status picker makes, and a
 * click still means "open" even though the card is draggable.
 *
 * Pointer drags are covered in the Playwright spec — jsdom has no layout, so a
 * simulated drag there would prove the mock works, not the board.
 */

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  const now = "2026-07-22T12:00:00Z";
  return {
    id: `task_test_${seq}`,
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
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...patch,
  };
}

/**
 * Mirrors how TaskView drives the board: columns are re-derived from the store
 * so a mutation moves the card the same way it would in the app.
 */
function Board({ onOpen = () => {} }: { onOpen?: (id: string) => void }) {
  const tasks = useStore((s) => s.tasks);
  const columns = React.useMemo(() => selectBoardColumns(tasks, BOARD_COLUMNS), [tasks]);
  const dropped = React.useMemo(() => selectBoardColumns(tasks, ["dropped"])[0] ?? null, [tasks]);
  return <TaskBoard columns={columns} droppedColumn={dropped} onOpen={onOpen} />;
}

function seed(tasks: Task[]) {
  useStore.setState({ tasks, labels: [], hydrated: true });
}

function taskState(id: string): Task {
  const task = useStore.getState().tasks.find((t) => t.id === id);
  if (!task) throw new Error(`task ${id} vanished from the store`);
  return task;
}

/** Focus a card the way tabbing to it would, so board shortcuts apply to it. */
function focusCard(title: string): HTMLElement {
  const card = screen.getByRole("option", { name: title });
  card.focus();
  return card;
}

beforeEach(() => {
  seed([]);
});

describe("column vocabulary", () => {
  it("uses the presented status labels, never the stored values", () => {
    render(<Board />);

    expect(screen.getByRole("listbox", { name: "Focus" })).toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Waiting on" })).toBeInTheDocument();

    // "active" is stored, "Focus" is shown. These are the names it must not use.
    for (const wrong of ["Active", "In progress", "Backlog", "To do"]) {
      expect(screen.queryByRole("listbox", { name: wrong })).not.toBeInTheDocument();
    }
  });

  it("renders every pipeline column in status order", () => {
    render(<Board />);
    const names = screen.getAllByRole("listbox").map((el) => el.getAttribute("aria-label"));
    expect(names).toEqual(["Inbox", "Focus", "Waiting on", "Someday", "Done"]);
  });
});

describe("rendering density", () => {
  it("stays silent with no tasks: columns, but nothing to read", () => {
    render(<Board />);

    expect(screen.getAllByRole("listbox")).toHaveLength(5);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.queryByText(/capture a task/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing/i)).not.toBeInTheDocument();
  });

  it("puts a task in the column matching its stored status", () => {
    seed([makeTask({ lifecycle: "waiting", title: "Chase the invoice" })]);
    render(<Board />);

    const waiting = screen.getByRole("listbox", { name: "Waiting on" });
    expect(within(waiting).getByRole("option", { name: "Chase the invoice" })).toBeInTheDocument();

    const focus = screen.getByRole("listbox", { name: "Focus" });
    expect(within(focus).queryAllByRole("option")).toHaveLength(0);
  });

  it("handles a couple hundred tasks without dropping any", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      makeTask({ lifecycle: i % 2 === 0 ? "inbox" : "active", title: `Bulk ${i}` }),
    );
    seed(many);
    render(<Board />);

    expect(screen.getAllByRole("option")).toHaveLength(200);
    expect(
      within(screen.getByRole("listbox", { name: "Inbox" })).getAllByRole("option"),
    ).toHaveLength(100);
  });
});

describe("moving a card by keyboard", () => {
  it("advances one column and files it, setting completedAt on the way into Done", async () => {
    const user = userEvent.setup();
    const task = makeTask({ lifecycle: "someday", title: "Ship the thing" });
    seed([task]);
    render(<Board />);

    focusCard("Ship the thing");
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");

    // Someday is followed by Done in the pipeline.
    expect(taskState(task.id).lifecycle).toBe("done");
    expect(taskState(task.id).completedAt).not.toBeNull();

    const done = screen.getByRole("listbox", { name: "Done" });
    expect(within(done).getByRole("option", { name: "Ship the thing" })).toBeInTheDocument();
  });

  it("clears completedAt on the way back out of Done", async () => {
    const user = userEvent.setup();
    const task = makeTask({
      lifecycle: "done",
      title: "Reopen me",
      completedAt: "2026-07-22T12:00:00Z",
    });
    seed([task]);
    render(<Board />);

    focusCard("Reopen me");
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");

    expect(taskState(task.id).lifecycle).toBe("someday");
    expect(taskState(task.id).completedAt).toBeNull();
  });

  it("does nothing at the end of the pipeline", async () => {
    const user = userEvent.setup();
    const task = makeTask({ lifecycle: "done", title: "Already finished" });
    seed([task]);
    render(<Board />);

    focusCard("Already finished");
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");

    expect(taskState(task.id).lifecycle).toBe("done");
  });

  it("does nothing at the start of the pipeline", async () => {
    const user = userEvent.setup();
    const task = makeTask({ lifecycle: "inbox", title: "Fresh capture" });
    seed([task]);
    render(<Board />);

    focusCard("Fresh capture");
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");

    expect(taskState(task.id).lifecycle).toBe("inbox");
  });

  it("keeps the moved card selected so it can be moved again", async () => {
    const user = userEvent.setup();
    const task = makeTask({ lifecycle: "inbox", title: "Walk it over" });
    seed([task]);
    render(<Board />);

    focusCard("Walk it over");
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");

    expect(taskState(task.id).lifecycle).toBe("waiting");
  });
});

describe("moving the selection by keyboard", () => {
  it("crosses columns without touching the task", async () => {
    const user = userEvent.setup();
    const inbox = makeTask({ lifecycle: "inbox", title: "Left card" });
    const focus = makeTask({ lifecycle: "active", title: "Right card" });
    seed([inbox, focus]);
    render(<Board />);

    focusCard("Left card");
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("option", { name: "Right card" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(taskState(inbox.id).lifecycle).toBe("inbox");
    expect(taskState(focus.id).lifecycle).toBe("active");
  });

  it("skips columns with nothing in them", async () => {
    const user = userEvent.setup();
    seed([
      makeTask({ lifecycle: "inbox", title: "Start here" }),
      makeTask({ lifecycle: "someday", title: "Far side" }),
    ]);
    render(<Board />);

    focusCard("Start here");
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("option", { name: "Far side" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("moves down a column with ArrowDown and j", async () => {
    const user = userEvent.setup();
    seed([
      makeTask({ lifecycle: "inbox", title: "Newest", createdAt: "2026-07-22T12:00:00Z" }),
      makeTask({ lifecycle: "inbox", title: "Oldest", createdAt: "2026-07-01T12:00:00Z" }),
    ]);
    render(<Board />);

    focusCard("Newest");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "Oldest" })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("k");
    expect(screen.getByRole("option", { name: "Newest" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the detail sheet on Enter", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const task = makeTask({ lifecycle: "inbox", title: "Open me" });
    seed([task]);
    render(<Board onOpen={onOpen} />);

    focusCard("Open me");
    await user.keyboard("{Enter}");

    expect(onOpen).toHaveBeenCalledWith(task.id);
  });
});

describe("click versus drag", () => {
  it("opens the detail sheet when the pointer barely moves", () => {
    const onOpen = vi.fn();
    const task = makeTask({ lifecycle: "inbox", title: "Tap target" });
    seed([task]);
    render(<Board onOpen={onOpen} />);

    const card = screen.getByRole("option", { name: "Tap target" });
    fireEvent.pointerDown(card, { clientX: 100, clientY: 100 });
    fireEvent.click(card, { clientX: 102, clientY: 100 });

    expect(onOpen).toHaveBeenCalledWith(task.id);
  });

  it("stays shut when the pointer travelled far enough to be a drag", () => {
    const onOpen = vi.fn();
    seed([makeTask({ lifecycle: "inbox", title: "Drag target" })]);
    render(<Board onOpen={onOpen} />);

    const card = screen.getByRole("option", { name: "Drag target" });
    fireEvent.pointerDown(card, { clientX: 100, clientY: 100 });
    fireEvent.click(card, { clientX: 160, clientY: 140 });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("completes a task from the card without opening it", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const task = makeTask({ lifecycle: "active", title: "Check me off" });
    seed([task]);
    render(<Board onOpen={onOpen} />);

    await user.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(taskState(task.id).lifecycle).toBe("done");
    expect(taskState(task.id).completedAt).not.toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("dropped disclosure", () => {
  it("keeps dropped out of the way until it is asked for", async () => {
    const user = userEvent.setup();
    seed([makeTask({ lifecycle: "dropped", title: "Let this go" })]);
    render(<Board />);

    expect(screen.queryByRole("listbox", { name: "Dropped" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show dropped/i }));

    const dropped = screen.getByRole("listbox", { name: "Dropped" });
    expect(within(dropped).getByRole("option", { name: "Let this go" })).toBeInTheDocument();
  });

  it("offers no control at all when nothing has been dropped", () => {
    seed([makeTask({ lifecycle: "inbox" })]);
    render(<Board />);

    expect(screen.queryByRole("button", { name: /show dropped/i })).not.toBeInTheDocument();
  });
});
