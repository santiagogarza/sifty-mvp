// @vitest-environment jsdom

import { BoardView } from "@/components/tasks/board/board-view";
import { useStore } from "@/lib/store/store";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Fragment, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardTask, installBoardBrowserMocks } from "./test-task";

function renderBoard() {
  return render(
    createElement(
      Fragment,
      null,
      createElement("div", { id: "app-feedback-stack" }),
      createElement(BoardView, { onOpen: vi.fn() }),
    ),
  );
}

describe("board move undo", () => {
  beforeEach(() => {
    installBoardBrowserMocks();
    window.localStorage.clear();
    useStore.setState({
      hydrated: true,
      labels: [],
      tasks: [boardTask({ id: "undo-task", title: "Undo task", lifecycle: "someday" })],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    useStore.setState({ tasks: [], labels: [], hydrated: false });
  });

  it("restores lifecycle and completedAt when a Done move is undone", async () => {
    renderBoard();
    const card = await screen.findByRole("option", { name: /Undo task, someday/ });
    fireEvent.keyDown(card, { key: "ArrowRight", shiftKey: true });

    await waitFor(() => {
      const moved = useStore.getState().tasks[0];
      expect(moved?.lifecycle).toBe("done");
      expect(moved?.completedAt).not.toBeNull();
    });
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => {
      const restored = useStore.getState().tasks[0];
      expect(restored?.lifecycle).toBe("someday");
      expect(restored?.completedAt).toBeNull();
    });
  });

  it("expires the undo action after six seconds", async () => {
    renderBoard();
    const card = await screen.findByRole("option", { name: /Undo task, someday/ });
    vi.useFakeTimers();
    fireEvent.keyDown(card, { key: "ArrowRight", shiftKey: true });
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(6000));
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});
