// @vitest-environment jsdom
import { TaskList } from "@/components/tasks/task-list";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Focus recovery: when the focused row leaves the list (completed, snoozed,
 * re-dated out of the view), focus lands on a neighbor or the container,
 * never on <body>, so j/k keep working without a click.
 */

const NOW = "2026-07-22T12:00:00.000Z";

function makeTask(n: number, patch: Partial<Task> = {}): Task {
  return {
    id: `t${n}`,
    sourceText: "test",
    sourceContext: null,
    title: `Task ${n}`,
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
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...patch,
  };
}

const ACTIVE: Lifecycle[] = ["inbox", "active"];

function ActiveView() {
  const tasks = useStore((s) => s.tasks);
  const visible = tasks.filter((t) => ACTIVE.includes(t.lifecycle));
  return (
    <TaskList
      tasks={visible}
      onOpen={() => {}}
      emptyState={
        <div>
          <p>All clear</p>
          <button type="button">Capture a task</button>
        </div>
      }
    />
  );
}

function seed(count: number) {
  useStore.setState({
    tasks: Array.from({ length: count }, (_, i) => makeTask(i + 1)),
    labels: [],
  });
}

function row(title: string) {
  return screen.getByText(title).closest<HTMLElement>('[role="option"]');
}

function setLifecycle(id: string, lifecycle: Lifecycle) {
  act(() => useStore.getState().setLifecycle(id, lifecycle));
}

function collapseGhosts() {
  for (const el of document.querySelectorAll(".ghost-collapse")) {
    // jsdom has no AnimationEvent, so React listens for the webkit-prefixed
    // name and animationName has to be set by hand.
    const ev = new Event("webkitAnimationEnd", { bubbles: true });
    Object.defineProperty(ev, "animationName", { value: "sifty-ghost-collapse" });
    el.dispatchEvent(ev);
  }
}

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [] });
});

afterEach(() => {
  cleanup();
});

describe("TaskList keyboard nav", () => {
  it("j/k move focus between rows", async () => {
    seed(3);
    const user = userEvent.setup();
    render(<ActiveView />);
    expect(screen.getByRole("listbox")).toHaveFocus();

    await user.keyboard("j");
    expect(row("Task 1")).toHaveFocus();
    await user.keyboard("j");
    expect(row("Task 2")).toHaveFocus();
    await user.keyboard("k");
    expect(row("Task 1")).toHaveFocus();
  });
});

describe("TaskList focus recovery", () => {
  it("completing a row focuses the task that took its position", async () => {
    seed(3);
    const user = userEvent.setup();
    render(<ActiveView />);
    await user.keyboard("jj");
    expect(row("Task 2")).toHaveFocus();

    setLifecycle("t2", "done");

    expect(document.activeElement).not.toBe(document.body);
    expect(row("Task 3")).toHaveFocus();
    expect(row("Task 3")).toHaveAttribute("aria-selected", "true");
    // The completion ghost still renders in place, struck through.
    expect(document.querySelector(".ghost-collapse")).toHaveTextContent("Task 2");

    await user.keyboard("k");
    expect(row("Task 1")).toHaveFocus();
    await user.keyboard("j");
    expect(row("Task 3")).toHaveFocus();
  });

  it("completing the last row focuses the new last row", async () => {
    seed(3);
    const user = userEvent.setup();
    render(<ActiveView />);
    await user.keyboard("jjj");
    expect(row("Task 3")).toHaveFocus();

    setLifecycle("t3", "done");

    expect(row("Task 2")).toHaveFocus();
    await user.keyboard("k");
    expect(row("Task 1")).toHaveFocus();
    await user.keyboard("j");
    expect(row("Task 2")).toHaveFocus();
  });

  it("completing the only row focuses the container and keeps the empty state reachable", async () => {
    seed(1);
    const user = userEvent.setup();
    const { container } = render(<ActiveView />);
    await user.keyboard("j");
    expect(row("Task 1")).toHaveFocus();

    setLifecycle("t1", "done");
    const list = container.firstElementChild as HTMLElement;
    expect(list).toHaveFocus();

    act(() => collapseGhosts());
    expect(screen.getByText("All clear")).toBeInTheDocument();
    expect(list).toHaveFocus();
    expect(list).not.toHaveAttribute("role");

    // j/k are harmless no-ops on an empty list, and focus stays put.
    await user.keyboard("jk");
    expect(list).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Capture a task" })).toHaveFocus();
  });

  it("recovers when a row leaves the view without being completed", async () => {
    seed(3);
    const user = userEvent.setup();
    render(<ActiveView />);
    await user.keyboard("j");
    expect(row("Task 1")).toHaveFocus();

    setLifecycle("t1", "waiting");

    expect(row("Task 2")).toHaveFocus();
    await user.keyboard("j");
    expect(row("Task 3")).toHaveFocus();
  });

  it("does not pull focus back while focus is elsewhere, then resumes on the neighbor", async () => {
    seed(2);
    const user = userEvent.setup();
    render(
      <>
        <ActiveView />
        <input aria-label="elsewhere" />
      </>,
    );
    await user.keyboard("j");
    expect(row("Task 1")).toHaveFocus();
    const input = screen.getByLabelText("elsewhere");
    await user.click(input);

    setLifecycle("t1", "done");
    expect(input).toHaveFocus();

    // The detail sheet hands focus back to the container on close when its
    // opener row is gone; the list then picks the neighbor.
    act(() => screen.getByRole("listbox").focus());
    expect(row("Task 2")).toHaveFocus();
    await user.keyboard("k");
    expect(row("Task 2")).toHaveFocus();
  });
});
