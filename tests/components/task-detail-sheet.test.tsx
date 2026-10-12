// @vitest-environment jsdom
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** SIF-15: Duplicate from the sheet, by button and by Shift+D. */

const openDetail = vi.fn();
vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({ openDetail, openCapture: vi.fn(), openCommand: vi.fn() }),
}));
vi.mock("@/lib/ai/run-triage", () => ({
  resiftTask: vi.fn(),
  isTriageInFlight: () => false,
}));

const task: Task = {
  id: "task_src",
  sourceText: "weekly review",
  sourceContext: null,
  title: "Weekly review",
  description: null,
  nextAction: "Open last week's notes",
  lifecycle: "active",
  aiStatus: "ready",
  aiError: null,
  aiAttempts: 1,
  urgency: 0.6,
  importance: 0.7,
  priorityBucket: "do_now",
  effort: "small",
  due: "2026-10-16",
  delegationCandidate: "self",
  assigneeName: null,
  confidence: 0.9,
  clarifyingQuestion: null,
  rationale: "Recurring ritual.",
  agentBrief: null,
  siftId: null,
  siftStage: null,
  plan: null,
  recurrence: null,
  seriesId: null,
  siftedWithAssumptions: false,
  labelIds: [],
  subtasks: [{ id: "st_1", title: "Review calendar", done: true, order: 0 }],
  editedFields: [],
  createdAt: "2026-10-10T10:00:00.000Z",
  updatedAt: "2026-10-10T10:00:00.000Z",
  completedAt: null,
};

