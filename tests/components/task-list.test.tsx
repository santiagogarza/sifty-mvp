// @vitest-environment jsdom
import { TaskList } from "@/components/tasks/task-list";
import { Toaster, useToastStore } from "@/components/ui/toast";
import { resolveSnooze } from "@/lib/domain/snooze";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SIF-5: when the focused row leaves the list, focus lands on a neighbor so
 * j/k keep working without a click.
 */

function makeTask(id: string, title = id): Task {
  return {
    id,
    sourceText: title,
    sourceContext: null,
    title,
    description: null,
    nextAction: null,
    lifecycle: "active",
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
    siftId: null,
    siftStage: null,
    plan: null,
    siftedWithAssumptions: false,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    completedAt: null,
  };
}

const three = [makeTask("a", "Alpha"), makeTask("b", "Beta"), makeTask("c", "Gamma")];

function row(title: string) {
  return screen.getByRole("option", { name: new RegExp(title) });
}

function renderList(tasks: Task[]) {
  const onOpen = vi.fn();
  const view = render(<TaskList tasks={tasks} onOpen={onOpen} emptyState={<div>All clear</div>} />);
  const rerenderWith = (next: Task[]) =>
    view.rerender(<TaskList tasks={next} onOpen={onOpen} emptyState={<div>All clear</div>} />);
  return { rerenderWith, onOpen };
}

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [] });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
});

describe("TaskList focus recovery", () => {
  it("moves focus to the row that took the removed row's position", async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderList(three);

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(row("Beta")).toHaveFocus();

    rerenderWith([three[0]!, three[2]!]);
    expect(row("Gamma")).toHaveFocus();

    // j/k keep working right away.
    await user.keyboard("{ArrowUp}");
    expect(row("Alpha")).toHaveFocus();
  });

  it("falls back to the new last row when the last row is removed", async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderList(three);

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(row("Gamma")).toHaveFocus();

    rerenderWith([three[0]!, three[1]!]);
    expect(row("Beta")).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(row("Alpha")).toHaveFocus();
  });

  it("hands focus to the empty state when the only row is removed", async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderList([three[0]!]);

    await user.keyboard("{ArrowDown}");
    expect(row("Alpha")).toHaveFocus();

    rerenderWith([]);
    const empty = screen.getByText("All clear");
    expect(empty).toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.contains(empty)).toBe(true);
  });

  it("keeps focus through a completion ghost and lands on the empty state after it collapses", async () => {
    const user = userEvent.setup();
    const only = makeTask("solo", "Solo");
    // Real completion path: the task stays in the store as done, so the
    // list renders a ghost before the empty state takes over.
    useStore.setState({ tasks: [only], labels: [] });
    const onOpen = vi.fn();
    const view = render(
      <TaskList tasks={[only]} onOpen={onOpen} emptyState={<div>All clear</div>} />,
    );

    await user.keyboard("{ArrowDown}");
    expect(row("Solo")).toHaveFocus();

    useStore.setState({ tasks: [{ ...only, lifecycle: "done" }] });
    view.rerender(<TaskList tasks={[]} onOpen={onOpen} emptyState={<div>All clear</div>} />);

    // Ghost phase: the struck row lingers, focus stays inside the list.
    const ghost = screen.getByRole("option", { name: /Solo/ });
    expect(ghost).toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("listbox", { name: "Tasks" })).toContainElement(
      document.activeElement as HTMLElement,
    );

    // jsdom has no AnimationEvent, so React listens for the webkit-prefixed
    // name there; hand-build the event with the animation name React reads.
    const end = new Event("webkitAnimationEnd", { bubbles: true });
    Object.defineProperty(end, "animationName", { value: "sifty-ghost-collapse" });
    fireEvent(ghost.closest(".ghost-collapse")!, end);
    const empty = screen.getByText("All clear");
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.contains(empty)).toBe(true);
  });

  it("recovers after a pointer press on the row, not only keyboard focus", async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderList(three);

    await user.click(screen.getAllByRole("button", { name: "Mark as done" })[0]!);
    // Simulate Safari: the click did not leave focus on the button.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    rerenderWith([three[1]!, three[2]!]);
    expect(row("Beta")).toHaveFocus();
  });

  it("does not steal focus that already moved to another surface", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const view = render(
      <>
        <TaskList tasks={three} onOpen={onOpen} emptyState={<div>All clear</div>} />
        <input aria-label="Elsewhere" />
      </>,
    );

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(row("Beta")).toHaveFocus();
    const elsewhere = screen.getByLabelText("Elsewhere");
    elsewhere.focus();

    view.rerender(
      <>
        <TaskList
          tasks={[three[0]!, three[2]!]}
          onOpen={onOpen}
          emptyState={<div>All clear</div>}
        />
        <input aria-label="Elsewhere" />
      </>,
    );
    expect(elsewhere).toHaveFocus();
  });
});

