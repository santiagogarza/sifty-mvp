// @vitest-environment jsdom
import { TaskList } from "@/components/tasks/task-list";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen } from "@testing-library/react";
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
