// @vitest-environment jsdom

import DonePage from "@/app/(app)/done/page";
import {
  BOARD_POINTER_DISTANCE_PX,
  BOARD_TOUCH_HOLD_MS,
  BOARD_UNDO_MS,
  BoardView,
} from "@/components/tasks/board-view";
import { TaskView } from "@/components/tasks/task-view";
import { VIEW_MODE_KEY, setViewMode, useViewMode } from "@/components/tasks/use-view-mode";
import type { Label, Task } from "@/lib/domain/types";
import { selectInboxTasks } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { formatRelativeDay } from "@/lib/utils/dates";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({
    openDetail: vi.fn(),
    openCapture: vi.fn(),
    openCommand: vi.fn(),
    syncError: false,
  }),
}));

const NOW = "2026-07-22T12:00:00.000Z";

function makeTask(patch: Partial<Task> = {}): Task {
  return {
    id: "task_card",
    sourceText: "Ship the note",
    sourceContext: null,
    title: "Ship the note",
    description: null,
    nextAction: "Send the draft",
    lifecycle: "inbox",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.8,
    importance: 0.8,
    priorityBucket: "do_now",
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

function focusBoard() {
  screen.getByRole("listbox", { name: "Board" }).focus();
}

function ConnectedBoard({
  onOpen = vi.fn(),
  onAdd = vi.fn(),
}: {
  onOpen?: (id: string) => void;
  onAdd?: (status: Task["lifecycle"]) => void;
}) {
  const tasks = useStore((s) => s.tasks);
  return <BoardView tasks={tasks} onOpen={onOpen} onAdd={onAdd} />;
}

beforeEach(() => {
  localStorage.clear();
  setViewMode("list");
  useStore.setState({ tasks: [], labels: [], memories: [], hydrated: true });
});

describe("useViewMode", () => {
  it("updates every subscriber from one write", () => {
    function Readout({ id }: { id: string }) {
      const mode = useViewMode();
      return <span data-testid={id}>{mode}</span>;
    }
    render(
      <>
        <Readout id="a" />
        <Readout id="b" />
      </>,
    );
    expect(screen.getByTestId("a")).toHaveTextContent("list");
    expect(screen.getByTestId("b")).toHaveTextContent("list");
    act(() => setViewMode("board"));
    expect(screen.getByTestId("a")).toHaveTextContent("board");
    expect(screen.getByTestId("b")).toHaveTextContent("board");
    expect(localStorage.getItem(VIEW_MODE_KEY)).toBe("board");
  });
});

describe("BoardView", () => {
  it("exposes the pointer and touch activation constraints", () => {
    expect(BOARD_POINTER_DISTANCE_PX).toBe(8);
    expect(BOARD_TOUCH_HOLD_MS).toBe(250);
  });

  it("renders five silent columns when there are no tasks", () => {
    render(<BoardView tasks={[]} onOpen={vi.fn()} onAdd={vi.fn()} />);
    const regions = screen.getAllByRole("region");
    expect(regions.map((region) => region.getAttribute("aria-label"))).toEqual([
      "Inbox, 0",
      "Focus, 0",
      "Waiting on, 0",
      "Someday, 0",
      "Done, 0",
    ]);
    expect(screen.queryByRole("region", { name: /Dropped/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Today/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("board-hint")).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Inbox, 0" }).querySelector("[data-empty-drop]"),
    ).toHaveClass("h-[88px]");
  });

  it("shows the hint, and a click opens the card", async () => {
    const task = makeTask();
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<BoardView tasks={[task]} onOpen={onOpen} onAdd={vi.fn()} />);
    expect(screen.getByTestId("board-hint")).toHaveClass("hidden");
    await user.click(screen.getByText("Ship the note"));
    expect(onOpen).toHaveBeenCalledWith(task.id);
  });

  it("prefers the assignee badge over the label and shows the due", () => {
    const label: Label = { id: "label_work", name: "Work", tone: "neutral" };
    useStore.setState({ labels: [label] });
    const due = "2020-01-15";
    render(
      <BoardView
        tasks={[
          makeTask({
            due,
            delegationCandidate: "person",
            assigneeName: "Ada Lovelace",
            labelIds: [label.id],
          }),
        ]}
        onOpen={vi.fn()}
        onAdd={vi.fn()}
      />,
    );
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByText("Work")).not.toBeInTheDocument();
    expect(screen.getByText(formatRelativeDay(due) ?? "")).toBeInTheDocument();
    expect(screen.getByText("Send the draft")).toBeInTheDocument();
  });

  it("files the selected inbox card with Shift+Right and undoes it", async () => {
    const task = makeTask();
    useStore.setState({ tasks: [task] });
    const user = userEvent.setup();
    render(<ConnectedBoard />);
    focusBoard();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");

    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");
    expect(screen.getByText("Moved to Focus")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("inbox");
    expect(screen.queryByText(/Moved to/)).not.toBeInTheDocument();
  });

  it("replaces the previous undo when a second move lands", async () => {
    const task = makeTask();
    useStore.setState({ tasks: [task] });
    const user = userEvent.setup();
    render(<ConnectedBoard />);
    focusBoard();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    focusBoard();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("waiting");
    expect(screen.getByText("Moved to Waiting on")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");
  });

  it("does not file past Done", async () => {
    const inbox = makeTask({ id: "task_in", title: "Still open" });
    const done = makeTask({
      id: "task_done",
      title: "Already done",
      lifecycle: "done",
      completedAt: NOW,
      nextAction: "Should stay hidden",
    });
    useStore.setState({ tasks: [inbox, done] });
    const user = userEvent.setup();
    render(<ConnectedBoard />);
    focusBoard();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(useStore.getState().tasks.find((t) => t.id === "task_done")?.lifecycle).toBe("done");
    expect(screen.queryByText(/Moved to/)).not.toBeInTheDocument();
    expect(screen.queryByText("Should stay hidden")).not.toBeInTheDocument();
  });

  it("opens the selected card with Enter", async () => {
    const task = makeTask();
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<BoardView tasks={[task]} onOpen={onOpen} onAdd={vi.fn()} />);
    focusBoard();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(task.id);
  });

  it("undoes with Ctrl+Z and ignores it after the pill retires", async () => {
    const pending: Array<() => void> = [];
    const real = window.setTimeout.bind(window);
    const spy = vi.spyOn(window, "setTimeout").mockImplementation(((
      fn: TimerHandler,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === BOARD_UNDO_MS && typeof fn === "function") {
        pending.push(() => fn(...args));
        return 0;
      }
      return real(fn, ms, ...args);
    }) as typeof window.setTimeout);

    const task = makeTask();
    useStore.setState({ tasks: [task] });
    const user = userEvent.setup();
    render(<ConnectedBoard />);
    focusBoard();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");
    focusBoard();
    await user.keyboard("{Control>}z{/Control}");
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("inbox");

    focusBoard();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(pending.length).toBeGreaterThan(0);
    act(() => {
      for (const fire of pending) fire();
    });
    expect(screen.queryByText(/Moved to/)).not.toBeInTheDocument();
    focusBoard();
    await user.keyboard("{Control>}z{/Control}");
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");
    spy.mockRestore();
  });

  it("completes from the card and restores the lifecycle this session knew", async () => {
    const task = makeTask({ lifecycle: "waiting", title: "Waiting card" });
    useStore.setState({ tasks: [task] });
    const user = userEvent.setup();
    render(<ConnectedBoard />);
    await user.click(screen.getByRole("button", { name: "Mark as done" }));
    let stored = useStore.getState().tasks[0];
    expect(stored?.lifecycle).toBe("done");
    expect(stored?.completedAt).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Mark as not done" }));
    stored = useStore.getState().tasks[0];
    expect(stored?.lifecycle).toBe("waiting");
    expect(stored?.completedAt).toBeNull();
  });

  it("asks the column for a capture in that status", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<BoardView tasks={[]} onOpen={vi.fn()} onAdd={onAdd} />);
    await user.click(screen.getByRole("button", { name: "Add to Focus" }));
    expect(onAdd).toHaveBeenCalledWith("active");
  });

  it("gives each column its own vertical scroll", () => {
    const tasks = Array.from({ length: 40 }, (_, i) =>
      makeTask({
        id: `task_${i}`,
        title: `Card ${i}`,
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
      }),
    );
    render(<BoardView tasks={tasks} onOpen={vi.fn()} onAdd={vi.fn()} />);
    const scrolls = screen.getAllByTestId("column-scroll");
    expect(scrolls.length).toBe(5);
    expect(scrolls[0]).toHaveClass("overflow-y-auto");
    expect(
      within(screen.getByRole("region", { name: /Inbox,/ })).getByText("Card 0"),
    ).toBeInTheDocument();
  });
});