beforeEach(() => {
  useStore.setState({ tasks: [task], labels: [] });
  openDetail.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("TaskDetailSheet header", () => {
  it("shows the confidence pill once sifted, and the thinking line while organizing", () => {
    const { rerender } = render(<TaskDetailSheet taskId="task_src" onClose={vi.fn()} />);
    const pill = screen.getByTestId("confidence-pill");
    expect(pill).toHaveTextContent("Sifted · 90%");
    expect(pill).toHaveAttribute("data-band", "ok");

    useStore.setState({ tasks: [{ ...task, aiStatus: "running" }] });
    rerender(<TaskDetailSheet taskId="task_src" onClose={vi.fn()} />);
    expect(screen.queryByTestId("confidence-pill")).toBeNull();
    expect(screen.getByText(/Sifty is organizing this/)).toBeInTheDocument();
  });

  it("names the running stage in the five-step strip", () => {
    useStore.setState({ tasks: [{ ...task, aiStatus: "running", siftStage: "prioritize" }] });
    render(<TaskDetailSheet taskId="task_src" onClose={vi.fn()} />);
    const strip = screen.getByTestId("sift-progress");
    expect(strip).toHaveTextContent("Prioritizing…");
    expect(strip).toHaveAttribute("aria-label", "Prioritizing (step 2 of 5)");
  });

  it("Reorganize asks the server to re-sift", async () => {
    const user = userEvent.setup();
    const { resiftTask } = await import("@/lib/ai/run-triage");
    render(<TaskDetailSheet taskId="task_src" onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Reorganize with Sifty" }));
    expect(resiftTask).toHaveBeenCalledWith("task_src");
  });
});

describe("TaskDetailSheet focus", () => {
  it("returns focus to whoever opened it when it closes", async () => {
    const onClose = vi.fn();
    const view = render(
      <>
        <button type="button">Row stand-in</button>
        <TaskDetailSheet taskId={null} onClose={onClose} />
      </>,
    );
    const opener = screen.getByRole("button", { name: "Row stand-in" });
    opener.focus();

    view.rerender(
      <>
        <button type="button">Row stand-in</button>
        <TaskDetailSheet taskId="task_src" onClose={onClose} />
      </>,
    );
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());

    view.rerender(
      <>
        <button type="button">Row stand-in</button>
        <TaskDetailSheet taskId={null} onClose={onClose} />
      </>,
    );
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe("TaskDetailSheet duplicate", () => {
  it("the Duplicate button creates the copy and opens it", async () => {
    const user = userEvent.setup();
    render(<TaskDetailSheet taskId="task_src" onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Duplicate task" }));

    const tasks = useStore.getState().tasks;
    expect(tasks).toHaveLength(2);
    const copy = tasks.find((t) => t.id !== "task_src")!;
    expect(copy.title).toBe("Weekly review (copy)");
    expect(copy.due).toBeNull();
    expect(copy.subtasks[0]!.done).toBe(false);
    expect(openDetail).toHaveBeenCalledWith(copy.id);
  });

  it("Shift+D duplicates from the panel, but not while typing in a field", async () => {
    const user = userEvent.setup();
    render(<TaskDetailSheet taskId="task_src" onClose={vi.fn()} />);

    // The panel itself holds focus on open.
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
    await user.keyboard("{Shift>}D{/Shift}");
    expect(useStore.getState().tasks).toHaveLength(2);
    expect(openDetail).toHaveBeenCalledTimes(1);

    const title = screen.getByPlaceholderText("Task title");
    await user.click(title);
    await user.keyboard("{Shift>}D{/Shift}");
    expect(useStore.getState().tasks).toHaveLength(2);
    expect(openDetail).toHaveBeenCalledTimes(1);
  });
});

describe("TaskDetailSheet repeat", () => {
  it("header shows the labeled priority pill", () => {
    render(<TaskDetailSheet taskId="task_src" onClose={vi.fn()} />);
    expect(screen.getByTestId("priority-pill")).toHaveTextContent("Urgent + important");
  });

  it("sets a weekly rule anchored on the due, then edits days, mode, and scope", async () => {
    const user = userEvent.setup();
    render(<TaskDetailSheet taskId="task_src" onClose={vi.fn()} />);

    const row = screen.getByTestId("recurrence-row");
    expect(row).toHaveTextContent("Doesn't repeat");
    await user.click(row);
    await user.click(screen.getByRole("menuitemradio", { name: "Weekly" }));

    let current = useStore.getState().tasks.find((t) => t.id === "task_src")!;
    // Due 2026-10-16 is a Friday.
    expect(current.recurrence).toEqual({ freq: "weekly", mode: "fixed", weekdays: [5] });
    expect(current.seriesId).toBe("task_src");
    expect(row).toHaveTextContent("Weekly on Fri");

    await user.click(screen.getByRole("button", { name: "Monday" }));
    current = useStore.getState().tasks.find((t) => t.id === "task_src")!;
    expect(current.recurrence?.weekdays).toEqual([1, 5]);
    // The last remaining day cannot be switched off.
    await user.click(screen.getByRole("button", { name: "Friday" }));
    await user.click(screen.getByRole("button", { name: "Monday" }));
    current = useStore.getState().tasks.find((t) => t.id === "task_src")!;
    expect(current.recurrence?.weekdays).toEqual([1]);

    // Clicking the frequency already in force keeps the chosen days.
    await user.click(screen.getByRole("menuitemradio", { name: "Weekly" }));
    current = useStore.getState().tasks.find((t) => t.id === "task_src")!;
    expect(current.recurrence?.weekdays).toEqual([1]);

    await user.click(screen.getByRole("menuitemradio", { name: /After completion/ }));
    current = useStore.getState().tasks.find((t) => t.id === "task_src")!;
    expect(current.recurrence?.mode).toBe("after_completion");
    expect(row).toHaveTextContent("Weekly · after completion");

    await user.click(screen.getByRole("radio", { name: "This instance" }));
    expect(useStore.getState().instanceScope).toEqual({ task_src: true });
    expect(row).toHaveTextContent("Editing this instance");

    await user.click(screen.getByRole("menuitemradio", { name: "Doesn't repeat" }));
    current = useStore.getState().tasks.find((t) => t.id === "task_src")!;
    expect(current.recurrence).toBeNull();
    expect(row).toHaveTextContent("Doesn't repeat");
  });

  it("monthly exposes a day-of-month input defaulting to the due's day", async () => {
    const user = userEvent.setup();
    render(<TaskDetailSheet taskId="task_src" onClose={vi.fn()} />);
    await user.click(screen.getByTestId("recurrence-row"));
    await user.click(screen.getByRole("menuitemradio", { name: "Monthly" }));
    const day = screen.getByRole("spinbutton", { name: "Day of month" });
    expect(day).toHaveValue(16);
    await user.clear(day);
    await user.type(day, "28");
    const current = useStore.getState().tasks.find((t) => t.id === "task_src")!;
    expect(current.recurrence).toEqual({ freq: "monthly", mode: "fixed", dayOfMonth: 28 });
    expect(screen.getByTestId("recurrence-row")).toHaveTextContent("Monthly on the 28th");
  });
});
