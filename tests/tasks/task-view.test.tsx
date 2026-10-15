// @vitest-environment jsdom
import { TaskView } from "@/components/tasks/task-view";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const frame = {
  openDetail: vi.fn(),
  openCapture: vi.fn(),
  openCommand: vi.fn(),
  syncError: false,
};
vi.mock("@/components/app-shell/app-frame", () => ({ useFrame: () => frame }));

const inboxOnly = (tasks: Task[]) => tasks.filter((t) => t.lifecycle === "inbox");

function renderView() {
  return render(
    <TaskView
      title="Inbox"
      description="Newly captured tasks."
      selector={inboxOnly}
      emptyTitle="Inbox zero."
    />,
  );
}

describe("TaskView List / Board toggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useStore.setState({ tasks: [], labels: [], hydrated: true });
  });
  afterEach(cleanup);

  it("defaults to List with the route's own header", () => {
    renderView();
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("group", { name: "Board" })).not.toBeInTheDocument();
  });

  it("switches to Board copy and five columns, and back", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Board" }));

    expect(screen.getByRole("heading", { name: "Everything, by status" })).toBeInTheDocument();
    expect(screen.getByText("Board", { selector: ".text-eyebrow" })).toBeInTheDocument();
    expect(screen.getAllByRole("region")).toHaveLength(5);
    expect(window.localStorage.getItem("sifty.viewMode")).toBe('"board"');

    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });

  it("starts in Board when that was the stored choice", () => {
    window.localStorage.setItem("sifty.viewMode", '"board"');
    renderView();
    expect(screen.getByRole("heading", { name: "Everything, by status" })).toBeInTheDocument();
  });

  it("a column's Add opens capture for that status; Done has none", () => {
    window.localStorage.setItem("sifty.viewMode", '"board"');
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Add to Waiting on" }));
    expect(frame.openCapture).toHaveBeenCalledWith({ lifecycle: "waiting" });
    expect(screen.queryByRole("button", { name: "Add to Done" })).not.toBeInTheDocument();
  });
});