/** SIF-22: Shift+click range selection and the bulk bar. */
describe("TaskList bulk select", () => {
  const five = ["a", "b", "c", "d", "e"].map((id) => makeTask(id, `Task ${id.toUpperCase()}`));

  function seedStore(tasks: Task[]) {
    useStore.setState({ tasks, labels: [] });
  }

  it("Shift+click selects the range from the anchor, inclusive, and does not open", async () => {
    const user = userEvent.setup();
    seedStore(five);
    const { onOpen } = renderList(five);

    await user.click(row("Task B"));
    expect(onOpen).toHaveBeenCalledWith("b");
    await user.keyboard("{Shift>}");
    await user.click(row("Task E"));
    await user.keyboard("{/Shift}");

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("bulk-bar")).toHaveTextContent("4 selected");
    for (const name of ["Task B", "Task C", "Task D", "Task E"]) {
      expect(row(name)).toHaveAttribute("data-selected", "true");
    }
    expect(row("Task A")).not.toHaveAttribute("data-selected");
  });

  it("a plain click collapses the selection; Escape clears it", async () => {
    const user = userEvent.setup();
    seedStore(five);
    renderList(five);

    await user.click(row("Task A"));
    await user.keyboard("{Shift>}");
    await user.click(row("Task C"));
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("bulk-bar")).toHaveTextContent("3 selected");

    await user.click(row("Task D"));
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    expect(row("Task C")).not.toHaveAttribute("data-selected");

    await user.keyboard("{Shift>}");
    await user.click(row("Task E"));
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("bulk-bar")).toHaveTextContent("2 selected");
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
  });

  it("Move to Someday patches every selected task and clears the selection", async () => {
    const user = userEvent.setup();
    seedStore(five);
    renderList(five);

    await user.click(row("Task B"));
    await user.keyboard("{Shift>}");
    await user.click(row("Task D"));
    await user.keyboard("{/Shift}");
    await user.click(screen.getByRole("button", { name: /Move to Someday/ }));

    const byId = new Map(useStore.getState().tasks.map((t) => [t.id, t]));
    expect(byId.get("b")!.lifecycle).toBe("someday");
    expect(byId.get("c")!.lifecycle).toBe("someday");
    expect(byId.get("d")!.lifecycle).toBe("someday");
    expect(byId.get("a")!.lifecycle).toBe("active");
    expect(byId.get("e")!.lifecycle).toBe("active");
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["Moved 3 to Someday"]);
  });

  it("an anchor that left the list is replaced by the active row", async () => {
    const user = userEvent.setup();
    seedStore(five);
    const { rerenderWith } = renderList(five);

    // Anchor on B, then B leaves the view; focus recovery makes C active.
    await user.click(row("Task B"));
    rerenderWith(five.filter((t) => t.id !== "b"));
    expect(row("Task C")).toHaveFocus();

    await user.keyboard("{Shift>}");
    await user.click(row("Task E"));
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("bulk-bar")).toHaveTextContent("3 selected");
    for (const name of ["Task C", "Task D", "Task E"]) {
      expect(row(name)).toHaveAttribute("data-selected", "true");
    }
  });

  it("Clear drops the selection without touching any task", async () => {
    const user = userEvent.setup();
    seedStore(five);
    renderList(five);

    await user.click(row("Task A"));
    await user.keyboard("{Shift>}");
    await user.click(row("Task C"));
    await user.keyboard("{/Shift}");
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    expect(screen.queryAllByRole("option").some((el) => el.hasAttribute("data-selected"))).toBe(
      false,
    );
    expect(useStore.getState().tasks.every((t) => t.lifecycle === "active")).toBe(true);
  });

  it("the complete circle still completes one task without touching the selection", async () => {
    const user = userEvent.setup();
    seedStore(five);
    renderList(five);

    await user.click(row("Task A"));
    await user.keyboard("{Shift>}");
    await user.click(row("Task B"));
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("bulk-bar")).toHaveTextContent("2 selected");

    const circles = screen.getAllByRole("button", { name: "Mark as done" });
    await user.click(circles[4]!);
    expect(useStore.getState().tasks.find((t) => t.id === "e")!.lifecycle).toBe("done");
    expect(screen.getByTestId("bulk-bar")).toHaveTextContent("2 selected");
  });
});

