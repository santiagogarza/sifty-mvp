// @vitest-environment jsdom
import { TaskBoard } from "@/components/tasks/task-board";
import { STATUSES_IN_ORDER } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Board contract, driven through dnd-kit's real sensors: a move lands in
 * the store via `setLifecycle` (the same path that syncs to the server),
 * is announced to screen readers, and a plain click still opens the task.
 *
 * jsdom has no layout, so each status column gets a slot on a horizontal
 * strip, its cards sit inside that slot, and the fixed drag overlay reports
 * the rect dnd-kit positioned it at.
 */

const SLOT = { width: 150, gap: 10, height: 600 };

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function layout(this: Element): DOMRect {
  const column = this.closest("[data-status]");
  if (column) {
    const index = STATUSES_IN_ORDER.indexOf(column.getAttribute("data-status") as Lifecycle);
    const left = index * (SLOT.width + SLOT.gap);
    return this === column
      ? rect(left, 0, SLOT.width, SLOT.height)
      : rect(left + 6, 40, SLOT.width - 12, 56);
  }
  // dnd-kit measures the overlay's first child, so resolve to the wrapper.
  const overlay = this.closest<HTMLElement>('[style*="position: fixed"]');
  if (overlay) {
    const px = (v: string) => Number.parseFloat(v) || 0;
    const { left, top, width, height } = overlay.style;
    return rect(px(left), px(top), px(width), px(height));
  }
  return rect(0, 0, 0, 0);
}

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  const now = new Date().toISOString();
  return {
    id: `task_board_${seq}`,
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

function storedTask(id: string): Task {
  const task = useStore.getState().tasks.find((t) => t.id === id);
  if (!task) throw new Error(`no task ${id}`);
  return task;
}

function column(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

let inboxTask: Task;
let somedayTask: Task;
let droppedTask: Task;

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(layout);
  inboxTask = makeTask({ title: "Draft outline", lifecycle: "inbox" });
  somedayTask = makeTask({ title: "Read the review", lifecycle: "someday" });
  droppedTask = makeTask({ title: "Old idea", lifecycle: "dropped" });
  useStore.setState({
    hydrated: true,
    labels: [],
    tasks: [
      inboxTask,
      makeTask({ title: "Ship fix", lifecycle: "active" }),
      somedayTask,
      droppedTask,
    ],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  useStore.setState({ tasks: [], labels: [] });
});

describe("TaskBoard", () => {
  it("renders every status as a column in pipeline order, Dropped tucked into a rail", async () => {
    const user = userEvent.setup();
    render(<TaskBoard onOpen={() => {}} />);

    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Inbox",
      "Focus",
      "Waiting on",
      "Someday",
      "Done",
    ]);
    expect(within(column("Inbox")).getByRole("button", { name: /Draft outline/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Old idea/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show Dropped, 1 task" }));
    expect(within(column("Dropped")).getByRole("button", { name: /Old idea/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Hide Dropped" })).toHaveFocus();
  });

  it("opens a card on click or Enter instead of dragging it", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<TaskBoard onOpen={onOpen} />);
    const card = screen.getByRole("button", { name: /Draft outline/ });

    await user.click(card);
    card.focus();
    await user.keyboard("{Enter}");

    expect(onOpen.mock.calls).toEqual([[inboxTask.id], [inboxTask.id]]);
    expect(storedTask(inboxTask.id).lifecycle).toBe("inbox");
    expect(card).toHaveAccessibleDescription(/press Space/);
  });

  it("moves a card between columns with the keyboard and announces it", async () => {
    const user = userEvent.setup();
    render(<TaskBoard onOpen={() => {}} />);

    screen.getByRole("button", { name: /Draft outline/ }).focus();
    await user.keyboard("[Space][ArrowRight][ArrowRight][ArrowLeft][Space]");

    expect(storedTask(inboxTask.id).lifecycle).toBe("active");
    expect(screen.getByRole("status")).toHaveTextContent("Moved Draft outline to Focus.");
    // Focus follows the card into its new column.
    const moved = within(column("Focus")).getByRole("button", { name: /Draft outline/ });
    await waitFor(() => expect(moved).toHaveFocus());
  });

  it("leaves the card where it was when the move is cancelled", async () => {
    const user = userEvent.setup();
    render(<TaskBoard onOpen={() => {}} />);

    screen.getByRole("button", { name: /Draft outline/ }).focus();
    await user.keyboard("[Space][ArrowRight][Escape]");

    expect(storedTask(inboxTask.id).lifecycle).toBe("inbox");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Move cancelled. Draft outline stays in Inbox.",
    );
  });

  it("completes a task dropped on Done and reopens it when it leaves", async () => {
    const user = userEvent.setup();
    render(<TaskBoard onOpen={() => {}} />);

    screen.getByRole("button", { name: /Read the review/ }).focus();
    await user.keyboard("[Space][ArrowRight][Space]");
    expect(storedTask(somedayTask.id).lifecycle).toBe("done");
    expect(storedTask(somedayTask.id).completedAt).not.toBeNull();

    // The collapsed Dropped rail is still a drop target.
    within(column("Done"))
      .getByRole("button", { name: /Read the review/ })
      .focus();
    await user.keyboard("[Space][ArrowRight][Space]");
    expect(storedTask(somedayTask.id).lifecycle).toBe("dropped");
    expect(storedTask(somedayTask.id).completedAt).toBeNull();
    expect(screen.getByRole("button", { name: "Show Dropped, 2 tasks" })).toBeVisible();
  });
});
