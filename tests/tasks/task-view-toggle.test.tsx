// @vitest-environment jsdom
import { TaskView } from "@/components/tasks/task-view";
import { VIEW_MODE_KEY } from "@/components/tasks/use-view-mode";
import { selectInboxTasks } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTask } from "../helpers/tasks";

const frame = {
  openDetail: vi.fn(),
  openCapture: vi.fn(),
  openCommand: vi.fn(),
  syncError: false,
};

vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => frame,
}));

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
  frame.openCapture.mockClear();
  useStore.setState({
    tasks: [
      makeTask({ lifecycle: "inbox", title: "Only inbox task" }),
      makeTask({ lifecycle: "active", title: "Only focus task" }),
    ],
    labels: [],
    hydrated: true,
  });
});

function renderInbox() {
  return render(
    <TaskView
      title="Inbox"
      description="Newly captured tasks."
      selector={selectInboxTasks}
      emptyTitle="Inbox zero."
    />,
  );
}

describe("TaskView List / Board toggle", () => {
  it("swaps the route header for the board's and shows every status, then back", async () => {
    renderInbox();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Inbox");
    expect(screen.getByRole("radio", { name: "List" })).toBeChecked();
    expect(screen.queryByText("Only focus task")).toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: "Board" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Everything, by status");
    expect(screen.getAllByRole("group")).toHaveLength(5);
    expect(screen.getByText("Only inbox task")).toBeInTheDocument();
    expect(screen.getByText("Only focus task")).toBeInTheDocument();
    expect(window.localStorage.getItem(VIEW_MODE_KEY)).toBe("board");

    await userEvent.click(screen.getByRole("radio", { name: "List" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Inbox");
    expect(screen.getByText("Newly captured tasks.")).toBeInTheDocument();
    expect(screen.queryByText("Only focus task")).toBeNull();
  });

  it("opens Board straight away when the preference is stored", () => {
    window.localStorage.setItem(VIEW_MODE_KEY, "board");
    renderInbox();
    expect(screen.getByRole("radio", { name: "Board" })).toBeChecked();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Everything, by status");
  });

  it("column Add captures into that column's status", async () => {
    window.localStorage.setItem(VIEW_MODE_KEY, "board");
    renderInbox();
    const focusSection = screen.getByRole("group", { name: /^Focus/ }).parentElement!;
    await userEvent.click(within(focusSection).getByRole("button", { name: "Add" }));
    expect(frame.openCapture).toHaveBeenCalledWith({ lifecycle: "active" });
  });
});
