// @vitest-environment jsdom

import { TaskView } from "@/components/tasks/task-view";
import { selectInboxTasks } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { resetViewModeForTests } from "@/lib/ui/view-mode";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({
    openDetail: vi.fn(),
    openCapture: vi.fn(),
    openCommand: vi.fn(),
    syncError: false,
  }),
}));

describe("TaskView layout toggle", () => {
  beforeEach(() => {
    resetViewModeForTests();
    useStore.setState({ tasks: [], labels: [], hydrated: true });
  });

  afterEach(() => {
    cleanup();
    resetViewModeForTests();
  });

  it("swaps the header for the full pipeline and back", async () => {
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
    expect(screen.getByText("Newly captured tasks.")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Board" }));

    expect(screen.getByRole("heading", { name: "Everything, by status" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Inbox, 0" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Done, 0" })).toBeInTheDocument();
    expect(screen.queryByText("Inbox zero.")).toBeNull();
    expect(window.localStorage.getItem("sifty.viewMode")).toBe("board");

    await user.click(screen.getByRole("radio", { name: "List" }));

    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByText("Newly captured tasks.")).toBeInTheDocument();
  });
});
