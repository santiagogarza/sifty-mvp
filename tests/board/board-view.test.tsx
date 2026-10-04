// @vitest-environment jsdom

import { BOARD_POINTER_DISTANCE } from "@/components/tasks/board-model";
import { TaskView } from "@/components/tasks/task-view";
import { VIEW_MODE_KEY } from "@/components/tasks/use-view-mode";
import { useStore } from "@/lib/store/store";
import { makeTask } from "@/tests/helpers/task";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const frame = vi.hoisted(() => ({
  openDetail: vi.fn(),
  openCapture: vi.fn(),
  openCommand: vi.fn(),
  captureOpen: false,
  commandOpen: false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => frame,
}));

function renderInbox(tasks = useStore.getState().tasks) {
  useStore.setState({ tasks, labels: [], memories: [], hydrated: true });
  return render(
    <TaskView
      title="Inbox"
      description="Newly captured tasks."
      selector={(items) => items.filter((task) => task.lifecycle === "inbox")}
      emptyTitle="Inbox zero."
      emptyDescription="Capture anything."
    />,
  );
}

describe("board view", () => {
  beforeEach(() => {
    localStorage.clear();
    frame.openDetail.mockClear();
    frame.openCapture.mockClear();
    useStore.setState({ tasks: [], labels: [], memories: [], hydrated: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps a click under the drag threshold as an open", () => {
    expect(BOARD_POINTER_DISTANCE).toBe(8);
  });

  it("swaps the header and renders five columns", () => {
    renderInbox([makeTask({ id: "task_a", title: "Inbox one", lifecycle: "inbox" })]);
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Board" }));
    expect(screen.getByRole("heading", { name: "Everything, by status" })).toBeInTheDocument();
    expect(screen.getAllByRole("region")).toHaveLength(5);
    expect(screen.getByRole("region", { name: /Inbox, 1/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
  });

  it("stays silent when there are no tasks", () => {
    renderInbox([]);
    fireEvent.click(screen.getByRole("radio", { name: "Board" }));
    expect(screen.getAllByRole("region")).toHaveLength(5);
    expect(screen.queryByText("Inbox zero.")).not.toBeInTheDocument();
    expect(screen.queryByText("to file")).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing here/i)).not.toBeInTheDocument();
  });

  it("files the selected card one column to the right", () => {
    renderInbox([makeTask({ id: "task_a", title: "Inbox one", lifecycle: "inbox" })]);
    fireEvent.click(screen.getByRole("radio", { name: "Board" }));
    fireEvent.keyDown(document.body, { key: "ArrowRight", shiftKey: true });
    expect(useStore.getState().tasks.find((task) => task.id === "task_a")?.lifecycle).toBe(
      "active",
    );
    expect(screen.getByText("Moved to Focus")).toBeInTheDocument();
  });

  it("does not file a Done card past the last column", () => {
    renderInbox([
      makeTask({
        id: "task_done",
        title: "Finished",
        lifecycle: "done",
        completedAt: "2026-03-01T00:00:00.000Z",
      }),
    ]);
    fireEvent.click(screen.getByRole("radio", { name: "Board" }));
    fireEvent.keyDown(document.body, { key: "ArrowRight", shiftKey: true });
    expect(useStore.getState().tasks.find((task) => task.id === "task_done")?.lifecycle).toBe(
      "done",
    );
    expect(screen.queryByText(/Moved to/)).not.toBeInTheDocument();
  });

  it("opens the selected card on Enter and on click", () => {
    renderInbox([makeTask({ id: "task_a", title: "Inbox one", lifecycle: "inbox" })]);
    fireEvent.click(screen.getByRole("radio", { name: "Board" }));
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(frame.openDetail).toHaveBeenCalledWith("task_a");

    frame.openDetail.mockClear();
    fireEvent.click(screen.getByText("Inbox one"));
    expect(frame.openDetail).toHaveBeenCalledWith("task_a");
    expect(useStore.getState().tasks.find((task) => task.id === "task_a")?.lifecycle).toBe("inbox");
  });

  it("undoes from the pill and from Ctrl+Z, then retires", () => {
    vi.useFakeTimers();
    renderInbox([makeTask({ id: "task_a", title: "Inbox one", lifecycle: "inbox" })]);
    fireEvent.click(screen.getByRole("radio", { name: "Board" }));
    fireEvent.keyDown(document.body, { key: "ArrowRight", shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(useStore.getState().tasks.find((task) => task.id === "task_a")?.lifecycle).toBe("inbox");

    fireEvent.keyDown(document.body, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(useStore.getState().tasks.find((task) => task.id === "task_a")?.lifecycle).toBe("inbox");

    fireEvent.keyDown(document.body, { key: "ArrowRight", shiftKey: true });
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText(/Moved to/)).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(useStore.getState().tasks.find((task) => task.id === "task_a")?.lifecycle).toBe(
      "active",
    );
  });

  it("completes a card into Done and lets a column Add capture into that status", () => {
    renderInbox([makeTask({ id: "task_a", title: "Inbox one", lifecycle: "inbox" })]);
    fireEvent.click(screen.getByRole("radio", { name: "Board" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(useStore.getState().tasks.find((task) => task.id === "task_a")?.lifecycle).toBe("done");
    expect(
      useStore.getState().tasks.find((task) => task.id === "task_a")?.completedAt,
    ).toBeTruthy();

    const waiting = screen.getByRole("region", { name: /Waiting on/ });
    fireEvent.click(within(waiting).getByRole("button", { name: "Add" }));
    expect(frame.openCapture).toHaveBeenCalledWith({ lifecycle: "waiting" });
  });

  it("remembers the mode for this route only", () => {
    renderInbox([makeTask({ id: "task_a", title: "Inbox one", lifecycle: "inbox" })]);
    fireEvent.click(screen.getByRole("radio", { name: "Board" }));
    const stored = JSON.parse(localStorage.getItem(VIEW_MODE_KEY) ?? "{}") as Record<
      string,
      string
    >;
    expect(stored["/inbox"]).toBe("board");
    expect(stored["/today"]).toBeUndefined();
  });
});