/** SIF-9: `s` then `t` / `w` snoozes the active row with an undoable toast. */
describe("TaskList snooze keys", () => {
  it("s then t sets due to tomorrow, and Undo restores it", async () => {
    const user = userEvent.setup();
    const tasks = [makeTask("a", "Alpha"), makeTask("b", "Beta")];
    useStore.setState({ tasks, labels: [] });
    render(
      <>
        <TaskList tasks={tasks} onOpen={vi.fn()} />
        <Toaster />
      </>,
    );

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(row("Beta")).toHaveFocus();
    await user.keyboard("s");
    expect(screen.getByTestId("snooze-hint")).toBeInTheDocument();
    await user.keyboard("t");

    const due = useStore.getState().tasks.find((t) => t.id === "b")!.due;
    expect(due).toBe(resolveSnooze("tomorrow"));
    expect(useStore.getState().tasks.find((t) => t.id === "a")!.due).toBeNull();
    expect(screen.queryByTestId("snooze-hint")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(useStore.getState().tasks.find((t) => t.id === "b")!.due).toBeNull();
  });

  it("a clicked row becomes the active row, so s works right after opening it", async () => {
    const user = userEvent.setup();
    const tasks = [makeTask("a", "Alpha"), makeTask("b", "Beta"), makeTask("c", "Gamma")];
    useStore.setState({ tasks, labels: [] });
    render(<TaskList tasks={tasks} onOpen={vi.fn()} />);

    await user.click(row("Beta"));
    expect(row("Beta")).toHaveAttribute("aria-selected", "true");
    await user.keyboard("st");
    expect(useStore.getState().tasks.find((t) => t.id === "b")!.due).toBe(
      resolveSnooze("tomorrow"),
    );
    // j continues from the clicked row.
    await user.keyboard("{ArrowDown}");
    expect(row("Gamma")).toHaveFocus();
  });

  it("a held s (key repeat) or a second s keeps the chord armed", async () => {
    const user = userEvent.setup();
    const tasks = [makeTask("a", "Alpha")];
    useStore.setState({ tasks, labels: [] });
    render(<TaskList tasks={tasks} onOpen={vi.fn()} />);

    await user.keyboard("{ArrowDown}");
    await user.keyboard("s");
    expect(screen.getByTestId("snooze-hint")).toBeInTheDocument();
    fireEvent.keyDown(row("Alpha"), { key: "s", repeat: true });
    fireEvent.keyDown(row("Alpha"), { key: "s" });
    expect(screen.getByTestId("snooze-hint")).toBeInTheDocument();

    await user.keyboard("t");
    expect(useStore.getState().tasks[0]!.due).toBe(resolveSnooze("tomorrow"));
  });

  it("Escape cancels a pending chord and a selection together", async () => {
    const user = userEvent.setup();
    const tasks = [makeTask("a", "Alpha"), makeTask("b", "Beta"), makeTask("c", "Gamma")];
    useStore.setState({ tasks, labels: [] });
    render(<TaskList tasks={tasks} onOpen={vi.fn()} />);

    await user.click(row("Alpha"));
    await user.keyboard("{Shift>}");
    await user.click(row("Gamma"));
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("bulk-bar")).toHaveTextContent("3 selected");
    await user.keyboard("s");
    expect(screen.getByTestId("snooze-hint")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    expect(screen.queryByTestId("snooze-hint")).toBeNull();
    await user.keyboard("t");
    expect(useStore.getState().tasks.every((t) => t.due === null)).toBe(true);
  });

  it("a chord left hanging expires after two seconds", async () => {
    const tasks = [makeTask("a", "Alpha")];
    useStore.setState({ tasks, labels: [] });
    render(<TaskList tasks={tasks} onOpen={vi.fn()} />);

    fireEvent.keyDown(screen.getByRole("listbox", { name: "Tasks" }), { key: "ArrowDown" });
    fireEvent.keyDown(row("Alpha"), { key: "s" });
    expect(screen.getByTestId("snooze-hint")).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByTestId("snooze-hint")).toBeNull(), {
      timeout: 3_000,
    });
    fireEvent.keyDown(row("Alpha"), { key: "t" });
    expect(useStore.getState().tasks[0]!.due).toBeNull();
  });

  it("s then w lands on next Monday; Escape cancels a pending snooze", async () => {
    const user = userEvent.setup();
    const tasks = [makeTask("a", "Alpha")];
    useStore.setState({ tasks, labels: [] });
    render(<TaskList tasks={tasks} onOpen={vi.fn()} />);

    await user.keyboard("{ArrowDown}");
    await user.keyboard("s{Escape}");
    expect(screen.queryByTestId("snooze-hint")).toBeNull();
    expect(useStore.getState().tasks[0]!.due).toBeNull();

    await user.keyboard("sw");
    expect(useStore.getState().tasks[0]!.due).toBe(resolveSnooze("next_week"));
  });
});