describe("TaskView toggle", () => {
  it("swaps the header and renders the five columns", async () => {
    useStore.setState({ tasks: [makeTask()], hydrated: true });
    const user = userEvent.setup();
    render(
      <TaskView
        title="Inbox"
        description="Newly captured tasks."
        selector={selectInboxTasks}
        emptyTitle="Inbox zero."
      />,
    );
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Board" }));
    expect(screen.getByRole("heading", { name: "Everything, by status" })).toBeInTheDocument();
    expect(screen.getByText(/Drag a card to another column/)).toBeInTheDocument();
    expect(screen.getAllByRole("region")).toHaveLength(5);
    await user.click(screen.getByRole("radio", { name: "List" }));
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
  });
});

describe("Done page", () => {
  it("hides the Dropped disclosure in Board and brings it back in List", async () => {
    useStore.setState({
      hydrated: true,
      tasks: [makeTask({ id: "task_drop", title: "Let it go", lifecycle: "dropped" })],
    });
    const user = userEvent.setup();
    render(<DonePage />);
    expect(screen.getByRole("button", { name: /Dropped/ })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Board" }));
    expect(screen.queryByRole("button", { name: /Dropped/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Dropped/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "List" }));
    expect(screen.getByRole("button", { name: /Dropped/ })).toBeInTheDocument();
  });
});
