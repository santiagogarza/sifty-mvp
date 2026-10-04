// @vitest-environment jsdom
import { BoardView, UNDO_WINDOW_MS } from "@/components/tasks/board-view";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTask } from "../helpers/tasks";

/**
 * Board behavior that does not need a pointer: columns, keyboard filing,
 * undo, open, complete. The drag path is covered by dnd-kit's sensor
 * constraints plus the e2e suite; here a plain click must be an open.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [], memories: [], hydrated: true });
});

function seed(tasks: Task[]) {
  useStore.setState({ tasks });
  return tasks;
}

/** Like `TaskView`: the board gets the live store tasks, so writes re-render it. */
function Harness({ onOpen, onAdd }: { onOpen: (id: string) => void; onAdd: () => void }) {
  const tasks = useStore((s) => s.tasks);
  return <BoardView tasks={tasks} onOpen={onOpen} onAdd={onAdd} />;
}

function renderBoard() {
  const onOpen = vi.fn();
  const onAdd = vi.fn();
  const utils = render(<Harness onOpen={onOpen} onAdd={onAdd} />);
  return { ...utils, onOpen, onAdd };
}

const board = () => screen.getByRole("listbox", { name: "Board" });
const column = (label: RegExp) => screen.getByRole("group", { name: label });
const lifecycleOf = (id: string) => useStore.getState().tasks.find((t) => t.id === id)?.lifecycle;
// dnd-kit mounts its own `role="status"` live region, so find the pill by its copy.
const pill = () =>
  screen.queryByText(/^Moved to /)?.closest<HTMLElement>('[role="status"]') ?? null;

describe("BoardView columns", () => {
  it("renders the five status views in order with their counts", () => {
    seed([
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "active" }),
      makeTask({ lifecycle: "done", completedAt: new Date().toISOString() }),
      makeTask({ lifecycle: "dropped" }),
    ]);
    renderBoard();

    const groups = screen.getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Inbox, 2 tasks",
      "Focus, 1 task",
      "Waiting on, 0 tasks",
      "Someday, 0 tasks",
      "Done, 1 task",
    ]);
    expect(screen.queryByText(/dropped/i)).toBeNull();
    expect(screen.queryByText(/today/i)).toBeNull();
    expect(within(column(/^Inbox/)).getAllByRole("option")).toHaveLength(2);
  });

  it("with zero tasks shows five silent columns: no copy, no hint", () => {
    renderBoard();
    expect(screen.getAllByRole("group")).toHaveLength(5);
    expect(screen.queryByText(/nothing/i)).toBeNull();
    expect(screen.queryByText("to file")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Add" })).toHaveLength(5);
  });

  it("shows the keyboard hint once there is a card", () => {
    seed([makeTask({ lifecycle: "inbox" })]);
    renderBoard();
    expect(screen.getByText("to file")).toBeInTheDocument();
  });

  it("Add on a column asks to capture into that status", async () => {
    const { onAdd } = renderBoard();
    const waitingSection = screen.getByRole("group", { name: /^Waiting on/ }).parentElement!;
    await userEvent.click(within(waitingSection).getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith("waiting");
  });
});

describe("BoardView keyboard", () => {
  it("Shift+Right files the selected Inbox card to Focus and offers undo", async () => {
    const [task] = seed([makeTask({ lifecycle: "inbox", title: "Write the outline" })]);
    renderBoard();

    board().focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "Write the outline" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(lifecycleOf(task!.id)).toBe("active");
    expect(pill()).toHaveTextContent("Moved to Focus");
  });

  it("Shift+Right on a Done card does nothing; Shift+Left on an Inbox card does nothing", async () => {
    const [done, inbox] = seed([
      makeTask({ lifecycle: "done", title: "Finished", completedAt: new Date().toISOString() }),
      makeTask({ lifecycle: "inbox", title: "Fresh" }),
    ]);
    renderBoard();

    screen.getByRole("option", { name: "Finished" }).focus();
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(lifecycleOf(done!.id)).toBe("done");

    screen.getByRole("option", { name: "Fresh" }).focus();
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(lifecycleOf(inbox!.id)).toBe("inbox");
    expect(pill()).toBeNull();
  });

  it("arrows move the selection across and within columns, skipping empty ones", async () => {
    seed([
      makeTask({ lifecycle: "inbox", title: "Inbox A", createdAt: "2026-07-02T00:00:00Z" }),
      makeTask({ lifecycle: "inbox", title: "Inbox B", createdAt: "2026-07-01T00:00:00Z" }),
      makeTask({ lifecycle: "someday", title: "Someday A" }),
    ]);
    renderBoard();
    const selected = () =>
      screen.getByRole("option", { selected: true }).getAttribute("aria-label");

    board().focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(selected()).toBe("Inbox A");
    await userEvent.keyboard("j");
    expect(selected()).toBe("Inbox B");
    await userEvent.keyboard("{ArrowRight}");
    expect(selected()).toBe("Someday A");
    // Back across: same row index, clamped to the destination column.
    await userEvent.keyboard("{ArrowLeft}");
    expect(selected()).toBe("Inbox A");
    await userEvent.keyboard("{ArrowDown}");
    expect(selected()).toBe("Inbox B");
    await userEvent.keyboard("{ArrowDown}");
    expect(selected()).toBe("Inbox B");
    await userEvent.keyboard("k");
    expect(selected()).toBe("Inbox A");
  });

  it("Enter opens the selected card; a plain click opens too", async () => {
    const [task] = seed([makeTask({ lifecycle: "active", title: "Open me" })]);
    const { onOpen } = renderBoard();

    board().focus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onOpen).toHaveBeenCalledWith(task!.id);

    onOpen.mockClear();
    await userEvent.click(screen.getByRole("option", { name: "Open me" }));
    expect(onOpen).toHaveBeenCalledWith(task!.id);
  });
});

