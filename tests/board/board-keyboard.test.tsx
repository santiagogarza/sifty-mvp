// @vitest-environment jsdom

import { BoardView } from "@/components/tasks/board/board-view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTask, seedStore, stubMatchMedia, taskInStore } from "./helpers";

/**
 * The board's accessibility contract — invisible to lint and the type
 * checker: roving focus stays inside a column on j/k, ⇧→ files the card
 * and real DOM focus follows it into its new column, and moves are
 * announced through the aria-live region.
 */

beforeAll(() => {
  stubMatchMedia();
});

function renderBoard(onOpen = vi.fn()) {
  const utils = render(<BoardView onOpen={onOpen} />);
  return { onOpen, ...utils };
}

function cardByTitle(title: string): HTMLElement {
  return screen.getByRole("option", { name: new RegExp(title) });
}

describe("board keyboard model", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the five columns as listboxes and cards as options", () => {
    seedStore([makeTask({ title: "Alpha", lifecycle: "inbox" })]);
    renderBoard();
    for (const name of ["Inbox", "Focus", "Waiting on", "Someday", "Done"]) {
      expect(screen.getByRole("listbox", { name })).toBeInTheDocument();
    }
    expect(
      within(screen.getByRole("listbox", { name: "Inbox" })).getAllByRole("option"),
    ).toHaveLength(1);
  });

  it("keeps j/k roving focus inside a column", () => {
    seedStore([
      makeTask({ title: "Alpha", lifecycle: "inbox", createdAt: "2026-07-22T10:00:00Z" }),
      makeTask({ title: "Beta", lifecycle: "inbox", createdAt: "2026-07-21T10:00:00Z" }),
      makeTask({ title: "Gamma", lifecycle: "active" }),
    ]);
    renderBoard();

    const alpha = cardByTitle("Alpha");
    alpha.focus();
    expect(document.activeElement).toBe(alpha);

    fireEvent.keyDown(alpha, { key: "j" });
    expect(document.activeElement).toBe(cardByTitle("Beta"));

    // Clamped at the bottom of the column — never crosses into Focus.
    fireEvent.keyDown(cardByTitle("Beta"), { key: "j" });
    expect(document.activeElement).toBe(cardByTitle("Beta"));

    fireEvent.keyDown(cardByTitle("Beta"), { key: "k" });
    expect(document.activeElement).toBe(cardByTitle("Alpha"));
    fireEvent.keyDown(cardByTitle("Alpha"), { key: "k" });
    expect(document.activeElement).toBe(cardByTitle("Alpha"));
  });

  it("files the selected card with shift+arrow and focus follows it", () => {
    const task = makeTask({ title: "Alpha", lifecycle: "inbox" });
    seedStore([task]);
    renderBoard();

    const card = cardByTitle("Alpha");
    card.focus();
    fireEvent.keyDown(card, { key: "ArrowRight", shiftKey: true });

    expect(taskInStore(task.id)?.lifecycle).toBe("active");
    const focusColumn = screen.getByRole("listbox", { name: "Focus" });
    const movedCard = within(focusColumn).getByRole("option", { name: /Alpha/ });
    expect(document.activeElement).toBe(movedCard);
  });

  it("announces the move through the aria-live region", () => {
    const task = makeTask({ title: "Alpha", lifecycle: "inbox" });
    seedStore([task]);
    const { container } = renderBoard();

    const card = cardByTitle("Alpha");
    card.focus();
    fireEvent.keyDown(card, { key: "ArrowRight", shiftKey: true });

    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent("Alpha moved to Focus");
  });

  it("does not file past the ends of the pipeline", () => {
    const task = makeTask({ title: "Alpha", lifecycle: "inbox" });
    seedStore([task]);
    renderBoard();

    const card = cardByTitle("Alpha");
    card.focus();
    fireEvent.keyDown(card, { key: "ArrowLeft", shiftKey: true });
    expect(taskInStore(task.id)?.lifecycle).toBe("inbox");
  });

  it("keeps the keyboard model alive when focus falls back to <body>", () => {
    // Closing the detail sheet restores focus to <body>; the selected card
    // must still respond so open → Escape → ⇧→ works without re-tabbing.
    const task = makeTask({ title: "Alpha", lifecycle: "inbox" });
    seedStore([task]);
    renderBoard();

    const card = cardByTitle("Alpha");
    act(() => {
      card.focus();
      card.blur();
    });
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: "ArrowRight", shiftKey: true });
    expect(taskInStore(task.id)?.lifecycle).toBe("active");
  });

  it("opens the detail sheet on Enter", () => {
    const task = makeTask({ title: "Alpha", lifecycle: "inbox" });
    seedStore([task]);
    const { onOpen } = renderBoard();

    const card = cardByTitle("Alpha");
    card.focus();
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(task.id);
  });
});
