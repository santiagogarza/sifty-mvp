// @vitest-environment jsdom
import { BoardView } from "@/components/tasks/board/board-view";
import type { Task } from "@/lib/domain/types";
import { useBoardMove } from "@/lib/store/board-move";
import { useStore } from "@/lib/store/store";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BoardView reads openDetail from the frame; the frame pulls in the whole app
// shell (sync, overlays), so we mock the seam rather than mounting it.
vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({ openDetail: vi.fn(), openCapture: vi.fn(), openCommand: vi.fn() }),
}));

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  return {
    id: `task_${seq}`,
    sourceText: "test",
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
    createdAt: "2026-07-20T09:00:00Z",
    updatedAt: "2026-07-20T09:00:00Z",
    completedAt: null,
    ...patch,
  };
}

function board(): HTMLElement {
  const el = document.querySelector('[aria-label="Board"]');
  if (!el) throw new Error("board container not found");
  return el as HTMLElement;
}

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [], memories: [], hydrated: true });
  useBoardMove.setState({ pending: null });
});

afterEach(() => cleanup());

describe("board keyboard model", () => {
  it("⇧→ files the selected card into the next column, and focus follows it", () => {
    const card = makeTask({ lifecycle: "inbox", title: "File me" });
    useStore.setState({ tasks: [card] });
    render(<BoardView />);

    // First arrow makes the first selection (nothing is pre-selected).
    fireEvent.keyDown(board(), { key: "ArrowDown" });
    // ⇧→ moves Inbox → Focus (stored "active").
    fireEvent.keyDown(board(), { key: "ArrowRight", shiftKey: true });

    expect(useStore.getState().tasks.find((t) => t.id === card.id)?.lifecycle).toBe("active");
    expect((document.activeElement as HTMLElement)?.getAttribute("aria-label")).toBe("File me");
  });

  it("announces the move through the aria-live region", () => {
    const card = makeTask({ lifecycle: "inbox", title: "Announce me" });
    useStore.setState({ tasks: [card] });
    render(<BoardView />);

    fireEvent.keyDown(board(), { key: "ArrowDown" });
    fireEvent.keyDown(board(), { key: "ArrowRight", shiftKey: true });

    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain("Moved");
    expect(live?.textContent).toContain("Focus");
  });

  it("j/k roving stays inside a column", () => {
    // Newest-first: `top` sorts above `bottom` in Inbox.
    const top = makeTask({ lifecycle: "inbox", title: "Top", createdAt: "2026-07-21T09:00:00Z" });
    const bottom = makeTask({
      lifecycle: "inbox",
      title: "Bottom",
      createdAt: "2026-07-20T09:00:00Z",
    });
    const elsewhere = makeTask({ lifecycle: "active", title: "Elsewhere" });
    useStore.setState({ tasks: [top, bottom, elsewhere] });
    render(<BoardView />);

    fireEvent.keyDown(board(), { key: "j" }); // first selection → Top
    expect((document.activeElement as HTMLElement)?.getAttribute("aria-label")).toBe("Top");
    fireEvent.keyDown(board(), { key: "j" }); // down within Inbox → Bottom
    expect((document.activeElement as HTMLElement)?.getAttribute("aria-label")).toBe("Bottom");
    fireEvent.keyDown(board(), { key: "j" }); // clamped at the last card
    expect((document.activeElement as HTMLElement)?.getAttribute("aria-label")).toBe("Bottom");

    // Never jumped columns into the active card.
    expect(useStore.getState().tasks.find((t) => t.id === elsewhere.id)?.lifecycle).toBe("active");
  });
});
