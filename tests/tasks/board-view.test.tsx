// @vitest-environment jsdom

import { AppFrame, useFrame } from "@/components/app-shell/app-frame";
import {
  BOARD_POINTER_DISTANCE_PX,
  BOARD_TOUCH_HOLD_MS,
  BoardView,
  resetBoardSessionForTests,
} from "@/components/tasks/board-view";
import { TaskView } from "@/components/tasks/task-view";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { selectInboxTasks } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import {
  VIEW_MODE_STORAGE_KEY,
  getViewMode,
  hydrateViewModeFromStorage,
  resetViewModeForTests,
} from "@/lib/store/view-mode";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/ai/run-triage", () => ({
  runTriage: vi.fn(),
  isTriageInFlight: () => false,
}));

const NOW = "2026-07-22T12:00:00.000Z";

let seq = 0;
function makeTask(patch: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `task_ui_${seq}`,
    sourceText: patch.title ?? `Task ${seq}`,
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
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...patch,
  };
}

function seed(tasks: Task[]) {
  useStore.setState({ tasks, labels: [], memories: [], hydrated: true });
}

function task(id: string): Task {
  const found = useStore.getState().tasks.find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

/** BoardView reads tasks from props; the harness keeps those props live. */
function LiveBoard({
  onOpen,
  onAdd,
}: {
  onOpen: (id: string) => void;
  onAdd?: (status: Lifecycle) => void;
}) {
  const tasks = useStore((s) => s.tasks);
  return <BoardView tasks={tasks} onOpen={onOpen} onAdd={onAdd} />;
}

function CaptureHarness() {
  const { openCapture } = useFrame();
  return (
    <>
      <button type="button" onClick={() => openCapture({ lifecycle: "waiting" })}>
        Open waiting
      </button>
      <button type="button" onClick={() => openCapture()}>
        Open plain
      </button>
    </>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  localStorage.clear();
  resetViewModeForTests();
  resetBoardSessionForTests();
  useStore.setState({ tasks: [], labels: [], memories: [], hydrated: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: "Not signed in" }), { status: 401 })),
  );
});

