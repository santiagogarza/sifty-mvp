// @vitest-environment jsdom

import { UNDO_WINDOW_MS, useBoardUndo } from "@/components/tasks/board/use-board-undo";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-07-22T12:00:00Z");

function makeTask(patch: Partial<Task>): Task {
  return {
    id: patch.id ?? "task_undo_1",
    sourceText: "test",
    sourceContext: null,
    title: "Undo task",
    description: null,
    nextAction: null,
    lifecycle: patch.lifecycle ?? "inbox",
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
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    completedAt: patch.completedAt ?? null,
    ...patch,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  useStore.setState({
    hydrated: true,
    tasks: [makeTask({ id: "t1", lifecycle: "inbox" })],
    labels: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
  useStore.setState({ tasks: [], labels: [], hydrated: false });
});

describe("board move and undo", () => {
  it("move to Done sets completedAt", () => {
    useStore.getState().updateTask("t1", { lifecycle: "done" });
    const task = useStore.getState().tasks.find((t) => t.id === "t1");
    expect(task?.lifecycle).toBe("done");
    expect(task?.completedAt).toBeTruthy();
  });

  it("undo within the window restores previous lifecycle and null completedAt", () => {
    const onUndo = vi.fn((move) => {
      useStore.getState().updateTask(move.taskId, { lifecycle: move.prevLifecycle });
    });

    const { result } = renderHook(() => useBoardUndo(onUndo));

    useStore.getState().updateTask("t1", { lifecycle: "done" });
    expect(useStore.getState().tasks[0]?.completedAt).toBeTruthy();

    act(() => {
      result.current.registerMove({
        taskId: "t1",
        prevLifecycle: "inbox",
        prevCompletedAt: null,
      });
    });

    act(() => {
      result.current.handleUndo();
    });

    const task = useStore.getState().tasks.find((t) => t.id === "t1");
    expect(task?.lifecycle).toBe("inbox");
    expect(task?.completedAt).toBeNull();
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("undo offer expires after its window", () => {
    const onUndo = vi.fn();
    const { result } = renderHook(() => useBoardUndo(onUndo));

    act(() => {
      result.current.registerMove({
        taskId: "t1",
        prevLifecycle: "inbox",
        prevCompletedAt: null,
      });
    });

    expect(result.current.undoMove).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS + 1);
    });

    expect(result.current.undoMove).toBeNull();
  });
});
