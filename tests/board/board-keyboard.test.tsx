// @vitest-environment jsdom

import { BoardView } from "@/components/tasks/board/board-view";
import { useStore } from "@/lib/store/store";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardTask, installBoardBrowserMocks } from "./test-task";

describe("board keyboard model", () => {
  beforeEach(() => {
    installBoardBrowserMocks();
    window.localStorage.clear();
    useStore.setState({
      hydrated: true,
      labels: [],
      tasks: [
        boardTask({ id: "first", title: "First task", createdAt: "2026-07-27T06:00:00.000Z" }),
        boardTask({ id: "second", title: "Second task", createdAt: "2026-07-27T05:00:00.000Z" }),
      ],
    });
  });

  afterEach(() => {
    useStore.setState({ tasks: [], labels: [], hydrated: false });
  });

  it("roves within a column, files across columns, follows focus, and announces", async () => {
    render(createElement(BoardView, { onOpen: vi.fn() }));
    const first = await screen.findByRole("option", { name: /First task/ });
    await waitFor(() => expect(first).toHaveFocus());

    fireEvent.keyDown(first, { key: "j" });
    const second = screen.getByRole("option", { name: /Second task/ });
    await waitFor(() => expect(second).toHaveFocus());

    fireEvent.keyDown(second, { key: "ArrowRight", shiftKey: true });
    await waitFor(() => {
      expect(useStore.getState().tasks.find((task) => task.id === "second")?.lifecycle).toBe(
        "active",
      );
    });
    const moved = screen.getByRole("option", { name: /Second task, active/ });
    await waitFor(() => expect(moved).toHaveFocus());
    expect(screen.getByText("Second task moved to Focus")).toBeInTheDocument();
  });
});