describe("BoardView undo", () => {
  it("Undo click restores the previous status and retires the pill", async () => {
    const [task] = seed([makeTask({ lifecycle: "waiting", title: "Chase it" })]);
    renderBoard();

    screen.getByRole("option", { name: "Chase it" }).focus();
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(lifecycleOf(task!.id)).toBe("someday");

    await userEvent.click(within(pill()!).getByRole("button", { name: "Undo" }));
    expect(lifecycleOf(task!.id)).toBe("waiting");
    expect(pill()).toBeNull();
  });

  it("Ctrl+Z undoes within the window and does nothing after it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const [task] = seed([makeTask({ lifecycle: "inbox", title: "Timed" })]);
    renderBoard();

    screen.getByRole("option", { name: "Timed" }).focus();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(lifecycleOf(task!.id)).toBe("active");
    await user.keyboard("{Control>}z{/Control}");
    expect(lifecycleOf(task!.id)).toBe("inbox");
    expect(pill()).toBeNull();

    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(lifecycleOf(task!.id)).toBe("active");
    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS + 50);
    });
    expect(pill()).toBeNull();
    await user.keyboard("{Control>}z{/Control}");
    expect(lifecycleOf(task!.id)).toBe("active");
  });

  it("a newer move replaces the undo record", async () => {
    const [task] = seed([makeTask({ lifecycle: "inbox", title: "Twice" })]);
    renderBoard();

    screen.getByRole("option", { name: "Twice" }).focus();
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(lifecycleOf(task!.id)).toBe("waiting");
    expect(pill()).toHaveTextContent("Moved to Waiting on");

    await userEvent.keyboard("{Control>}z{/Control}");
    expect(lifecycleOf(task!.id)).toBe("active");
  });
});

describe("BoardView complete", () => {
  it("the card's circle files to done and stamps completedAt without opening", async () => {
    const [task] = seed([makeTask({ lifecycle: "someday", title: "Finish me" })]);
    const { onOpen } = renderBoard();

    await userEvent.click(
      within(screen.getByRole("option", { name: "Finish me" })).getByRole("button", {
        name: "Mark as done",
      }),
    );
    const stored = useStore.getState().tasks.find((t) => t.id === task!.id)!;
    expect(stored.lifecycle).toBe("done");
    expect(stored.completedAt).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
    expect(pill()).toHaveTextContent("Moved to Done");
  });

  it("unchecking restores where this session completed it from, else Focus", async () => {
    const [known, unknown] = seed([
      makeTask({ lifecycle: "someday", title: "Known" }),
      makeTask({ lifecycle: "done", title: "Unknown", completedAt: new Date().toISOString() }),
    ]);
    renderBoard();

    await userEvent.click(
      within(screen.getByRole("option", { name: "Known" })).getByRole("button", {
        name: "Mark as done",
      }),
    );
    expect(lifecycleOf(known!.id)).toBe("done");
    await userEvent.click(
      within(screen.getByRole("option", { name: "Known" })).getByRole("button", {
        name: "Mark as not done",
      }),
    );
    expect(lifecycleOf(known!.id)).toBe("someday");

    await userEvent.click(
      within(screen.getByRole("option", { name: "Unknown" })).getByRole("button", {
        name: "Mark as not done",
      }),
    );
    expect(lifecycleOf(unknown!.id)).toBe("active");
    expect(useStore.getState().tasks.find((t) => t.id === unknown!.id)!.completedAt).toBeNull();
  });
});
