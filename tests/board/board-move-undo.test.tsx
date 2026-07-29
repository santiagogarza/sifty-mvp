// @vitest-environment jsdom

import { BoardView } from "@/components/tasks/board/board-view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTask, seedStore, stubMatchMedia, taskInStore } from "./helpers";

/**
 * Round-tripping `completedAt` is the one place a move can silently
 * corrupt data: entering Done must stamp it, Undo must restore the exact
 * previous value, and the pill must stop offering Undo once its window
 * closes.
 */

beforeAll(() => {
  stubMatchMedia();
});

describe("board move + undo", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stamps completedAt on a move to Done and Undo restores a null", () => {
    const task = makeTask({ title: "Alpha", lifecycle: "inbox" });
    seedStore([task]);
    render(<BoardView onOpen={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));

    const moved = taskInStore(task.id);
    expect(moved?.lifecycle).toBe("done");
    expect(moved?.completedAt).toBeTruthy();
    expect(
      within(screen.getByRole("listbox", { name: "Done" })).getByRole("option", { name: /Alpha/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Moved to Done")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    const restored = taskInStore(task.id);
    expect(restored?.lifecycle).toBe("inbox");
    expect(restored?.completedAt).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("restores the exact previous completedAt when undoing a move out of Done", () => {
    const completedAt = "2026-07-20T09:30:00.000Z";
    const task = makeTask({ title: "Alpha", lifecycle: "done", completedAt });
    seedStore([task]);
    render(<BoardView onOpen={vi.fn()} />);

    // Unchecking a done card sends it back to Focus, like the list rows.
    fireEvent.click(screen.getByRole("button", { name: "Mark as not done" }));
    expect(taskInStore(task.id)?.lifecycle).toBe("active");
    expect(taskInStore(task.id)?.completedAt).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    const restored = taskInStore(task.id);
    expect(restored?.lifecycle).toBe("done");
    expect(restored?.completedAt).toBe(completedAt);
  });

  it("expires the pill after its window and stops offering undo", () => {
    vi.useFakeTimers();
    const task = makeTask({ title: "Alpha", lifecycle: "inbox" });
    seedStore([task]);
    render(<BoardView onOpen={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6100);
    });

    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    // The move itself stands — only the offer expires.
    expect(taskInStore(task.id)?.lifecycle).toBe("done");
  });
});