describe("BoardView", () => {
  it("locks the pointer and touch drag thresholds", () => {
    expect(BOARD_POINTER_DISTANCE_PX).toBe(8);
    expect(BOARD_TOUCH_HOLD_MS).toBe(250);
  });

  it("renders five silent columns when empty, with no hint", () => {
    render(<BoardView tasks={[]} onOpen={vi.fn()} />);
    expect(screen.getAllByRole("region")).toHaveLength(5);
    expect(screen.getByRole("region", { name: "Inbox, 0" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Focus, 0" })).toBeInTheDocument();
    expect(screen.queryByText(/nothing/i)).not.toBeInTheDocument();
    expect(document.querySelector("[data-keyboard-hint]")).toBeNull();
  });

  it("opens a card on click and on Enter, without a lifecycle write", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const inbox = makeTask({ title: "Open me", lifecycle: "inbox" });
    seed([inbox]);
    render(<LiveBoard onOpen={onOpen} />);

    await user.click(screen.getByText("Open me"));
    expect(onOpen).toHaveBeenCalledWith(inbox.id);
    expect(task(inbox.id).lifecycle).toBe("inbox");

    onOpen.mockClear();
    screen.getByRole("listbox", { name: "Board" }).focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(inbox.id);
  });

  it("files the selected card with Shift+Arrow and refuses the end of the pipeline", async () => {
    const user = userEvent.setup();
    const inbox = makeTask({ title: "File me", lifecycle: "inbox" });
    const done = makeTask({ title: "Already done", lifecycle: "done", completedAt: NOW });
    seed([inbox, done]);
    render(<LiveBoard onOpen={vi.fn()} />);

    screen.getByRole("listbox", { name: "Board" }).focus();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");

    expect(task(inbox.id).lifecycle).toBe("active");
    expect(screen.getByText("Moved to Focus")).toBeInTheDocument();

    const doneCard = screen.getByText("Already done").closest("[data-board-card]");
    if (!(doneCard instanceof HTMLElement)) throw new Error("missing done card");
    doneCard.focus();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(task(done.id).lifecycle).toBe("done");
  });

  it("undoes from the pill and from Ctrl+Z, then ignores Ctrl+Z after 6 seconds", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const inbox = makeTask({ title: "Undo me", lifecycle: "inbox" });
    seed([inbox]);
    render(<LiveBoard onOpen={vi.fn()} />);

    const board = screen.getByRole("listbox", { name: "Board" });
    const fileRight = () => fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });
    const undoChord = () => fireEvent.keyDown(board, { key: "z", ctrlKey: true });

    fileRight();
    expect(task(inbox.id).lifecycle).toBe("active");

    undoChord();
    expect(task(inbox.id).lifecycle).toBe("inbox");

    fileRight();
    expect(task(inbox.id).lifecycle).toBe("active");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(task(inbox.id).lifecycle).toBe("inbox");

    fileRight();
    expect(task(inbox.id).lifecycle).toBe("active");
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    undoChord();
    expect(task(inbox.id).lifecycle).toBe("active");
  });

  it("completes from the card without opening it, and restores the prior lifecycle", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const inbox = makeTask({ title: "Check me", lifecycle: "inbox" });
    seed([inbox]);
    render(<LiveBoard onOpen={onOpen} />);

    await user.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(task(inbox.id).lifecycle).toBe("done");
    expect(task(inbox.id).completedAt).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Mark as not done" }));
    expect(task(inbox.id).lifecycle).toBe("inbox");
    expect(task(inbox.id).completedAt).toBeNull();
  });

  it("restores an unknown done card to Focus", async () => {
    const user = userEvent.setup();
    const done = makeTask({ title: "Was done", lifecycle: "done", completedAt: NOW });
    seed([done]);
    render(<LiveBoard onOpen={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Mark as not done" }));
    expect(task(done.id).lifecycle).toBe("active");
  });

  it("asks the column Add handler for that column's lifecycle", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<BoardView tasks={[]} onOpen={vi.fn()} onAdd={onAdd} />);
    await user.click(screen.getByRole("button", { name: "Add to Focus" }));
    expect(onAdd).toHaveBeenCalledWith("active");
  });

  it("gives each column its own vertical scroller at a few hundred cards", () => {
    const tasks = Array.from({ length: 200 }, (_, i) =>
      makeTask({
        id: `bulk_${i}`,
        title: `Bulk ${i}`,
        lifecycle: "inbox",
        createdAt: new Date(2026, 0, 1, 0, i).toISOString(),
      }),
    );
    render(<BoardView tasks={tasks} onOpen={vi.fn()} />);
    const region = screen.getByRole("region", { name: /^Inbox, 200/ });
    expect(region.querySelector("[data-column-scroll]")?.className).toContain("overflow-y-auto");
    expect(region.querySelectorAll("[data-board-card]")).toHaveLength(200);
  });
});

describe("TaskView toggle", () => {
  it("swaps the header for the five-column board and remembers the choice", async () => {
    const user = userEvent.setup();
    render(
      <AppFrame>
        <TaskView
          title="Inbox"
          description="Newly captured tasks."
          selector={selectInboxTasks}
          emptyTitle="Inbox zero."
          emptyDescription="Capture anything."
        />
      </AppFrame>,
    );

    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Board" }));

    expect(screen.getByRole("heading", { name: "Everything, by status" })).toBeInTheDocument();
    expect(screen.getAllByRole("region")).toHaveLength(5);
    expect(screen.queryByText("Inbox zero.")).not.toBeInTheDocument();
    expect(localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe("board");

    localStorage.setItem(VIEW_MODE_STORAGE_KEY, '{"/inbox":"board"}');
    hydrateViewModeFromStorage();
    expect(getViewMode()).toBe("list");
  });
});

describe("column capture", () => {
  it("files a column capture into that lifecycle and the next plain capture into inbox", async () => {
    const user = userEvent.setup();
    render(
      <AppFrame>
        <CaptureHarness />
      </AppFrame>,
    );

    await user.click(screen.getByRole("button", { name: "Open waiting" }));
    await user.type(
      await screen.findByPlaceholderText("What do you need to do?"),
      "Chase the vendor",
    );
    await user.click(screen.getByRole("button", { name: /^Capture$/ }));
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("waiting");

    await user.click(screen.getByRole("button", { name: "Open plain" }));
    await user.type(
      await screen.findByPlaceholderText("What do you need to do?"),
      "A normal capture",
    );
    await user.click(screen.getByRole("button", { name: /^Capture$/ }));
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("inbox");
  });
});
