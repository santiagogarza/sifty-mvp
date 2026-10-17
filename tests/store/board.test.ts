import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Lifecycle } from "@/lib/domain/types";
import { selectDoneTasks, selectFocusTasks, selectInboxTasks } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { BOARD_COLUMNS, BOARD_POINTER_DISTANCE_PX, resolveBoardDrop } from "@/lib/ui/board";
import { beforeEach, describe, expect, it } from "vitest";
import { makeTask } from "../helpers/task";

describe("board columns", () => {
  it("matches STATUS_VIEWS and has no Dropped or Today column", () => {
    expect(BOARD_COLUMNS.map((column) => column.status)).toEqual(
      STATUS_VIEWS.map((column) => column.status),
    );
    const statuses = BOARD_COLUMNS.map((column) => column.status);
    expect(statuses).not.toContain("dropped");
    expect(statuses).not.toContain("today");
    expect(BOARD_POINTER_DISTANCE_PX).toBe(8);
  });

  it("keeps the list sort inside each column", () => {
    const older = makeTask({
      id: "old",
      lifecycle: "inbox",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const newer = makeTask({
      id: "new",
      lifecycle: "inbox",
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    expect(selectInboxTasks([older, newer]).map((task) => task.id)).toEqual(["new", "old"]);

    const now = makeTask({
      id: "now",
      lifecycle: "active",
      priorityBucket: "do_now",
      urgency: 0.9,
      importance: 0.9,
    });
    const low = makeTask({
      id: "low",
      lifecycle: "active",
      priorityBucket: "drop",
      urgency: 0.1,
      importance: 0.1,
    });
    expect(selectFocusTasks([low, now]).map((task) => task.id)).toEqual(["now", "low"]);

    const earlier = makeTask({
      id: "earlier",
      lifecycle: "done",
      completedAt: "2026-01-01T00:00:00.000Z",
    });
    const later = makeTask({
      id: "later",
      lifecycle: "done",
      completedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(selectDoneTasks([earlier, later]).map((task) => task.id)).toEqual(["later", "earlier"]);
  });

  it("treats a same-column drop as a no-op", () => {
    expect(resolveBoardDrop("inbox", "inbox")).toBeNull();
    expect(resolveBoardDrop("inbox", null)).toBeNull();
    expect(resolveBoardDrop("inbox", "dropped")).toBeNull();
    expect(resolveBoardDrop("active", "waiting")).toBe("waiting");
  });
});

describe("createTask lifecycle", () => {
  beforeEach(() => {
    useStore.setState({ tasks: [], hydrated: true });
  });

  it("defaults to inbox and keeps an explicit lifecycle through triage", () => {
    const inbox = useStore.getState().createTask({ sourceText: "Capture something" });
    expect(inbox.lifecycle).toBe("inbox");

    const focus = useStore.getState().createTask({
      sourceText: "Already committed",
      lifecycle: "active",
    });
    expect(focus.lifecycle).toBe("active");

    useStore.getState().applyTriage(focus.id, {
      title: "Already committed",
      description: null,
      nextAction: "Start",
      urgency: 0.2,
      importance: 0.8,
      effort: "small",
      due: null,
      delegationCandidate: "self",
      labelIds: [],
      subtasks: [],
      rationale: null,
      confidence: 0.5,
      clarifyingQuestion: null,
    });

    const after = useStore.getState().tasks.find((task) => task.id === focus.id);
    expect(after?.lifecycle).toBe("active");
    expect(after?.editedFields).not.toContain("lifecycle");
  });

  it("sets completedAt when entering Done and clears it when leaving", () => {
    const task = useStore.getState().createTask({ sourceText: "Finish" });
    useStore.getState().updateTask(task.id, { lifecycle: "done" });
    const done = useStore.getState().tasks.find((entry) => entry.id === task.id);
    expect(done?.lifecycle).toBe("done");
    expect(done?.completedAt).toBeTruthy();

    useStore.getState().updateTask(task.id, { lifecycle: "active" satisfies Lifecycle });
    const restored = useStore.getState().tasks.find((entry) => entry.id === task.id);
    expect(restored?.lifecycle).toBe("active");
    expect(restored?.completedAt).toBeNull();
  });
});
